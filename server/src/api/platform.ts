import { Router, type RequestHandler } from 'express';
import type { AppRuntime } from '../app.ts';
import { config } from '../config.ts';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler } from '../middleware/validate.ts';
import type { Repositories } from '../repositories/index.ts';
import { seedAllDemoData } from '../seed/seedMilestone2.ts';
import type { TenantService } from '../services/tenantService.ts';
import { Errors } from '../utils/errors.ts';

export function createPlatformRouter(
  tenantService: TenantService,
  repos: Repositories,
  requireAuth: RequestHandler,
  runtime?: AppRuntime,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/overview',
    requireRole(['PLATFORM_ADMIN']),
    asyncHandler(async (req, res) => {
      const overview = tenantService.getPlatformOverview(req.tenantContext!);
      res.status(200).json(overview);
    }),
  );

  router.post(
    '/seed-demo',
    requireRole(['PLATFORM_ADMIN']),
    asyncHandler(async (req, res) => {
      if (!config.demoMode) {
        throw Errors.forbidden('Demo data reset is only available when DEMO_MODE is enabled');
      }
      const result = await seedAllDemoData(repos, {
        resetExisting: true,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role,
        ip: req.clientIp,
      });
      runtime?.liveState.rebuildFromDatabase();
      runtime?.simulator.syncFromDatabase();
      res.status(200).json({ ok: true, ...result });
    }),
  );

  return router;
}
