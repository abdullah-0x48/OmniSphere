import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { createLoginRateLimiter } from '../middleware/rateLimit.ts';
import { asyncHandler, validateBody } from '../middleware/validate.ts';
import type { AuthService } from '../services/authService.ts';
import { emailSchema, passwordSchema } from '../utils/validation.ts';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: passwordSchema,
});

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Reset token is invalid'),
  newPassword: passwordSchema,
});

export function createAuthRouter(authService: AuthService, requireAuth: RequestHandler): Router {
  const router = Router();
  const loginLimiter = createLoginRateLimiter();

  router.post(
    '/login',
    loginLimiter,
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as z.infer<typeof loginSchema>;
      const session = await authService.login(email, password, req.clientIp);
      res.status(200).json(session);
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      authService.logout(req.authUser!, req.clientIp);
      res.status(200).json({ ok: true });
    }),
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.status(200).json(authService.me(req.authUser!));
    }),
  );

  router.post(
    '/change-password',
    requireAuth,
    validateBody(changePasswordSchema),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
      await authService.changePassword(req.authUser!, currentPassword, newPassword, req.clientIp);
      res.status(200).json({ ok: true });
    }),
  );

  router.post(
    '/forgot-password',
    loginLimiter,
    validateBody(forgotPasswordSchema),
    asyncHandler(async (req, res) => {
      const { email } = req.body as z.infer<typeof forgotPasswordSchema>;
      await authService.requestPasswordReset(email, req.clientIp);
      res.status(200).json({
        ok: true,
        message: 'If an active account matches that email, a password reset link has been sent.',
      });
    }),
  );

  router.post(
    '/reset-password',
    loginLimiter,
    validateBody(resetPasswordSchema),
    asyncHandler(async (req, res) => {
      const { token, newPassword } = req.body as z.infer<typeof resetPasswordSchema>;
      await authService.resetPassword(token, newPassword, req.clientIp);
      res.status(200).json({ ok: true, message: 'Password updated. You may now sign in.' });
    }),
  );

  router.get(
    '/demo-accounts',
    asyncHandler(async (_req, res) => {
      const accounts = authService.listDemoAccounts();
      res.status(200).json({ items: accounts });
    }),
  );

  return router;
}
