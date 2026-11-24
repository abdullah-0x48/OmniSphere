import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { MaintenancePlanService } from '../services/maintenancePlanService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listPlansQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const planTemplateSchema = z.object({
  title: z.string().trim().min(3, 'Template title is required').max(200),
  instructions: z.string().trim().min(3, 'Template instructions are required').max(4000),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  downtimeRequired: z.boolean().default(false),
});

const createPlanBodySchema = z.object({
  name: z.string().trim().min(3, 'Plan name must be at least 3 characters').max(200),
  scopeType: z.enum(['DEVICE', 'TAG', 'SITE']),
  scopeValue: z.string().trim().min(1, 'Scope target is required').max(200),
  everyDays: z.coerce.number().int().min(1, 'Recurrence must be at least 1 day').max(3650),
  nextRunAt: z.string().trim().min(1, 'Next run date is required'),
  template: planTemplateSchema,
  assignedTo: z.string().trim().nullable().optional(),
  enabled: z.boolean().optional(),
});

const updatePlanBodySchema = z
  .object({
    name: z.string().trim().min(3).max(200).optional(),
    scopeType: z.enum(['DEVICE', 'TAG', 'SITE']).optional(),
    scopeValue: z.string().trim().min(1).max(200).optional(),
    everyDays: z.coerce.number().int().min(1).max(3650).optional(),
    nextRunAt: z.string().trim().min(1).optional(),
    template: planTemplateSchema.optional(),
    assignedTo: z.string().trim().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

export function createMaintenancePlansRouter(
  planService: MaintenancePlanService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireRole(['SUPPORT_ENGINEER']));

  router.get(
    '/',
    validateQuery(listPlansQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listPlansQuerySchema>;
      const result = planService.list(req.tenantContext!, {
        q: q.q,
        enabled: q.enabled,
        page: q.page,
        pageSize: q.pageSize,
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
    validateBody(createPlanBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createPlanBodySchema>;
      const created = planService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/:id',
    validateBody(updatePlanBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updatePlanBodySchema>;
      const updated = planService.update(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      planService.delete(req.tenantContext!, String(req.params.id), req.clientIp);
      res.status(204).send();
    }),
  );

  return router;
}
