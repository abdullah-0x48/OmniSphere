import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { ConfigProfileService } from '../services/configProfileService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listProfilesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
});

const createProfileBodySchema = z.object({
  name: z.string().trim().min(2, 'Profile name must be at least 2 characters').max(120),
  modelId: z.string().trim().min(1, 'Device model is required'),
  payload: z.record(z.string(), z.unknown()),
});

const updateProfileBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.name !== undefined || v.payload !== undefined, {
    message: 'Provide at least name or payload to update',
  });

const pushProfileBodySchema = z.object({
  targetType: z.enum(['DEVICE', 'TAG', 'SITE']),
  targetValue: z.string().trim().optional().default(''),
  deviceIds: z.array(z.string().trim().min(1)).max(200).optional(),
});

export function createConfigProfilesRouter(
  configProfileService: ConfigProfileService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  // Read: CA, SE, CM, CO (Section 2.2 & 10.2)
  router.get(
    '/',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    validateQuery(listProfilesQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listProfilesQuerySchema>;
      const result = configProfileService.list(req.tenantContext!, {
        q: q.q ?? q.search,
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

  router.get(
    '/:id',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    asyncHandler(async (req, res) => {
      const profile = configProfileService.getById(req.tenantContext!, String(req.params.id));
      res.status(200).json(profile);
    }),
  );

  router.get(
    '/:id/versions',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    asyncHandler(async (req, res) => {
      const versions = configProfileService.listVersions(req.tenantContext!, String(req.params.id));
      res.status(200).json({ items: versions });
    }),
  );

  // Write & Push: CA, SE only
  router.post(
    '/',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    validateBody(createProfileBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createProfileBodySchema>;
      const created = configProfileService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/:id',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    validateBody(updateProfileBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateProfileBodySchema>;
      const updated = configProfileService.update(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/push',
    requireRole(['CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    validateBody(pushProfileBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof pushProfileBodySchema>;
      const result = configProfileService.push(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(result);
    }),
  );

  return router;
}
