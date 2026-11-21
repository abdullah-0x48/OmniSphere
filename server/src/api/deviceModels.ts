import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ALL_ROLES, type RoleCode } from '../../../shared/types.ts';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { DeviceModelService } from '../services/deviceModelService.ts';
import { paginationQuerySchema, parseSortParam } from '../utils/validation.ts';

const MODEL_WRITE_ROLES: readonly RoleCode[] = ['PLATFORM_ADMIN', 'SUPPORT_ENGINEER'];

const metricDefinitionSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Metric key is required')
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Metric key must start with a letter and use letters, digits, or _'),
  label: z.string().trim().min(1, 'Metric label is required').max(100),
  type: z.enum(['number', 'boolean', 'string']),
  unit: z.string().trim().max(24).default(''),
  min: z.number().nullable().optional().transform((v) => (v === undefined ? null : v)),
  max: z.number().nullable().optional().transform((v) => (v === undefined ? null : v)),
});

const listModelsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(120).optional(),
});

const createModelSchema = z.object({
  name: z.string().trim().min(2, 'Model name must be at least 2 characters').max(140),
  manufacturer: z.string().trim().min(2, 'Manufacturer is required').max(120),
  hardwareRevision: z.string().trim().min(1, 'Hardware revision is required').max(40),
  supportedFirmwareFamily: z
    .string()
    .trim()
    .min(1, 'Supported firmware family is required')
    .max(80),
  metrics: z.array(metricDefinitionSchema).min(1, 'Define at least one metric').max(30),
});

const updateModelSchema = z
  .object({
    name: z.string().trim().min(2).max(140).optional(),
    manufacturer: z.string().trim().min(2).max(120).optional(),
    hardwareRevision: z.string().trim().min(1).max(40).optional(),
    supportedFirmwareFamily: z.string().trim().min(1).max(80).optional(),
    metrics: z.array(metricDefinitionSchema).min(1).max(30).optional(),
  })
  .refine((v) => Object.values(v).some((val) => val !== undefined), {
    message: 'At least one field must be provided',
  });

export function createDeviceModelsRouter(
  deviceModelService: DeviceModelService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireRole(ALL_ROLES),
    validateQuery(listModelsQuerySchema),
    asyncHandler(async (_req, res) => {
      const q = res.locals.query as z.infer<typeof listModelsQuerySchema>;
      const sort = parseSortParam(
        q.sort,
        ['name', 'manufacturer', 'hardwareRevision', 'deviceCount', 'createdAt'],
        'name',
        'asc',
      );
      const result = deviceModelService.list({
        q: q.q,
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
    '/:id',
    requireRole(ALL_ROLES),
    asyncHandler(async (req, res) => {
      const model = deviceModelService.getById(req.params.id);
      res.status(200).json(model);
    }),
  );

  router.post(
    '/',
    requireRole(MODEL_WRITE_ROLES),
    validateBody(createModelSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createModelSchema>;
      const created = deviceModelService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/:id',
    requireRole(MODEL_WRITE_ROLES),
    validateBody(updateModelSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateModelSchema>;
      const updated = deviceModelService.update(
        req.tenantContext!,
        req.params.id,
        body,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  return router;
}
