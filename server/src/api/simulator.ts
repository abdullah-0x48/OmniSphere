import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { RoleCode } from '../../../shared/types.ts';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody } from '../middleware/validate.ts';
import type { SimulatorManager } from '../simulator/simulatorManager.ts';

const SIMULATOR_ROLES: readonly RoleCode[] = ['PLATFORM_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_ADMIN'];

const createDemoDevicesSchema = z.object({
  count: z.number().int().min(1).max(50),
  modelId: z.string().trim().min(1),
  siteId: z.string().trim().min(1),
});

const attachSchema = z.object({
  deviceId: z.string().trim().min(1, 'deviceId is required'),
  apiKey: z.string().trim().min(8, 'apiKey is required'),
  // Optional fields from pasted provisioning JSON (ignored for SSRF safety)
  apiBaseUrl: z.string().optional(),
  modelId: z.string().optional(),
  tenantCode: z.string().optional(),
});

const startSchema = z.object({
  deviceIds: z.array(z.string().min(1)).max(200).optional(),
  intervalSec: z.number().int().min(5).max(60).optional(),
  profile: z
    .enum(['NORMAL', 'DRIFTING_TEMPERATURE', 'BATTERY_DRAIN', 'RANDOM_DROPOUTS'])
    .optional(),
});

const stopSchema = z.object({
  deviceIds: z.array(z.string().min(1)).max(200).optional(),
});

const injectSchema = z.object({
  deviceId: z.string().trim().min(1),
  fault: z.enum([
    'FORCE_OFFLINE',
    'SPIKE_METRIC',
    'LOW_BATTERY',
    'FAIL_OTA_CHECKSUM',
    'FAIL_OTA_BOOT',
    'IGNORE_NEXT_CONFIG',
    'CLEAR_FAULTS',
  ]),
  metricKey: z.string().trim().min(1).max(64).optional(),
  value: z.number().finite().optional(),
});

export function createSimulatorRouter(
  simulator: SimulatorManager,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireRole(SIMULATOR_ROLES));

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      const status = simulator.getStatus(req.tenantContext!);
      res.status(200).json(status);
    }),
  );

  router.post(
    '/demo-devices',
    validateBody(createDemoDevicesSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createDemoDevicesSchema>;
      const result = simulator.createDemoDevices(req.tenantContext!, body, req.clientIp);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/attach',
    validateBody(attachSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof attachSchema>;
      const result = simulator.attachProvisioning(req.tenantContext!, body);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/start',
    validateBody(startSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof startSchema>;
      const result = simulator.start(req.tenantContext!, body);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/stop',
    validateBody(stopSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof stopSchema>;
      const result = simulator.stop(req.tenantContext!, body);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/inject',
    validateBody(injectSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof injectSchema>;
      const result = simulator.injectFault(req.tenantContext!, body);
      res.status(200).json(result);
    }),
  );

  return router;
}
