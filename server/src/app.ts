import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { createAlertRulesRouter } from './api/alertRules.ts';
import { createAlertsRouter } from './api/alerts.ts';
import { createAuditRouter } from './api/audit.ts';
import { createAuthRouter } from './api/auth.ts';
import { createConfigProfilesRouter } from './api/configProfiles.ts';
import { createDeviceModelsRouter } from './api/deviceModels.ts';
import { createDevicesRouter } from './api/devices.ts';
import { createEmailOutboxRouter } from './api/emailOutbox.ts';
import { createFirmwareRouter } from './api/firmware.ts';
import { createFleetRouter } from './api/fleet.ts';
import { createMaintenancePlansRouter } from './api/maintenancePlans.ts';
import { createNotificationsRouter } from './api/notifications.ts';
import { createPlatformRouter } from './api/platform.ts';
import { createReportsRouter } from './api/reports.ts';
import { createRolloutsRouter } from './api/rollouts.ts';
import { createSimulatorRouter } from './api/simulator.ts';
import { createSitesRouter } from './api/sites.ts';
import { createTenantsRouter } from './api/tenants.ts';
import { createTicketsRouter } from './api/tickets.ts';
import { createUsersRouter } from './api/users.ts';
import { createWorkOrdersRouter } from './api/workOrders.ts';
import { config } from './config.ts';
import { createDeviceApiRouter } from './deviceApi/index.ts';
import { BackgroundJobsManager } from './jobs/backgroundJobs.ts';
import { createAuthMiddleware } from './middleware/auth.ts';
import { createDeviceAuthMiddleware } from './middleware/deviceAuth.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { requestContextMiddleware } from './middleware/requestContext.ts';
import { openApiSpec } from './openapi.ts';
import type { Repositories } from './repositories/index.ts';
import { AlertRuleService } from './services/alertRuleService.ts';
import { AlertService } from './services/alertService.ts';
import { AuditService } from './services/auditService.ts';
import { AuthService } from './services/authService.ts';
import { ConfigProfileService } from './services/configProfileService.ts';
import { DeviceApiService } from './services/deviceApiService.ts';
import { DeviceModelService } from './services/deviceModelService.ts';
import { DeviceService } from './services/deviceService.ts';
import { EmailService } from './services/emailService.ts';
import { FirmwareService } from './services/firmwareService.ts';
import { FleetService } from './services/fleetService.ts';
import { LiveStateStore } from './services/liveStateStore.ts';
import { MaintenancePlanService } from './services/maintenancePlanService.ts';
import { NotificationService } from './services/notificationService.ts';
import { ReportService } from './services/reportService.ts';
import { RolloutService } from './services/rolloutService.ts';
import { SiteService } from './services/siteService.ts';
import { TenantService } from './services/tenantService.ts';
import { TicketService } from './services/ticketService.ts';
import { UserService } from './services/userService.ts';
import { WorkOrderService } from './services/workOrderService.ts';
import { SimulatorManager } from './simulator/simulatorManager.ts';
import { Errors } from './utils/errors.ts';

export interface AppRuntime {
  liveState: LiveStateStore;
  backgroundJobs: BackgroundJobsManager;
  simulator: SimulatorManager;
  alertService: AlertService;
  emailService: EmailService;
  ticketService: TicketService;
  workOrderService: WorkOrderService;
  maintenancePlanService: MaintenancePlanService;
  configProfileService: ConfigProfileService;
  firmwareService: FirmwareService;
  rolloutService: RolloutService;
}

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

  // Runtime state & core services
  const liveState = new LiveStateStore(repos);
  liveState.rebuildFromDatabase();

  const auditService = new AuditService(repos.audit);
  const emailService = new EmailService(repos.emailOutbox);
  const notificationService = new NotificationService(repos.notifications, emailService);
  const alertRuleService = new AlertRuleService(repos, auditService);
  const alertService = new AlertService(repos, liveState, notificationService, auditService);

  // Wire cross-service hooks (Section 8.4 & 8.8)
  liveState.setAlertEvaluationHook(alertService);
  alertRuleService.setOnRuleChanged((ruleId) => {
    alertService.clearBreachesForRule(ruleId);
  });
  emailService.setOnPermanentFailure((item) => {
    if (item.relatedType === 'ALERT' && item.relatedId) {
      repos.alerts.markEmailDeliveryFailedSystem(item.relatedId);
    }
  });

  const authService = new AuthService(repos.users, repos.tenants, auditService, emailService);
  const tenantService = new TenantService(
    repos.tenants,
    repos.users,
    repos.audit,
    repos.emailOutbox,
    auditService,
    repos.devices,
    repos.deviceModels,
    liveState,
    repos.alerts,
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
    liveState,
    repos.telemetry,
    repos.deviceCommands,
    repos.alerts,
    repos.tickets,
    repos.workOrders,
    repos.configProfiles,
    repos.rollouts,
  );
  deviceService.setOnDeviceSuppressed((deviceId) => {
    alertService.clearBreachesForDevice(deviceId);
  });

  const ticketService = new TicketService(repos, liveState, notificationService, auditService);
  const workOrderService = new WorkOrderService(
    repos,
    liveState,
    deviceService,
    notificationService,
    auditService,
  );
  const maintenancePlanService = new MaintenancePlanService(repos, workOrderService, auditService);
  const configProfileService = new ConfigProfileService(repos, auditService);
  const firmwareService = new FirmwareService(repos, auditService);
  const rolloutService = new RolloutService(repos, liveState, notificationService, auditService);

  deviceService.setOnDeviceDecommissioned((deviceId) => {
    rolloutService.cancelQueuedJobsForDevice(deviceId);
  });

  const deviceApiService = new DeviceApiService(
    repos,
    liveState,
    auditService,
    firmwareService,
    rolloutService,
  );
  const fleetService = new FleetService(repos, liveState);
  const reportService = new ReportService(repos, liveState, auditService);
  const simulator = new SimulatorManager(repos, deviceService, liveState);
  const backgroundJobs = new BackgroundJobsManager(
    repos,
    liveState,
    alertService,
    emailService,
    maintenancePlanService,
    rolloutService,
  );

  const runtime: AppRuntime = {
    liveState,
    backgroundJobs,
    simulator,
    alertService,
    emailService,
    ticketService,
    workOrderService,
    maintenancePlanService,
    configProfileService,
    firmwareService,
    rolloutService,
  };
  app.locals.runtime = runtime;

  const requireAuth = createAuthMiddleware(authService, repos.users, repos.tenants);
  const requireDeviceAuth = createDeviceAuthMiddleware(
    repos.devices,
    repos.tenants,
    repos.deviceModels,
    auditService,
  );

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

  // Device Ingestion & Control API (/device/v1/*)
  app.use('/device/v1', createDeviceApiRouter(deviceApiService, requireDeviceAuth));

  // Web API v1 routes
  app.use('/api/v1/auth', createAuthRouter(authService, requireAuth));
  app.use('/api/v1/tenants', createTenantsRouter(tenantService, requireAuth));
  app.use('/api/v1/users', createUsersRouter(userService, requireAuth));
  app.use('/api/v1/sites', createSitesRouter(siteService, requireAuth));
  app.use('/api/v1/device-models', createDeviceModelsRouter(deviceModelService, requireAuth));
  app.use('/api/v1/devices', createDevicesRouter(deviceService, requireAuth));
  app.use('/api/v1/fleet', createFleetRouter(fleetService, requireAuth));
  app.use('/api/v1/simulator', createSimulatorRouter(simulator, requireAuth));
  app.use('/api/v1/alert-rules', createAlertRulesRouter(alertRuleService, requireAuth));
  app.use('/api/v1/alerts', createAlertsRouter(alertService, requireAuth, ticketService));
  app.use('/api/v1/tickets', createTicketsRouter(ticketService, requireAuth));
  app.use('/api/v1/work-orders', createWorkOrdersRouter(workOrderService, requireAuth));
  app.use(
    '/api/v1/maintenance-plans',
    createMaintenancePlansRouter(maintenancePlanService, requireAuth),
  );
  app.use(
    '/api/v1/config-profiles',
    createConfigProfilesRouter(configProfileService, requireAuth),
  );
  app.use('/api/v1/firmware', createFirmwareRouter(firmwareService, requireAuth));
  app.use('/api/v1/rollouts', createRolloutsRouter(rolloutService, requireAuth));
  app.use('/api/v1/notifications', createNotificationsRouter(notificationService, requireAuth));
  app.use('/api/v1/audit', createAuditRouter(auditService, requireAuth));
  app.use('/api/v1/email-outbox', createEmailOutboxRouter(emailService, requireAuth));
  app.use('/api/v1/reports', createReportsRouter(reportService, requireAuth));
  app.use('/api/v1/platform', createPlatformRouter(tenantService, repos, requireAuth, runtime));

  // Unknown API endpoints return standardized 404 JSON
  app.use('/api', (_req, _res, next) => {
    next(Errors.notFound('API endpoint not found'));
  });

  app.use(errorHandler);
  return app;
}
