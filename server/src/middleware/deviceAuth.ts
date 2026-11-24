import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { DeviceModel, Tenant } from '../../../shared/types.ts';
import type { DeviceRecord, IDeviceModelRepository, IDeviceRepository, ITenantRepository } from '../repositories/types.ts';
import type { AuditService } from '../services/auditService.ts';
import { verifyDeviceApiKey } from '../services/deviceLifecycle.ts';
import { Errors } from '../utils/errors.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      deviceAuth?: {
        device: DeviceRecord;
        tenant: Tenant;
        model: DeviceModel;
      };
    }
  }
}

const AUTH_FAIL_AUDIT_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_DEVICE = 120;

/**
 * Authenticates every `/device/v1/*` request via `X-Device-Id` and `X-API-Key` (Section 6).
 * - Constant-time SHA-256 verification against `devices.apiKeyHash`.
 * - Unknown device or wrong key -> 401 (with rate-limited `DEVICE_AUTH_FAILED` audit, max 1 / device / 5 min).
 * - Device SUSPENDED or DECOMMISSIONED, or Tenant SUSPENDED -> 403.
 * - Per-device sliding rate limit -> 429 RATE_LIMITED.
 */
export function createDeviceAuthMiddleware(
  devicesRepo: IDeviceRepository,
  tenantsRepo: ITenantRepository,
  modelsRepo: IDeviceModelRepository,
  audit: AuditService,
): RequestHandler {
  const lastAuthFailAuditByDevice = new Map<string, number>();
  const requestCountsByDevice = new Map<string, { windowStart: number; count: number }>();

  const recordRateLimitedAuthFailure = (
    deviceId: string,
    tenantId: string | null,
    reason: string,
    ip: string,
  ) => {
    const key = deviceId || 'unknown';
    const now = Date.now();
    const last = lastAuthFailAuditByDevice.get(key) ?? 0;
    if (now - last < AUTH_FAIL_AUDIT_WINDOW_MS) {
      return;
    }
    lastAuthFailAuditByDevice.set(key, now);
    audit.record({
      actorId: key,
      actorRole: 'ANONYMOUS',
      tenantId,
      action: 'DEVICE_AUTH_FAILED',
      targetType: 'DEVICE',
      targetId: key,
      outcome: 'FAILURE',
      ip,
      details: { reason },
    });
  };

  return (req: Request, _res: Response, next: NextFunction) => {
    const deviceId = req.header('x-device-id')?.trim() ?? '';
    const apiKey = req.header('x-api-key')?.trim() ?? '';
    const ip = req.clientIp ?? req.ip ?? 'unknown';

    if (!deviceId || !apiKey) {
      recordRateLimitedAuthFailure(deviceId || 'missing', null, 'missing_headers', ip);
      return next(Errors.unauthenticated('Missing X-Device-Id or X-API-Key header'));
    }

    // Per-device rate limit (Section 8.1)
    const now = Date.now();
    const bucket = requestCountsByDevice.get(deviceId);
    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      requestCountsByDevice.set(deviceId, { windowStart: now, count: 1 });
    } else {
      bucket.count += 1;
      if (bucket.count > RATE_LIMIT_MAX_PER_DEVICE) {
        return next(Errors.rateLimited('Device request rate limit exceeded'));
      }
    }

    const device = devicesRepo.findByIdSystem(deviceId);
    if (!device) {
      recordRateLimitedAuthFailure(deviceId, null, 'unknown_device', ip);
      return next(Errors.unauthenticated('Invalid device credentials'));
    }

    // Decommissioned devices have revoked keys and must be rejected with 403 per Section 6
    if (device.state === 'DECOMMISSIONED') {
      return next(Errors.forbidden('Device has been decommissioned'));
    }

    if (!device.apiKeyHash || !verifyDeviceApiKey(apiKey, device.apiKeyHash)) {
      recordRateLimitedAuthFailure(deviceId, device.tenantId, 'invalid_api_key', ip);
      return next(Errors.unauthenticated('Invalid device credentials'));
    }

    if (device.state === 'SUSPENDED') {
      return next(Errors.forbidden('Device is suspended'));
    }

    const tenant = tenantsRepo.findByIdSystem(device.tenantId);
    if (!tenant || tenant.status === 'SUSPENDED') {
      return next(Errors.forbidden('Organization suspended'));
    }

    const model = modelsRepo.findById(device.modelId);
    if (!model) {
      return next(Errors.internal('Device model definition missing'));
    }

    req.deviceAuth = { device, tenant, model };
    return next();
  };
}
