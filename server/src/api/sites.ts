import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { RoleCode } from '../../../shared/types.ts';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { SiteService } from '../services/siteService.ts';
import { paginationQuerySchema, parseSortParam } from '../utils/validation.ts';

const SITE_READ_ROLES: readonly RoleCode[] = [
  'SUPPORT_ENGINEER',
  'FIELD_TECHNICIAN',
  'CLIENT_ADMIN',
  'CLIENT_MANAGER',
  'CLIENT_OPERATOR',
];

const SITE_WRITE_ROLES: readonly RoleCode[] = ['CLIENT_ADMIN', 'SUPPORT_ENGINEER'];

const listSitesQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(120).optional(),
});

const createSiteSchema = z.object({
  name: z.string().trim().min(2, 'Site name must be at least 2 characters').max(120),
  location: z.string().trim().min(2, 'Location must be at least 2 characters').max(200),
});

const updateSiteSchema = z
  .object({
    name: z.string().trim().min(2, 'Site name must be at least 2 characters').max(120).optional(),
    location: z
      .string()
      .trim()
      .min(2, 'Location must be at least 2 characters')
      .max(200)
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.location !== undefined, {
    message: 'At least one field must be provided',
  });

export function createSitesRouter(siteService: SiteService, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireRole(SITE_READ_ROLES),
    validateQuery(listSitesQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listSitesQuerySchema>;
      const sort = parseSortParam(
        q.sort,
        ['name', 'location', 'deviceCount', 'createdAt'],
        'name',
        'asc',
      );
      const result = siteService.list(req.tenantContext!, {
        q: q.q,
        page: q.page,
        pageSize: q.pageSize,
        sortField: sort.field,
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

  router.get(
    '/:id',
    requireRole(SITE_READ_ROLES),
    asyncHandler(async (req, res) => {
      const site = siteService.getById(req.tenantContext!, req.params.id);
      res.status(200).json(site);
    }),
  );

  router.post(
    '/',
    requireRole(SITE_WRITE_ROLES),
    validateBody(createSiteSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createSiteSchema>;
      const created = siteService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/:id',
    requireRole(SITE_WRITE_ROLES),
    validateBody(updateSiteSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateSiteSchema>;
      const updated = siteService.update(req.tenantContext!, req.params.id, body, req.clientIp);
      res.status(200).json(updated);
    }),
  );

  router.delete(
    '/:id',
    requireRole(SITE_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      siteService.delete(req.tenantContext!, req.params.id, req.clientIp);
      res.status(200).json({ ok: true });
    }),
  );

  return router;
}
