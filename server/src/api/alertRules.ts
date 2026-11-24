import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ALL_ROLES } from '../../../shared/types.ts';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { AlertRuleService } from '../services/alertRuleService.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const recipientSchema = z.object({
  type: z.enum(['ROLE', 'USER']),
  role: z.enum(ALL_ROLES as [string, ...string[]]).optional(),
  userId: z.string().trim().min(1).optional(),
});

const listRulesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  kind: z.enum(['THRESHOLD', 'OFFLINE']).optional(),
  severity: z.enum(['WARNING', 'CRITICAL']).optional(),
  scopeType: z.enum(['DEVICE', 'MODEL', 'SITE']).optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const createRuleBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['THRESHOLD', 'OFFLINE']),
  metricKey: z.string().trim().min(1).max(80).nullable().optional(),
  operator: z.enum(['GT', 'GTE', 'LT', 'LTE']).nullable().optional(),
  threshold: z.number().finite().nullable().optional(),
  durationSec: z.number().int().min(0).max(86400).default(0),
  severity: z.enum(['WARNING', 'CRITICAL']),
  scopeType: z.enum(['DEVICE', 'MODEL', 'SITE']),
  scopeId: z.string().trim().min(1),
  recipients: z.array(recipientSchema).max(50).optional().default([]),
  enabled: z.boolean().optional().default(true),
});

const updateRuleBodySchema = createRuleBodySchema.partial();

export function createAlertRulesRouter(
  alertRuleService: AlertRuleService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  // Read: CA, SE, CM, CO (Section 2.2 & 7)
  router.get(
    '/',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    validateQuery(listRulesQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listRulesQuerySchema>;
      const result = alertRuleService.list(req.tenantContext!, {
        q: q.q ?? q.search,
        kind: q.kind,
        severity: q.severity,
        scopeType: q.scopeType,
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

  router.get(
    '/:id',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_OPERATOR']),
    asyncHandler(async (req, res) => {
      const rule = alertRuleService.getById(req.tenantContext!, String(req.params.id));
      res.status(200).json(rule);
    }),
  );

  // Write: CA, SE only
  router.post(
    '/',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN']),
    validateBody(createRuleBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createRuleBodySchema>;
      const created = alertRuleService.create(
        req.tenantContext!,
        {
          ...body,
          recipients: body.recipients as Array<{ type: 'ROLE' | 'USER'; role?: any; userId?: string }>,
        },
        req.clientIp,
      );
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/:id',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN']),
    validateBody(updateRuleBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateRuleBodySchema>;
      const updated = alertRuleService.update(
        req.tenantContext!,
        String(req.params.id),
        {
          ...body,
          recipients: body.recipients as
            | Array<{ type: 'ROLE' | 'USER'; role?: any; userId?: string }>
            | undefined,
        },
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  router.delete(
    '/:id',
    requireRole(['SUPPORT_ENGINEER', 'CLIENT_ADMIN']),
    asyncHandler(async (req, res) => {
      alertRuleService.delete(req.tenantContext!, String(req.params.id), req.clientIp);
      res.status(204).send();
    }),
  );

  return router;
}
