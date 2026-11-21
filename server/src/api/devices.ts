import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { RoleCode } from '../../../shared/types.ts';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { DeviceService } from '../services/deviceService.ts';
import { paginationQuerySchema, parseSortParam } from '../utils/validation.ts';

// Section 2.2 & 10.2: PA does not operate per-device inventory; all other roles read within scope
const DEVICE_READ_ROLES: readonly RoleCode[] = [
  'SUPPORT_ENGINEER',
  'FIELD_TECHNICIAN',
  'CLIENT_ADMIN',
  'CLIENT_MANAGER',
  'CLIENT_OPERATOR',
];

const DEVICE_WRITE_ROLES: readonly RoleCode[] = ['CLIENT_ADMIN', 'SUPPORT_ENGINEER'];

const listDevicesQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(120).optional(),
  siteId: z.string().max(64).optional(),
  modelId: z.string().max(64).optional(),
  state: z
    .enum(['PROVISIONED', 'ACTIVE', 'UNDER_MAINTENANCE', 'SUSPENDED', 'DECOMMISSIONED'])
    .optional(),
  connectivity: z.enum(['ONLINE', 'OFFLINE', 'UNKNOWN']).optional(),
  tag: z.string().max(64).optional(),
  firmwareVersion: z.string().max(64).optional(),
});

const registerDeviceSchema = z.object({
  name: z.string().trim().min(2, 'Device name must be at least 2 characters').max(120),
  serialNumber: z.string().trim().min(2, 'Serial number is required').max(100),
  hardwareId: z.string().trim().min(2, 'Hardware ID (MAC or IMEI) is required').max(100),
  modelId: z.string().trim().min(1, 'Device model is required'),
  siteId: z.string().trim().min(1, 'Site is required'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
  configProfileId: z.string().trim().nullable().optional(),
});

const updateDeviceSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    siteId: z.string().trim().min(1).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .refine((v) => v.name !== undefined || v.siteId !== undefined || v.tags !== undefined, {
    message: 'At least one field must be provided',
  });

const importQuerySchema = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const importBodySchema = z.object({
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(1),
        serialNumber: z.string().max(120),
        hardwareId: z.string().max(120),
        model: z.string().max(140),
        site: z.string().max(140),
        tags: z.string().max(300).optional(),
        name: z.string().max(140).optional(),
      }),
    )
    .min(1, 'Provide at least one row to import')
    .max(200, 'Maximum 200 rows per CSV import batch'),
});

const stateTransitionSchema = z.object({
  action: z.enum(['SUSPEND', 'RESUME', 'SET_UNDER_MAINTENANCE', 'SET_ACTIVE', 'DECOMMISSION']),
  reason: z.string().trim().max(500).optional(),
});

const bulkDeviceActionSchema = z.object({
  deviceIds: z.array(z.string().min(1)).min(1, 'Select at least one device').max(100),
  action: z.enum(['ADD_TAG', 'SUSPEND']),
  tag: z.string().trim().min(1).max(40).optional(),
  reason: z.string().trim().max(500).optional(),
});

export function createDevicesRouter(
  deviceService: DeviceService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireRole(DEVICE_READ_ROLES),
    validateQuery(listDevicesQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listDevicesQuerySchema>;
      const sort = parseSortParam(
        q.sort,
        [
          'name',
          'serialNumber',
          'state',
          'connectivity',
          'firmwareVersion',
          'lastSeenAt',
          'createdAt',
          'siteName',
          'modelName',
        ],
        'name',
        'asc',
      );
      const result = deviceService.list(req.tenantContext!, {
        q: q.q,
        siteId: q.siteId,
        modelId: q.modelId,
        state: q.state,
        connectivity: q.connectivity,
        tag: q.tag,
        firmwareVersion: q.firmwareVersion,
        page: q.page,
        pageSize: q.pageSize,
        sortField: sort.field,
        sortDir: sort.dir,
      });
      res.status(200).json({
        items: result.items,
        total: result.total,
        page: q.page,
        pageSize: q.pageSize,
      });
    }),
  );

  router.get(
    '/tags',
    requireRole(DEVICE_READ_ROLES),
    asyncHandler(async (req, res) => {
      const tags = deviceService.listDistinctTags(req.tenantContext!);
      res.status(200).json({ items: tags });
    }),
  );

  router.post(
    '/',
    requireRole(DEVICE_WRITE_ROLES),
    validateBody(registerDeviceSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof registerDeviceSchema>;
      const result = deviceService.register(req.tenantContext!, body, req.clientIp);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/import',
    requireRole(DEVICE_WRITE_ROLES),
    validateQuery(importQuerySchema),
    validateBody(importBodySchema),
    asyncHandler(async (req, res) => {
      const { dryRun } = res.locals.query as z.infer<typeof importQuerySchema>;
      const { rows } = req.body as z.infer<typeof importBodySchema>;
      const result = deviceService.importRows(req.tenantContext!, rows, dryRun, req.clientIp);
      res.status(dryRun ? 200 : 201).json(result);
    }),
  );

  router.post(
    '/bulk',
    requireRole(DEVICE_WRITE_ROLES),
    validateBody(bulkDeviceActionSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof bulkDeviceActionSchema>;
      const result = deviceService.bulkAction(req.tenantContext!, body, req.clientIp);
      res.status(200).json(result);
    }),
  );

  router.get(
    '/:id',
    requireRole(DEVICE_READ_ROLES),
    asyncHandler(async (req, res) => {
      const detail = deviceService.getDetail(req.tenantContext!, req.params.id);
      res.status(200).json(detail);
    }),
  );

  router.patch(
    '/:id',
    requireRole(DEVICE_WRITE_ROLES),
    validateBody(updateDeviceSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateDeviceSchema>;
      const updated = deviceService.update(req.tenantContext!, req.params.id, body, req.clientIp);
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/regenerate-key',
    requireRole(DEVICE_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const result = deviceService.regenerateKey(req.tenantContext!, req.params.id, req.clientIp);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/:id/state',
    requireRole(DEVICE_WRITE_ROLES),
    validateBody(stateTransitionSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof stateTransitionSchema>;
      const updated = deviceService.transitionState(
        req.tenantContext!,
        req.params.id,
        body.action,
        body.reason,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  router.get(
    '/:id/history',
    requireRole(DEVICE_READ_ROLES),
    asyncHandler(async (req, res) => {
      const items = deviceService.getTimeline(req.tenantContext!, req.params.id);
      res.status(200).json({ items });
    }),
  );

  return router;
}
