import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { createAuditRouter } from './api/audit.ts';
import { createAuthRouter } from './api/auth.ts';
import { createDeviceModelsRouter } from './api/deviceModels.ts';
import { createDevicesRouter } from './api/devices.ts';
import { createEmailOutboxRouter } from './api/emailOutbox.ts';
import { createPlatformRouter } from './api/platform.ts';
import { createSitesRouter } from './api/sites.ts';
import { createTenantsRouter } from './api/tenants.ts';
import { createUsersRouter } from './api/users.ts';
import { config } from './config.ts';
import { createAuthMiddleware } from './middleware/auth.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { requestContextMiddleware } from './middleware/requestContext.ts';
import { openApiSpec } from './openapi.ts';
import type { Repositories } from './repositories/index.ts';
import { AuditService } from './services/auditService.ts';
import { AuthService } from './services/authService.ts';
import { DeviceModelService } from './services/deviceModelService.ts';
import { DeviceService } from './services/deviceService.ts';
import { EmailService } from './services/emailService.ts';
import { SiteService } from './services/siteService.ts';
import { TenantService } from './services/tenantService.ts';
import { UserService } from './services/userService.ts';
import { Errors } from './utils/errors.ts';

export function createApp(repos: Repositories): Express {
  const app = express();

  // Security headers compatible with iframe preview and Swagger UI
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(requestContextMiddleware);

  // Services
  const auditService = new AuditService(repos.audit);
  const emailService = new EmailService(repos.emailOutbox);
  const authService = new AuthService(repos.users, repos.tenants, auditService, emailService);
  const tenantService = new TenantService(
    repos.tenants,
    repos.users,
    repos.audit,
    repos.emailOutbox,
    auditService,
    repos.devices,
    repos.deviceModels,
  );
  const userService = new UserService(repos.users, repos.tenants, auditService, authService);
  const siteService = new SiteService(repos.sites, repos.devices, auditService);
  const deviceModelService = new DeviceModelService(repos.deviceModels, auditService);
  const deviceService = new DeviceService(
    repos.devices,
    repos.sites,
    repos.deviceModels,
    repos.tenants,
    repos.audit,
    auditService,
  );

  const requireAuth = createAuthMiddleware(authService, repos.users, repos.tenants);

  // Meta & Docs
  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'omnisphere',
      timestamp: new Date().toISOString(),
      demoMode: config.demoMode,
    });
  });

  app.get('/api/v1/openapi.json', (_req, res) => {
    res.status(200).json(openApiSpec);
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // Web API v1 routes
  app.use('/api/v1/auth', createAuthRouter(authService, requireAuth));
  app.use('/api/v1/tenants', createTenantsRouter(tenantService, requireAuth));
  app.use('/api/v1/users', createUsersRouter(userService, requireAuth));
  app.use('/api/v1/sites', createSitesRouter(siteService, requireAuth));
  app.use('/api/v1/device-models', createDeviceModelsRouter(deviceModelService, requireAuth));
  app.use('/api/v1/devices', createDevicesRouter(deviceService, requireAuth));
  app.use('/api/v1/audit', createAuditRouter(auditService, requireAuth));
  app.use('/api/v1/email-outbox', createEmailOutboxRouter(emailService, requireAuth));
  app.use('/api/v1/platform', createPlatformRouter(tenantService, repos, requireAuth));

  // Unknown API endpoints return standardized 404 JSON
  app.use('/api', (_req, _res, next) => {
    next(Errors.notFound('API endpoint not found'));
  });

  app.use(errorHandler);
  return app;
}
