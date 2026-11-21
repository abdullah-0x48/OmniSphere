import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ALL_ROLES } from '../../../shared/types.ts';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { TenantService } from '../services/tenantService.ts';
import {
  emailSchema,
  paginationQuerySchema,
  parseSortParam,
  passwordSchema,
  tenantCodeSchema,
} from '../utils/validation.ts';

const listTenantsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

const settingsPatchSchema = z
  .object({
    heartbeatIntervalSec: z.number().int().min(10).max(3600).optional(),
    offlineAfterMissedIntervals: z.number().int().min(1).max(20).optional(),
    criticalAckMinutes: z.number().int().min(1).max(1440).optional(),
    requireRolloutApproval: z.boolean().optional(),
    requireMaintenanceApproval: z.boolean().optional(),
  })
  .strict();

const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'Organization name must be at least 2 characters').max(120),
  code: tenantCodeSchema,
  contactEmail: emailSchema,
  settings: settingsPatchSchema.optional(),
  adminName: z.string().trim().min(2, 'Client Admin name must be at least 2 characters').max(120),
  adminEmail: emailSchema,
  adminPassword: passwordSchema,
});

const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    contactEmail: emailSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.contactEmail !== undefined, {
    message: 'Provide at least one field to update',
  });

const suspendTenantSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

const TENANT_SORT_FIELDS = ['name', 'code', 'status', 'createdAt', 'updatedAt'] as const;

export function createTenantsRouter(
  tenantService: TenantService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireRole(ALL_ROLES),
    validateQuery(listTenantsQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listTenantsQuerySchema>;
      const sort = parseSortParam(q.sort, TENANT_SORT_FIELDS, 'name', 'asc');
      const result = tenantService.list(req.tenantContext!, {
        q: q.q,
        status: q.status,
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

  router.post(
    '/',
    requireRole(['PLATFORM_ADMIN']),
    validateBody(createTenantSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createTenantSchema>;
      const created = await tenantService.createWithFirstAdmin(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.get(
    '/:id',
    requireRole(ALL_ROLES),
    asyncHandler(async (req, res) => {
      const tenant = tenantService.getById(req.tenantContext!, req.params.id);
      res.status(200).json(tenant);
    }),
  );

  router.patch(
    '/:id',
    requireRole(['PLATFORM_ADMIN']),
    validateBody(updateTenantSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateTenantSchema>;
      const updated = tenantService.update(req.tenantContext!, req.params.id, body, req.clientIp);
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/suspend',
    requireRole(['PLATFORM_ADMIN']),
    validateBody(suspendTenantSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof suspendTenantSchema>;
      const updated = tenantService.suspend(
        req.tenantContext!,
        req.params.id,
        body.reason,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/reactivate',
    requireRole(['PLATFORM_ADMIN']),
    asyncHandler(async (req, res) => {
      const updated = tenantService.reactivate(req.tenantContext!, req.params.id, req.clientIp);
      res.status(200).json(updated);
    }),
  );

  router.patch(
    '/:id/settings',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    validateBody(settingsPatchSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof settingsPatchSchema>;
      const updated = tenantService.updateSettings(
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
