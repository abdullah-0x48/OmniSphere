import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { AlertService } from '../services/alertService.ts';
import type { TicketService } from '../services/ticketService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listAlertsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  severity: z.enum(['WARNING', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'CLOSED']).optional(),
  deviceId: z.string().trim().optional(),
  siteId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const closeAlertBodySchema = z.object({
  reason: z.string().trim().min(3, 'Close reason must be at least 3 characters').max(500),
});

export function createAlertsRouter(
  alertService: AlertService,
  requireAuth: RequestHandler,
  ticketService?: TicketService,
): Router {
  const router = Router();
  router.use(requireAuth);

  // Read: SE, CA, CO, CM (Section 2.2 & 10.2)
  router.get(
    '/',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    validateQuery(listAlertsQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listAlertsQuerySchema>;
      const pageSize = q.limit ?? q.pageSize;
      const result = alertService.list(req.tenantContext!, {
        q: q.q ?? q.search,
        severity: q.severity,
        status: q.status,
        deviceId: q.deviceId,
        siteId: q.siteId,
        page: q.page,
        pageSize,
      });
      res.status(200).json({
        items: result.items,
        total: result.total,
        page: q.page,
        pageSize,
      });
    }),
  );

  router.get(
    '/:id',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    asyncHandler(async (req, res) => {
      const detail = alertService.getDetail(req.tenantContext!, String(req.params.id));
      res.status(200).json(detail);
    }),
  );

  // Acknowledge: CO, CA, SE (CM is read-only per Section 2.2 & 7)
  const handleAck = asyncHandler(async (req, res) => {
    const updated = alertService.acknowledge(
      req.tenantContext!,
      String(req.params.id),
      req.clientIp,
    );
    res.status(200).json(updated);
  });

  router.post(
    '/:id/ack',
    requireRole(['CLIENT_OPERATOR', 'CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    handleAck,
  );
  router.post(
    '/:id/acknowledge',
    requireRole(['CLIENT_OPERATOR', 'CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    handleAck,
  );

  // Convert alert to ticket: SE only (Section 5.3 & 8.5)
  if (ticketService) {
    router.post(
      '/:id/ticket',
      requireRole(['SUPPORT_ENGINEER']),
      asyncHandler(async (req, res) => {
        const ticket = ticketService.createFromAlert(
          req.tenantContext!,
          String(req.params.id),
          req.clientIp,
        );
        res.status(201).json(ticket);
      }),
    );
  }

  // Close manually with reason: SE only (Section 5.3 & 7)
  router.post(
    '/:id/close',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(closeAlertBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof closeAlertBodySchema>;
      const updated = alertService.close(
        req.tenantContext!,
        String(req.params.id),
        body.reason,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  return router;
}
