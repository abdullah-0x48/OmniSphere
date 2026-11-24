import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { WorkOrderService } from '../services/workOrderService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listWorkOrdersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  status: z.enum(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  type: z.enum(['CORRECTIVE', 'PREVENTIVE']).optional(),
  approvalStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  assignedTo: z.string().trim().optional(),
  deviceId: z.string().trim().optional(),
  ticketId: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const checklistInputItemSchema = z.object({
  id: z.string().trim().optional(),
  text: z.string().trim().min(1).max(300),
  done: z.boolean().optional(),
});

const createWorkOrderBodySchema = z.object({
  deviceId: z.string().trim().min(1, 'Device is required'),
  ticketId: z.string().trim().nullable().optional(),
  type: z.enum(['CORRECTIVE', 'PREVENTIVE']).default('CORRECTIVE'),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  instructions: z.string().trim().min(3, 'Instructions must be at least 3 characters').max(4000),
  checklist: z.array(checklistInputItemSchema).max(50).optional(),
  assignedTo: z.string().trim().nullable().optional(),
  plannedStart: z.string().trim().nullable().optional(),
  plannedEnd: z.string().trim().nullable().optional(),
  downtimeRequired: z.boolean().default(false),
});

const updateWorkOrderBodySchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    instructions: z.string().trim().min(3).max(4000).optional(),
    checklist: z.array(checklistInputItemSchema).max(50).optional(),
    plannedStart: z.string().trim().nullable().optional(),
    plannedEnd: z.string().trim().nullable().optional(),
    downtimeRequired: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

const assignWorkOrderBodySchema = z.object({
  assignedTo: z.string().trim().nullable(),
  plannedStart: z.string().trim().nullable().optional(),
  plannedEnd: z.string().trim().nullable().optional(),
});

const decisionBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(1000).optional(),
});

const updateChecklistBodySchema = z.object({
  checklist: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        text: z.string().trim().max(300).optional(),
        done: z.boolean(),
      }),
    )
    .max(50),
});

const completeWorkOrderBodySchema = z.object({
  actionsTaken: z.string().trim().min(3, 'Actions taken must be at least 3 characters').max(4000),
  partsReplaced: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  notes: z.string().trim().max(3000).optional(),
  timeSpentMin: z.coerce.number().int().min(1, 'Time spent must be at least 1 minute').max(10000),
  outcome: z.enum(['FIXED', 'PARTIAL', 'REPLACED']),
  checklist: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        done: z.boolean(),
      }),
    )
    .max(50)
    .optional(),
});

const cancelWorkOrderBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export function createWorkOrdersRouter(
  workOrderService: WorkOrderService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  // Scoped Field Technician list for SE assignment dropdowns
  router.get(
    '/technicians',
    requireRole(['SUPPORT_ENGINEER']),
    asyncHandler(async (req, res) => {
      const items = workOrderService.listAssignableTechnicians(req.tenantContext!);
      res.status(200).json({ items });
    }),
  );

  // List work orders (FT strictly sees own assigned WOs across assigned orgs)
  router.get(
    '/',
    requireRole([
      'SUPPORT_ENGINEER',
      'FIELD_TECHNICIAN',
      'CLIENT_ADMIN',
      'CLIENT_MANAGER',
      'CLIENT_OPERATOR',
    ]),
    validateQuery(listWorkOrdersQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listWorkOrdersQuerySchema>;
      const pageSize = q.limit ?? q.pageSize;
      const result = workOrderService.list(req.tenantContext!, {
        q: q.q ?? q.search,
        status: q.status,
        type: q.type,
        approvalStatus: q.approvalStatus,
        assignedTo: q.assignedTo,
        deviceId: q.deviceId,
        ticketId: q.ticketId,
        from: q.from,
        to: q.to,
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

  router.post(
    '/',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(createWorkOrderBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createWorkOrderBodySchema>;
      const created = workOrderService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.get(
    '/:id',
    requireRole([
      'SUPPORT_ENGINEER',
      'FIELD_TECHNICIAN',
      'CLIENT_ADMIN',
      'CLIENT_MANAGER',
      'CLIENT_OPERATOR',
    ]),
    asyncHandler(async (req, res) => {
      const detail = workOrderService.getDetail(req.tenantContext!, String(req.params.id));
      res.status(200).json(detail);
    }),
  );

  router.patch(
    '/:id',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(updateWorkOrderBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateWorkOrderBodySchema>;
      const detail = workOrderService.update(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.patch(
    '/:id/checklist',
    requireRole(['FIELD_TECHNICIAN', 'SUPPORT_ENGINEER']),
    validateBody(updateChecklistBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateChecklistBodySchema>;
      const detail = workOrderService.updateChecklist(
        req.tenantContext!,
        String(req.params.id),
        body.checklist,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/assign',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(assignWorkOrderBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof assignWorkOrderBodySchema>;
      const detail = workOrderService.assign(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/decision',
    requireRole(['CLIENT_MANAGER']),
    validateBody(decisionBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof decisionBodySchema>;
      const detail = workOrderService.decide(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/start',
    requireRole(['FIELD_TECHNICIAN']),
    asyncHandler(async (req, res) => {
      const detail = workOrderService.start(
        req.tenantContext!,
        String(req.params.id),
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/complete',
    requireRole(['FIELD_TECHNICIAN']),
    validateBody(completeWorkOrderBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof completeWorkOrderBodySchema>;
      const detail = workOrderService.complete(
        req.tenantContext!,
        String(req.params.id),
        body,
        req.clientIp,
      );
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/:id/cancel',
    requireRole(['SUPPORT_ENGINEER']),
    validateBody(cancelWorkOrderBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof cancelWorkOrderBodySchema>;
      const detail = workOrderService.cancel(
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
