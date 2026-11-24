import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { ReportService } from '../services/reportService.ts';

const reportFilterQuerySchema = z.object({
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  siteId: z.string().trim().max(80).optional(),
  modelId: z.string().trim().max(80).optional(),
  tenantId: z.string().trim().max(80).optional(),
});

const reportExportAuditBodySchema = z.object({
  format: z.enum(['CSV', 'PDF']),
  reportType: z.string().trim().min(1).max(60),
  from: z.string().trim().min(1).max(40),
  to: z.string().trim().min(1).max(40),
  siteId: z.string().trim().max(80).nullable().optional(),
  modelId: z.string().trim().max(80).nullable().optional(),
  tenantId: z.string().trim().max(80).nullable().optional(),
  rowCount: z.number().int().min(0).max(100_000).optional(),
});

const OPERATIONAL_REPORT_ROLES = [
  'PLATFORM_ADMIN',
  'SUPPORT_ENGINEER',
  'CLIENT_ADMIN',
  'CLIENT_MANAGER',
  'CLIENT_OPERATOR',
] as const;

const FULL_REPORT_ROLES = [
  'PLATFORM_ADMIN',
  'SUPPORT_ENGINEER',
  'CLIENT_ADMIN',
  'CLIENT_MANAGER',
] as const;

/**
 * Reports & Platform Health API (/api/v1/reports — Section 7 & Section 13).
 */
export function createReportsRouter(
  reportService: ReportService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/kpis',
    requireRole([...OPERATIONAL_REPORT_ROLES]),
    validateQuery(reportFilterQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof reportFilterQuerySchema>;
      const data = reportService.getKpis(req.tenantContext!, q);
      res.status(200).json(data);
    }),
  );

  router.get(
    '/availability',
    requireRole([...OPERATIONAL_REPORT_ROLES]),
    validateQuery(reportFilterQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof reportFilterQuerySchema>;
      const data = reportService.getAvailabilityReport(req.tenantContext!, q);
      res.status(200).json(data);
    }),
  );

  router.get(
    '/alerts',
    requireRole([...OPERATIONAL_REPORT_ROLES]),
    validateQuery(reportFilterQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof reportFilterQuerySchema>;
      const data = reportService.getAlertsReport(req.tenantContext!, q);
      res.status(200).json(data);
    }),
  );

  router.get(
    '/tickets',
    requireRole([...OPERATIONAL_REPORT_ROLES]),
    validateQuery(reportFilterQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof reportFilterQuerySchema>;
      const data = reportService.getTicketsReport(req.tenantContext!, q);
      res.status(200).json(data);
    }),
  );

  router.get(
    '/firmware-compliance',
    requireRole([...FULL_REPORT_ROLES]),
    validateQuery(reportFilterQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof reportFilterQuerySchema>;
      const data = reportService.getFirmwareComplianceReport(req.tenantContext!, q);
      res.status(200).json(data);
    }),
  );

  router.get(
    '/maintenance',
    requireRole([...FULL_REPORT_ROLES]),
    validateQuery(reportFilterQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof reportFilterQuerySchema>;
      const data = reportService.getMaintenanceReport(req.tenantContext!, q);
      res.status(200).json(data);
    }),
  );

  router.get(
    '/platform-health',
    requireRole(['PLATFORM_ADMIN']),
    asyncHandler(async (req, res) => {
      const data = reportService.getPlatformHealth(req.tenantContext!);
      res.status(200).json(data);
    }),
  );

  router.post(
    '/export-audit',
    requireRole([...OPERATIONAL_REPORT_ROLES]),
    validateBody(reportExportAuditBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof reportExportAuditBodySchema>;
      const result = reportService.recordExportAudit(req.tenantContext!, body, req.clientIp);
      res.status(201).json(result);
    }),
  );

  return router;
}
