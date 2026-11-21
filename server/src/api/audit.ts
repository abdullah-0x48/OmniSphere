import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateQuery } from '../middleware/validate.ts';
import type { AuditService } from '../services/auditService.ts';
import { paginationQuerySchema, parseSortParam } from '../utils/validation.ts';

const auditQuerySchema = paginationQuerySchema.extend({
  actor: z.string().trim().max(120).optional(),
  action: z.string().trim().max(120).optional(),
  targetType: z.string().trim().max(60).optional(),
  target: z.string().trim().max(120).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  tenantId: z.string().trim().max(60).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

/**
 * Read-only audit log API (FR-SEC-03, FR-SEC-04).
 * PA sees all entries; CA sees own tenant's entries. No update or delete endpoints exist.
 */
export function createAuditRouter(
  auditService: AuditService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    validateQuery(auditQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof auditQuerySchema>;
      const sort = parseSortParam(q.sort, ['at'], 'at', 'desc');
      const result = auditService.list(req.tenantContext!, {
        actorId: q.actor,
        action: q.action,
        targetType: q.targetType,
        targetId: q.target,
        outcome: q.outcome,
        tenantId: q.tenantId,
        from: q.from,
        to: q.to,
        page: q.page,
        pageSize: q.pageSize,
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

  return router;
}
