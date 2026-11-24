import { Router, type RequestHandler } from 'express';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler } from '../middleware/validate.ts';
import type { FleetService } from '../services/fleetService.ts';

export function createFleetRouter(fleetService: FleetService, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/summary',
    requireRole(['CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_OPERATOR', 'SUPPORT_ENGINEER']),
    asyncHandler(async (req, res) => {
      const summary = fleetService.getSummary(req.tenantContext!);
      res.status(200).json(summary);
    }),
  );

  router.get(
    '/overview',
    requireRole(['SUPPORT_ENGINEER', 'PLATFORM_ADMIN']),
    asyncHandler(async (req, res) => {
      const overview = fleetService.getOverview(req.tenantContext!);
      res.status(200).json(overview);
    }),
  );

  return router;
}
