import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { UserService } from '../services/userService.ts';
import {
  emailSchema,
  paginationQuerySchema,
  parseSortParam,
  passwordSchema,
} from '../utils/validation.ts';

const roleEnum = z.enum([
  'PLATFORM_ADMIN',
  'SUPPORT_ENGINEER',
  'FIELD_TECHNICIAN',
  'CLIENT_ADMIN',
  'CLIENT_MANAGER',
  'CLIENT_OPERATOR',
]);

const listUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  role: roleEnum.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  tenantId: z.string().trim().optional(),
  staffOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  role: roleEnum,
  tenantId: z.string().trim().nullable().optional(),
  assignedTenantIds: z.array(z.string().trim()).optional(),
  isSupervisor: z.boolean().optional(),
  password: passwordSchema,
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: roleEnum.optional(),
    isSupervisor: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.role !== undefined || v.isSupervisor !== undefined,
    { message: 'Provide at least one field to update' },
  );

const assignTenantsSchema = z.object({
  assignedTenantIds: z.array(z.string().trim()),
});

const USER_SORT_FIELDS = ['name', 'email', 'role', 'status', 'lastLoginAt', 'createdAt'] as const;

export function createUsersRouter(
  userService: UserService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    validateQuery(listUsersQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listUsersQuerySchema>;
      const sort = parseSortParam(q.sort, USER_SORT_FIELDS, 'createdAt', 'desc');
      const result = userService.list(req.tenantContext!, {
        q: q.q,
        role: q.role,
        status: q.status,
        tenantId: q.tenantId,
        staffOnly: q.staffOnly,
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

  router.post(
    '/',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    validateBody(createUserSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createUserSchema>;
      const created = await userService.create(req.tenantContext!, body, req.clientIp);
      res.status(201).json(created);
    }),
  );

  router.get(
    '/:id',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    asyncHandler(async (req, res) => {
      const user = userService.getById(req.tenantContext!, req.params.id);
      res.status(200).json(user);
    }),
  );

  router.patch(
    '/:id',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    validateBody(updateUserSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateUserSchema>;
      const updated = userService.update(req.tenantContext!, req.params.id, body, req.clientIp);
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/deactivate',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    asyncHandler(async (req, res) => {
      const updated = userService.deactivate(req.tenantContext!, req.params.id, req.clientIp);
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/reactivate',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    asyncHandler(async (req, res) => {
      const updated = userService.reactivate(req.tenantContext!, req.params.id, req.clientIp);
      res.status(200).json(updated);
    }),
  );

  router.post(
    '/:id/send-reset',
    requireRole(['PLATFORM_ADMIN', 'CLIENT_ADMIN']),
    asyncHandler(async (req, res) => {
      await userService.sendPasswordReset(
        req.tenantContext!,
        req.authUser!,
        req.params.id,
        req.clientIp,
      );
      res.status(200).json({ ok: true, message: 'Password reset link queued for delivery' });
    }),
  );

  router.put(
    '/:id/tenants',
    requireRole(['PLATFORM_ADMIN']),
    validateBody(assignTenantsSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof assignTenantsSchema>;
      const updated = userService.updateAssignedTenants(
        req.tenantContext!,
        req.params.id,
        body.assignedTenantIds,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  return router;
}
