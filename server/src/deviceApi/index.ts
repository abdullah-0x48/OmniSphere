import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.ts';
import type { DeviceApiService } from '../services/deviceApiService.ts';
import { Errors } from '../utils/errors.ts';

const handshakeSchema = z.object({
  firmwareVersion: z.string().trim().min(1, 'firmwareVersion is required').max(64),
});

const heartbeatSchema = z.object({
  timestamp: z.string().optional(),
  health: z.unknown().optional(),
});

const telemetrySchema = z.object({
  timestamp: z.string().min(1, 'timestamp is required'),
  metrics: z.unknown(),
  health: z.unknown().optional(),
});

const configAckSchema = z.object({
  version: z.number().int().min(1),
  status: z.enum(['APPLIED', 'FAILED']),
  error: z.string().max(500).nullable().optional(),
});

const commandAckSchema = z.object({
  status: z.enum(['ACKED', 'FAILED']),
});

const updateStatusSchema = z.object({
  status: z.enum(['DOWNLOADING', 'INSTALLING', 'VERIFIED', 'FAILED']),
  newVersion: z.string().trim().max(64).nullable().optional(),
  errorCode: z.string().trim().max(120).nullable().optional(),
});

/**
 * Mounts all `/device/v1/*` endpoints (Section 6).
 * Enforces 256 KB payload limit and X-Device-Id + X-API-Key authentication on every route.
 */
export function createDeviceApiRouter(
  deviceApiService: DeviceApiService,
  requireDeviceAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireDeviceAuth);

  router.post(
    '/handshake',
    validateBody(handshakeSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof handshakeSchema>;
      const result = deviceApiService.handshake(req.deviceAuth!, body, req.clientIp);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/heartbeat',
    validateBody(heartbeatSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof heartbeatSchema>;
      const result = deviceApiService.heartbeat(req.deviceAuth!, body);
      res.status(202).json(result);
    }),
  );

  router.post(
    '/telemetry',
    validateBody(telemetrySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof telemetrySchema>;
      const result = deviceApiService.telemetry(req.deviceAuth!, body);
      res.status(202).json(result);
    }),
  );

  router.get(
    '/commands',
    asyncHandler(async (req, res) => {
      const result = deviceApiService.pollCommands(req.deviceAuth!);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/config-ack',
    validateBody(configAckSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof configAckSchema>;
      const result = deviceApiService.configAck(req.deviceAuth!, body, req.clientIp);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/updates/:jobId/status',
    validateBody(updateStatusSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateStatusSchema>;
      const result = deviceApiService.updateJobStatus(
        req.deviceAuth!,
        req.params.jobId,
        body,
        req.clientIp,
      );
      res.status(200).json(result);
    }),
  );

  // Authenticated with X-Device-Id + X-API-Key headers only (no signed URLs — Section 6)
  router.get(
    '/firmware/:firmwareId/download',
    asyncHandler(async (req, res) => {
      const { buffer, checksumSha256, version } = deviceApiService.downloadFirmware(
        req.deviceAuth!,
        req.params.firmwareId,
      );
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Checksum-SHA256', checksumSha256);
      res.setHeader('X-Firmware-Version', version);
      res.setHeader('Content-Length', String(buffer.length));
      res.status(200).send(buffer);
    }),
  );

  router.post(
    '/commands/:id/ack',
    validateBody(commandAckSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof commandAckSchema>;
      const result = deviceApiService.commandAck(req.deviceAuth!, req.params.id, body, req.clientIp);
      res.status(200).json(result);
    }),
  );

  router.use((_req, _res, next) => {
    next(Errors.notFound('Device API endpoint not found'));
  });

  return router;
}
