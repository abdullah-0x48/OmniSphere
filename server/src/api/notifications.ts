import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler, validateQuery } from '../middleware/validate.ts';
import type { NotificationService } from '../services/notificationService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export function createNotificationsRouter(
  notificationService: NotificationService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  // All authenticated roles see only their own notifications (Section 7 & 10.2)
  router.get(
    '/',
    validateQuery(listNotificationsQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listNotificationsQuerySchema>;
      const result = notificationService.listForCurrentUser(req.tenantContext!, {
        unreadOnly: q.unreadOnly,
        page: q.page,
        pageSize: q.pageSize,
      });
      res.status(200).json(result);
    }),
  );

  router.post(
    '/read-all',
    asyncHandler(async (req, res) => {
      const result = notificationService.markAllRead(req.tenantContext!);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
      const updated = notificationService.markRead(req.tenantContext!, String(req.params.id));
      res.status(200).json(updated);
    }),
  );

  return router;
}
