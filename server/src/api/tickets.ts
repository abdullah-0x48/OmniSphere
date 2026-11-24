import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { TicketService } from '../services/ticketService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listTicketsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  status: z
    .enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'RESOLVED', 'CLOSED'])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  source: z.enum(['ALERT', 'SERVICE_REQUEST', 'INTERNAL']).optional(),
  assigneeId: z.string().trim().optional(),
  deviceId: z.string().trim().optional(),
  siteId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const createTicketBodySchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().min(5, 'Description must be at least 5 characters').max(4000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  source: z.enum(['ALERT', 'SERVICE_REQUEST', 'INTERNAL']).optional(),
  deviceId: z.string().trim().nullable().optional(),
  siteId: z.string().trim().nullable().optional(),
  assigneeId: z.string().trim().nullable().optional(),
});

const updateTicketBodySchema = z
  .object({
    assigneeId: z.string().trim().nullable().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

const addCommentBodySchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(3000),
});

const resolveTicketBodySchema = z.object({
  rootCause: z.string().trim().min(3, 'Root cause must be at least 3 characters').max(1000),
  resolutionNotes: z
    .string()
    .trim()
    .min(3, 'Resolution notes must be at least 3 characters')
    .max(3000),
});

const reopenTicketBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

const closeTicketBodySchema = z.object({
  reason: z.string().trim().min(3, 'Close reason must be at least 3 characters').max(1000),
});

export function createTicketsRouter(
  ticketService: TicketService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  // Scoped engineer list for SE assignment dropdowns (SE cannot call /api/v1/users)
  router.get(
    '/assignees',
    requireRole(['SUPPORT_ENGINEER']),
    asyncHandler(async (req, res) => {
      const items = ticketService.listAssignableEngineers(req.tenantContext!);
      res.status(200).json({ items });
    }),
  );

  // List tickets (FT automatically restricted to tickets linked to assigned work orders)
  router.get(
    '/',
    requireRole([
      'SUPPORT_ENGINEER',
      'CLIENT_ADMIN',
      'CLIENT_MANAGER',
      'CLIENT_OPERATOR',
      'FIELD_TECHNICIAN',
    ]),
    validateQuery(listTicketsQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listTicketsQuerySchema>;
      const pageSize = q.limit ?? q.pageSize;
      const result = ticketService.list(req.tenantContext!, {
        q: q.q ?? q.search,
        status: q.status,
        priority: q.priority,
        source: q.source,
        assigneeId: q.assigneeId,
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

  // Create ticket (SE creates any source; CO/CA/CM raise SERVICE_REQUEST)
  router.post(
    '/',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    validateBody(createTicketBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createTicketBodySchema>;
      const created = ticketService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.get(
    '/:id',
    requireRole([
      'SUPPORT_ENGINEER',
      'CLIENT_ADMIN',
      'CLIENT_MANAGER',
      'CLIENT_OPERATOR',
      'FIELD_TECHNICIAN',
    ]),
    asyncHandler(async (req, res) => {
      const detail = ticketService.getDetail(req.tenantContext!, String(req.params.id));
      res.status(200).json(detail);
    }),
  );

  router.patch(
    '/:id',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(updateTicketBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateTicketBodySchema>;
      const updated = ticketService.update(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/comments',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    validateBody(addCommentBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof addCommentBodySchema>;
      const detail = ticketService.addComment(
        req.tenantContext!,
        String(req.params.id),
        body.body,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/resolve',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(resolveTicketBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof resolveTicketBodySchema>;
      const detail = ticketService.resolve(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/confirm',
    requireRole(['CLIENT_OPERATOR', 'CLIENT_ADMIN']),
    asyncHandler(async (req, res) => {
      const detail = ticketService.confirm(
        req.tenantContext!,
        String(req.params.id),
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/reopen',
    requireRole(['CLIENT_OPERATOR', 'CLIENT_ADMIN', 'SUPPORT_ENGINEER']),
    validateBody(reopenTicketBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof reopenTicketBodySchema>;
      const detail = ticketService.reopen(
        req.tenantContext!,
        String(req.params.id),
        body.note,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/close',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(closeTicketBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof closeTicketBodySchema>;
      const detail = ticketService.close(
        req.tenantContext!,
        String(req.params.id),
        body.reason,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  return router;
}
