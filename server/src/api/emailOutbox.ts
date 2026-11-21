import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateQuery } from '../middleware/validate.ts';
import type { EmailService } from '../services/emailService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const outboxQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['QUEUED', 'SENT', 'FAILED']).optional(),
  tenantId: z.string().trim().optional(),
});

export function createEmailOutboxRouter(
  emailService: EmailService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireRole(['PLATFORM_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_ADMIN']),
    validateQuery(outboxQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof outboxQuerySchema>;
      const result = emailService.listOutbox(req.tenantContext!, {
        status: q.status,
        tenantId: q.tenantId,
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

  return router;
}
