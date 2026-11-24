import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.ts';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate.ts';
import type { FirmwareService } from '../services/firmwareService.ts';
import { MAX_FIRMWARE_BYTES } from '../services/otaAndConfigLogic.ts';
import { Errors } from '../utils/errors.ts';
import { paginationQuerySchema } from '../utils/validation.ts';

const listFirmwareQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'RELEASED', 'WITHDRAWN']).optional(),
});

const changeStatusBodySchema = z.object({
  status: z.enum(['RELEASED', 'WITHDRAWN']),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FIRMWARE_BYTES,
    files: 1,
  },
});

function handleFirmwareUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          Errors.validation('Firmware binary exceeds the maximum 5 MB file size limit', {
            field: 'file',
          }),
        );
        return;
      }
      next(Errors.validation(`Upload error: ${err.message}`, { field: 'file' }));
      return;
    }
    next(err);
  });
}

export function createFirmwareRouter(
  firmwareService: FirmwareService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  // Read: PA, SE (all packages); CA, CM (RELEASED for tenant's models only)
  router.get(
    '/',
    requireRole(['PLATFORM_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER']),
    validateQuery(listFirmwareQuerySchema),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as z.infer<typeof listFirmwareQuerySchema>;
      const result = firmwareService.list(req.tenantContext!, {
        q: q.q ?? q.search,
        modelId: q.modelId,
        status: q.status,
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
    requireRole(['PLATFORM_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_ADMIN', 'CLIENT_MANAGER']),
    asyncHandler(async (req, res) => {
      const pkg = firmwareService.getById(req.tenantContext!, String(req.params.id));
      res.status(200).json(pkg);
    }),
  );

  // Upload: PA, SE only (multipart/form-data)
  router.post(
    '/',
    requireRole(['PLATFORM_ADMIN', 'SUPPORT_ENGINEER']),
    handleFirmwareUpload,
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) {
        throw Errors.validation('Firmware binary file is required', { field: 'file' });
      }
      const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : '';
      const version = typeof req.body?.version === 'string' ? req.body.version : '';
      const releaseNotes =
        typeof req.body?.releaseNotes === 'string' ? req.body.releaseNotes : '';
      const expectedChecksumSha256 =
        typeof req.body?.checksumSha256 === 'string'
          ? req.body.checksumSha256
          : typeof req.body?.expectedChecksumSha256 === 'string'
            ? req.body.expectedChecksumSha256
            : undefined;

      const created = firmwareService.upload(
        req.tenantContext!,
        {
          modelId,
          version,
          releaseNotes,
          expectedChecksumSha256,
          fileBuffer: file.buffer,
        },
        req.clientIp,
      );
      res.status(201).json(created);
    }),
  );

  // Release / Withdraw: PA, SE only
  router.patch(
    '/:id/status',
    requireRole(['PLATFORM_ADMIN', 'SUPPORT_ENGINEER']),
    validateBody(changeStatusBodySchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof changeStatusBodySchema>;
      const updated = firmwareService.changeStatus(
        req.tenantContext!,
        String(req.params.id),
        body.status,
        req.clientIp,
      );
      res.status(200).json(updated);
    }),
  );

  return router;
}
