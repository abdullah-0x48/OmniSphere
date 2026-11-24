import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { RolloutService } from '../services/rolloutService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listRolloutsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  status: z
    .enum(['PENDING_APPROVAL', 'PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'REJECTED'])
    .optional(),
  modelId: z.string().trim().optional(),
});

const previewRolloutBodySchema = z.object({
  firmwareId: z.string().trim().min(1, 'Firmware package is required'),
  targetType: z.enum(['DEVICE', 'TAG', 'SITE']),
  targetValue: z.string().trim().min(1, 'Target selection is required'),
});

const createRolloutBodySchema = previewRolloutBodySchema.extend({
  scheduledAt: z.string().trim().nullable().optional(),
});

const decideRolloutBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().max(500).optional(),
});

export function createRolloutsRouter(
  rolloutService: RolloutService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  // Read: CA, SE, CM (Section 2.2 & 10.2)
  router.get(
    '/',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_MANAGER']),
    validateQuery(listRolloutsQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listRolloutsQuerySchema>;
      const result = rolloutService.list(req.tenantContext!, {
        q: q.q ?? q.search,
        status: q.status,
        modelId: q.modelId,
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

  // Preview target cohort: CA, SE
  router.post(
    '/preview',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    validateBody(previewRolloutBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof previewRolloutBodySchema>;
      const preview = rolloutService.preview(req.tenantContext!, body);
      res.status(200).json(preview);
    }),
  );

  // Create rollout: CA, SE
  router.post(
    '/',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    validateBody(createRolloutBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createRolloutBodySchema>;
      const created = rolloutService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.get(
    '/:id',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_MANAGER']),
    asyncHandler(async (req, res) => {
      const detail = rolloutService.getDetail(req.tenantContext!, String(req.params.id));
      res.status(200).json(detail);
    }),
  );

  // Approve or reject pending rollout: CM ONLY (Section 2.2 & 8.7 #5)
  router.post(
    '/:id/decision',
    requireRole(['CLIENT_MANAGER']),
    validateBody(decideRolloutBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof decideRolloutBodySchema>;
      const updated = rolloutService.decide(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  // Cancel rollout: CA, SE
  router.post(
    '/:id/cancel',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    asyncHandler(async (req, res) => {
      const updated = rolloutService.cancel(
        req.tenantContext!,
        String(req.params.id),
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  return router;
}
