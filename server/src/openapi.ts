export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'OmniSphere Industrial IoT Platform API',
    version: '1.0.0',
    description:
      'Multi-tenant Industrial IoT Device Lifecycle and Management Platform REST API covering Identity, Tenants, Users, Sites, Device Models, Device Registry & Lifecycle, Live Monitoring & Telemetry, Alerting & Escalation, Tickets & Field Work Orders, Maintenance Plans, Config Profiles, Firmware & OTA Rollouts, Analytics Reports, Simulator, Audit Trail, and Authenticated Device API (/device/v1).',
  },
  servers: [
    { url: '/api/v1', description: 'Web API v1' },
    { url: '/', description: 'Root server (used by /device/v1 endpoints)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      deviceIdAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Device-Id',
      },
      deviceApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHENTICATED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'INVALID_TRANSITION',
                  'RATE_LIMITED',
                  'INTERNAL',
                ],
              },
              message: { type: 'string' },
              details: {},
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Meta'],
        summary: 'Service health check',
        responses: { '200': { description: 'Healthy' } },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        responses: {
          '200': { description: 'Authenticated session with JWT' },
          '401': { description: 'Invalid credentials' },
          '403': { description: 'Account deactivated or organization suspended' },
          '429': { description: 'Account locked or rate limited' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        summary: 'Record logout in audit log',
        responses: { '200': { description: 'Logged out' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        summary: 'Get current user profile and accessible tenants',
        responses: { '200': { description: 'Current user context' } },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        summary: 'Change current user password',
        responses: { '200': { description: 'Password updated' } },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request a single-use password reset link',
        responses: { '200': { description: 'Reset email queued if account exists' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Complete password reset using token',
        responses: { '200': { description: 'Password reset completed' } },
      },
    },
    '/auth/demo-accounts': {
      get: {
        tags: ['Auth'],
        summary: 'List demo accounts (when DEMO_MODE=true)',
        responses: { '200': { description: 'Demo account list' } },
      },
    },
    '/tenants': {
      get: {
        tags: ['Tenants'],
        security: [{ bearerAuth: [] }],
        summary: 'List accessible organizations (scoped by role)',
        responses: { '200': { description: 'Paginated tenant list' } },
      },
      post: {
        tags: ['Tenants'],
        security: [{ bearerAuth: [] }],
        summary: 'Create organization with initial Client Admin (PA only)',
        responses: { '201': { description: 'Tenant and first Client Admin created' } },
      },
    },
    '/tenants/{id}': {
      get: {
        tags: ['Tenants'],
        security: [{ bearerAuth: [] }],
        summary: 'Get tenant detail (scoped by role)',
        responses: { '200': { description: 'Tenant details' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Tenants'],
        security: [{ bearerAuth: [] }],
        summary: 'Update tenant details (PA only)',
        responses: { '200': { description: 'Tenant updated' } },
      },
    },
    '/tenants/{id}/suspend': {
      post: {
        tags: ['Tenants'],
        security: [{ bearerAuth: [] }],
        summary: 'Suspend tenant (PA only)',
        responses: { '200': { description: 'Tenant suspended' } },
      },
    },
    '/tenants/{id}/reactivate': {
      post: {
        tags: ['Tenants'],
        security: [{ bearerAuth: [] }],
        summary: 'Reactivate suspended tenant (PA only)',
        responses: { '200': { description: 'Tenant reactivated' } },
      },
    },
    '/tenants/{id}/settings': {
      patch: {
        tags: ['Tenants'],
        security: [{ bearerAuth: [] }],
        summary: 'Update tenant settings (PA, or CA for own tenant)',
        responses: { '200': { description: 'Settings updated' } },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'List users (PA all, CA own tenant)',
        responses: { '200': { description: 'Paginated user list' } },
      },
      post: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Create user (PA: staff or CA; CA: own-tenant client roles)',
        responses: { '201': { description: 'User created' } },
      },
    },
    '/users/{id}': {
      get: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Get user by ID (404 across tenants)',
        responses: { '200': { description: 'User profile' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Update user details',
        responses: { '200': { description: 'User updated' } },
      },
    },
    '/users/{id}/deactivate': {
      post: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Deactivate user',
        responses: { '200': { description: 'User deactivated' } },
      },
    },
    '/users/{id}/reactivate': {
      post: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Reactivate user',
        responses: { '200': { description: 'User reactivated' } },
      },
    },
    '/users/{id}/send-reset': {
      post: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Send password reset link to user',
        responses: { '200': { description: 'Password reset link queued' } },
      },
    },
    '/users/{id}/tenants': {
      put: {
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Assign tenants to SE or FT (PA only)',
        responses: { '200': { description: 'Assignments updated' } },
      },
    },
    '/audit': {
      get: {
        tags: ['Audit'],
        security: [{ bearerAuth: [] }],
        summary: 'Query append-only audit log (PA all, CA own tenant)',
        responses: { '200': { description: 'Paginated audit events' } },
      },
    },
    '/email-outbox': {
      get: {
        tags: ['Email Outbox'],
        security: [{ bearerAuth: [] }],
        summary: 'View email outbox (PA, SE, CA within scope)',
        responses: { '200': { description: 'Paginated email outbox rows' } },
      },
    },
    '/platform/overview': {
      get: {
        tags: ['Platform'],
        security: [{ bearerAuth: [] }],
        summary: 'Platform health summary (PA only)',
        responses: { '200': { description: 'Platform metrics and tenant table' } },
      },
    },
    '/platform/seed-demo': {
      post: {
        tags: ['Platform'],
        security: [{ bearerAuth: [] }],
        summary: 'Reset and reseed demo dataset (PA only, requires DEMO_MODE=true)',
        responses: { '200': { description: 'Demo data reset completed' }, '403': { description: 'DEMO_MODE disabled or forbidden' } },
      },
    },
    '/sites': {
      get: {
        tags: ['Sites'],
        security: [{ bearerAuth: [] }],
        summary: 'List sites in accessible tenant scope with device counts',
        responses: { '200': { description: 'Paginated site list' } },
      },
      post: {
        tags: ['Sites'],
        security: [{ bearerAuth: [] }],
        summary: 'Create site in working tenant (CA, SE)',
        responses: { '201': { description: 'Site created' }, '409': { description: 'Duplicate site name' } },
      },
    },
    '/sites/{id}': {
      get: {
        tags: ['Sites'],
        security: [{ bearerAuth: [] }],
        summary: 'Get site detail in accessible tenant scope',
        responses: { '200': { description: 'Site detail' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Sites'],
        security: [{ bearerAuth: [] }],
        summary: 'Update site name or location (CA, SE)',
        responses: { '200': { description: 'Site updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Sites'],
        security: [{ bearerAuth: [] }],
        summary: 'Delete site (CA, SE; returns 409 if devices exist)',
        responses: { '200': { description: 'Site deleted' }, '409': { description: 'Site has devices' } },
      },
    },
    '/device-models': {
      get: {
        tags: ['Device Models'],
        security: [{ bearerAuth: [] }],
        summary: 'List global device model catalogue with metric definitions',
        responses: { '200': { description: 'Paginated model list' } },
      },
      post: {
        tags: ['Device Models'],
        security: [{ bearerAuth: [] }],
        summary: 'Create device model (PA, SE)',
        responses: { '201': { description: 'Device model created' } },
      },
    },
    '/device-models/{id}': {
      get: {
        tags: ['Device Models'],
        security: [{ bearerAuth: [] }],
        summary: 'Get device model detail by ID',
        responses: { '200': { description: 'Device model' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Device Models'],
        security: [{ bearerAuth: [] }],
        summary: 'Update device model and metric definitions (PA, SE)',
        responses: { '200': { description: 'Device model updated' } },
      },
    },
    '/devices': {
      get: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Search and filter device inventory within tenant scope',
        responses: { '200': { description: 'Paginated device inventory' } },
      },
      post: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Register device in PROVISIONED state and return one-time provisioning JSON (CA, SE)',
        responses: {
          '201': { description: 'Device registered with one-time API key' },
          '409': { description: 'Duplicate serialNumber or hardwareId' },
        },
      },
    },
    '/devices/tags': {
      get: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'List distinct device tags within accessible tenant scope',
        responses: { '200': { description: 'Distinct tag names' } },
      },
    },
    '/devices/import': {
      post: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Bulk CSV row import with dryRun validation and combined provisioning JSON (CA, SE)',
        responses: { '200': { description: 'Dry-run report' }, '201': { description: 'Import result' } },
      },
    },
    '/devices/bulk': {
      post: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Bulk add tag or suspend selected devices (CA, SE)',
        responses: { '200': { description: 'Per-device action results' } },
      },
    },
    '/devices/{id}': {
      get: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Get device detail including model metadata and allowed lifecycle transitions',
        responses: { '200': { description: 'Device detail' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Edit device name, site, or tags (CA, SE)',
        responses: { '200': { description: 'Device updated' } },
      },
    },
    '/devices/{id}/regenerate-key': {
      post: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Rotate device API key immediately and return one-time provisioning payload (CA, SE)',
        responses: { '200': { description: 'New provisioning payload' } },
      },
    },
    '/devices/{id}/state': {
      post: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Transition device lifecycle state (SUSPEND, RESUME, SET_UNDER_MAINTENANCE, SET_ACTIVE, DECOMMISSION)',
        responses: {
          '200': { description: 'State updated' },
          '403': { description: 'Forbidden (e.g., non-CA decommission)' },
          '409': { description: 'Invalid transition with allowedTransitions' },
        },
      },
    },
    '/devices/{id}/history': {
      get: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Merged chronological timeline of device state changes, connectivity, and audit events',
        responses: { '200': { description: 'Timeline events' } },
      },
    },
    '/devices/{id}/live': {
      get: {
        tags: ['Telemetry'],
        security: [{ bearerAuth: [] }],
        summary: 'Live connectivity, health, and latest metric readings from in-memory LiveState',
        responses: { '200': { description: 'Live device snapshot' } },
      },
    },
    '/devices/{id}/telemetry': {
      get: {
        tags: ['Telemetry'],
        security: [{ bearerAuth: [] }],
        summary: 'Down-sampled telemetry history for 15m, 1h, 24h, or 7d range (<= 300 points)',
        responses: { '200': { description: 'Metric and health series' } },
      },
    },
    '/devices/{id}/commands': {
      post: {
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        summary: 'Queue a remote RESTART command for an ACTIVE device (CA, SE)',
        responses: { '201': { description: 'Command queued' } },
      },
    },
    '/fleet/summary': {
      get: {
        tags: ['Fleet'],
        security: [{ bearerAuth: [] }],
        summary: 'Single-tenant fleet KPIs, state/connectivity breakdown, site table, and firmware distribution',
        responses: { '200': { description: 'Fleet summary' } },
      },
    },
    '/fleet/overview': {
      get: {
        tags: ['Fleet'],
        security: [{ bearerAuth: [] }],
        summary: 'Cross-tenant NOC overview and Needs Attention queue (SE, PA)',
        responses: { '200': { description: 'Cross-tenant overview' } },
      },
    },
    '/simulator/status': {
      get: {
        tags: ['Simulator'],
        security: [{ bearerAuth: [] }],
        summary: 'List attached simulated devices and recent HTTP event logs (PA, SE, CA)',
        responses: { '200': { description: 'Simulator status' } },
      },
    },
    '/simulator/demo-devices': {
      post: {
        tags: ['Simulator'],
        security: [{ bearerAuth: [] }],
        summary: 'Register and attach 1-50 simulated demo devices (PA, SE, CA)',
        responses: { '201': { description: 'Demo devices created and attached' } },
      },
    },
    '/simulator/attach': {
      post: {
        tags: ['Simulator'],
        security: [{ bearerAuth: [] }],
        summary: 'Attach an existing registered device via provisioning payload (PA, SE, CA)',
        responses: { '200': { description: 'Device attached' } },
      },
    },
    '/simulator/start': {
      post: {
        tags: ['Simulator'],
        security: [{ bearerAuth: [] }],
        summary: 'Start simulated devices sending real HTTP requests to /device/v1 (PA, SE, CA)',
        responses: { '200': { description: 'Devices started' } },
      },
    },
    '/simulator/stop': {
      post: {
        tags: ['Simulator'],
        security: [{ bearerAuth: [] }],
        summary: 'Stop simulated devices (PA, SE, CA)',
        responses: { '200': { description: 'Devices stopped' } },
      },
    },
    '/simulator/inject': {
      post: {
        tags: ['Simulator'],
        security: [{ bearerAuth: [] }],
        summary: 'Inject faults (FORCE_OFFLINE, SPIKE_METRIC, LOW_BATTERY, FAIL_OTA_CHECKSUM, FAIL_OTA_BOOT, IGNORE_NEXT_CONFIG, CLEAR_FAULTS) (PA, SE, CA)',
        responses: { '200': { description: 'Fault injected' } },
      },
    },
    '/device/v1/handshake': {
      servers: [{ url: '/', description: 'Device API root' }],
      post: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Authenticated device handshake (activates PROVISIONED -> ACTIVE)',
        responses: { '200': { description: 'Server time and heartbeat interval' }, '401': { description: 'Invalid credentials' }, '403': { description: 'Device or tenant suspended/decommissioned' } },
      },
    },
    '/device/v1/heartbeat': {
      servers: [{ url: '/', description: 'Device API root' }],
      post: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Authenticated device heartbeat with optional health readings',
        responses: { '202': { description: 'Heartbeat accepted' } },
      },
    },
    '/device/v1/telemetry': {
      servers: [{ url: '/', description: 'Device API root' }],
      post: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Authenticated device telemetry ingestion validated against model metrics',
        responses: { '202': { description: 'Telemetry accepted' }, '400': { description: 'Payload validation error' } },
      },
    },
    '/device/v1/commands': {
      servers: [{ url: '/', description: 'Device API root' }],
      get: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Poll pending commands (counts as heartbeat)',
        responses: { '200': { description: 'Pending config, update, and commands' } },
      },
    },
    '/device/v1/commands/{id}/ack': {
      servers: [{ url: '/', description: 'Device API root' }],
      post: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Acknowledge command execution',
        responses: { '200': { description: 'Command acknowledged' } },
      },
    },
    '/alert-rules': {
      get: {
        tags: ['Alert Rules'],
        security: [{ bearerAuth: [] }],
        summary: 'List alert rules within accessible tenant scope (SE, CA, CM, CO)',
        responses: { '200': { description: 'Paginated alert rules' } },
      },
      post: {
        tags: ['Alert Rules'],
        security: [{ bearerAuth: [] }],
        summary: 'Create threshold or offline alert rule (CA, SE)',
        responses: { '201': { description: 'Alert rule created' } },
      },
    },
    '/alert-rules/{id}': {
      get: {
        tags: ['Alert Rules'],
        security: [{ bearerAuth: [] }],
        summary: 'Get alert rule by ID',
        responses: { '200': { description: 'Alert rule' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Alert Rules'],
        security: [{ bearerAuth: [] }],
        summary: 'Update alert rule or toggle enabled flag (CA, SE)',
        responses: { '200': { description: 'Alert rule updated' } },
      },
      delete: {
        tags: ['Alert Rules'],
        security: [{ bearerAuth: [] }],
        summary: 'Delete alert rule (CA, SE)',
        responses: { '200': { description: 'Alert rule deleted' } },
      },
    },
    '/alerts': {
      get: {
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        summary: 'List alerts filtered by severity, status, deviceId, or search (SE, CA, CO, CM)',
        responses: { '200': { description: 'Paginated alerts' } },
      },
    },
    '/alerts/{id}': {
      get: {
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        summary: 'Get alert detail with metric snapshot and audit timeline',
        responses: { '200': { description: 'Alert detail' }, '404': { description: 'Not found' } },
      },
    },
    '/alerts/{id}/acknowledge': {
      post: {
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        summary: 'Acknowledge an OPEN alert (CO, CA, SE)',
        responses: { '200': { description: 'Alert acknowledged' }, '409': { description: 'Invalid transition' } },
      },
    },
    '/alerts/{id}/ack': {
      post: {
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        summary: 'Alias for /alerts/{id}/acknowledge (CO, CA, SE)',
        responses: { '200': { description: 'Alert acknowledged' }, '409': { description: 'Invalid transition' } },
      },
    },
    '/alerts/{id}/close': {
      post: {
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        summary: 'Close an OPEN or ACKNOWLEDGED alert with a required reason (SE only)',
        responses: { '200': { description: 'Alert closed' }, '409': { description: 'Invalid transition' } },
      },
    },
    '/notifications': {
      get: {
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        summary: 'List current user in-app notifications with unread count (all roles)',
        responses: { '200': { description: 'Paginated notifications and unread count' } },
      },
    },
    '/notifications/{id}/read': {
      post: {
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        summary: 'Mark one notification as read (own user only)',
        responses: { '200': { description: 'Notification marked read' }, '404': { description: 'Not found' } },
      },
    },
    '/notifications/read-all': {
      post: {
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        summary: 'Mark all unread notifications as read for current user',
        responses: { '200': { description: 'Unread notifications cleared' } },
      },
    },
    '/alerts/{id}/ticket': {
      post: {
        tags: ['Alerts', 'Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Convert an alert into a linked support ticket (SE only)',
        responses: { '201': { description: 'Ticket created and linked to alert' }, '409': { description: 'Alert already linked' } },
      },
    },
    '/tickets': {
      get: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'List tickets in tenant scope (FT restricted to tickets linked to assigned work orders)',
        responses: { '200': { description: 'Paginated tickets' } },
      },
      post: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Create ticket (SE any source; CO/CA/CM raise SERVICE_REQUEST)',
        responses: { '201': { description: 'Ticket created' } },
      },
    },
    '/tickets/assignees': {
      get: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'List assignable Support Engineers for the working tenant (SE only)',
        responses: { '200': { description: 'Assignable engineers' } },
      },
    },
    '/tickets/{id}': {
      get: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Get ticket detail with linked alert, work orders, comments, and post-maintenance warning',
        responses: { '200': { description: 'Ticket detail' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Update ticket assignee, priority, or status (SE only)',
        responses: { '200': { description: 'Ticket updated' } },
      },
    },
    '/tickets/{id}/comments': {
      post: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Add comment to ticket (client comment on WAITING_ON_CLIENT auto-resumes to IN_PROGRESS)',
        responses: { '200': { description: 'Updated ticket detail' } },
      },
    },
    '/tickets/{id}/resolve': {
      post: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Resolve ticket with rootCause and resolutionNotes (SE only)',
        responses: { '200': { description: 'Ticket resolved' } },
      },
    },
    '/tickets/{id}/confirm': {
      post: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Confirm resolved ticket -> CLOSED and close linked alert (CO, CA only)',
        responses: { '200': { description: 'Ticket closed' } },
      },
    },
    '/tickets/{id}/reopen': {
      post: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Reopen a RESOLVED ticket back to IN_PROGRESS (CO, CA, SE)',
        responses: { '200': { description: 'Ticket reopened' } },
      },
    },
    '/tickets/{id}/close': {
      post: {
        tags: ['Tickets'],
        security: [{ bearerAuth: [] }],
        summary: 'Close a RESOLVED ticket directly with a reason (SE only)',
        responses: { '200': { description: 'Ticket closed' } },
      },
    },
    '/work-orders': {
      get: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'List work orders (FT sees only own assigned work orders across assigned orgs)',
        responses: { '200': { description: 'Paginated work orders' } },
      },
      post: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Create work order with optional downtime approval gating (SE only)',
        responses: { '201': { description: 'Work order created' } },
      },
    },
    '/work-orders/technicians': {
      get: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'List assignable Field Technicians for the working tenant (SE only)',
        responses: { '200': { description: 'Assignable technicians' } },
      },
    },
    '/work-orders/{id}': {
      get: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Get work order detail with device, linked ticket, and recent device timeline',
        responses: { '200': { description: 'Work order detail' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Edit work order details/window (resets REJECTED approval to PENDING; SE only)',
        responses: { '200': { description: 'Work order updated' } },
      },
    },
    '/work-orders/{id}/checklist': {
      patch: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Update checklist item completion state (FT, SE)',
        responses: { '200': { description: 'Checklist updated' } },
      },
    },
    '/work-orders/{id}/assign': {
      post: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Assign Field Technician and optional planned window (SE only)',
        responses: { '200': { description: 'Work order assigned' } },
      },
    },
    '/work-orders/{id}/decision': {
      post: {
        tags: ['Work Orders', 'Approvals'],
        security: [{ bearerAuth: [] }],
        summary: 'Approve or reject a pending downtime maintenance window (CM only)',
        responses: { '200': { description: 'Decision recorded' } },
      },
    },
    '/work-orders/{id}/start': {
      post: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Start assigned work order -> device transitions to UNDER_MAINTENANCE (FT only)',
        responses: { '200': { description: 'Work order started' }, '409': { description: 'Approval pending or invalid state' } },
      },
    },
    '/work-orders/{id}/complete': {
      post: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Complete work order -> device returns to ACTIVE and system comment added to linked ticket (FT only)',
        responses: { '200': { description: 'Work order completed' } },
      },
    },
    '/work-orders/{id}/cancel': {
      post: {
        tags: ['Work Orders'],
        security: [{ bearerAuth: [] }],
        summary: 'Cancel PLANNED or ASSIGNED work order (SE only)',
        responses: { '200': { description: 'Work order cancelled' } },
      },
    },
    '/maintenance-plans': {
      get: {
        tags: ['Maintenance Plans'],
        security: [{ bearerAuth: [] }],
        summary: 'List recurring preventive maintenance plans (SE only)',
        responses: { '200': { description: 'Paginated maintenance plans' } },
      },
      post: {
        tags: ['Maintenance Plans'],
        security: [{ bearerAuth: [] }],
        summary: 'Create recurring preventive maintenance plan (SE only)',
        responses: { '201': { description: 'Maintenance plan created' } },
      },
    },
    '/maintenance-plans/{id}': {
      patch: {
        tags: ['Maintenance Plans'],
        security: [{ bearerAuth: [] }],
        summary: 'Update or enable/disable a maintenance plan (SE only)',
        responses: { '200': { description: 'Maintenance plan updated' } },
      },
      delete: {
        tags: ['Maintenance Plans'],
        security: [{ bearerAuth: [] }],
        summary: 'Delete a maintenance plan (SE only)',
        responses: { '204': { description: 'Maintenance plan deleted' } },
      },
    },
    '/device/v1/config-ack': {
      servers: [{ url: '/', description: 'Device API root' }],
      post: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Acknowledge applied or failed config version',
        responses: { '200': { description: 'Config ack recorded' } },
      },
    },
    '/device/v1/updates/{jobId}/status': {
      servers: [{ url: '/', description: 'Device API root' }],
      post: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Report OTA rollout job progress (DOWNLOADING, INSTALLING, VERIFIED, FAILED)',
        responses: { '200': { description: 'Job status updated' } },
      },
    },
    '/device/v1/firmware/{firmwareId}/download': {
      servers: [{ url: '/', description: 'Device API root' }],
      get: {
        tags: ['Device API'],
        security: [{ deviceIdAuth: [], deviceApiKeyAuth: [] }],
        summary: 'Authenticated firmware binary download with X-Checksum-SHA256 header (device headers only)',
        responses: {
          '200': { description: 'Firmware binary stream' },
          '403': { description: 'Device has no active rollout job for this firmware' },
        },
      },
    },
    '/config-profiles': {
      get: {
        tags: ['Config Profiles'],
        security: [{ bearerAuth: [] }],
        summary: 'List tenant-scoped versioned configuration profiles (CA, SE, CM, CO)',
        responses: { '200': { description: 'Paginated config profiles' } },
      },
      post: {
        tags: ['Config Profiles'],
        security: [{ bearerAuth: [] }],
        summary: 'Create a configuration profile at version 1 (CA, SE)',
        responses: { '201': { description: 'Config profile created' } },
      },
    },
    '/config-profiles/{id}': {
      get: {
        tags: ['Config Profiles'],
        security: [{ bearerAuth: [] }],
        summary: 'Get configuration profile detail',
        responses: { '200': { description: 'Config profile' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Config Profiles'],
        security: [{ bearerAuth: [] }],
        summary: 'Edit configuration profile and increment version number (CA, SE)',
        responses: { '200': { description: 'Updated config profile' } },
      },
    },
    '/config-profiles/{id}/versions': {
      get: {
        tags: ['Config Profiles'],
        security: [{ bearerAuth: [] }],
        summary: 'List immutable version history for a configuration profile',
        responses: { '200': { description: 'Version history' } },
      },
    },
    '/config-profiles/{id}/push': {
      post: {
        tags: ['Config Profiles'],
        security: [{ bearerAuth: [] }],
        summary: 'Push configuration profile to device(s), tag, or site (CA, SE)',
        responses: { '200': { description: 'Per-device push results' } },
      },
    },
    '/firmware': {
      get: {
        tags: ['Firmware'],
        security: [{ bearerAuth: [] }],
        summary: 'List firmware packages (PA/SE all; CA/CM RELEASED for tenant models)',
        responses: { '200': { description: 'Paginated firmware packages' } },
      },
      post: {
        tags: ['Firmware'],
        security: [{ bearerAuth: [] }],
        summary: 'Upload firmware binary (multipart, max 5 MB) with server SHA-256 verification (PA, SE)',
        responses: { '201': { description: 'Firmware package created in DRAFT' } },
      },
    },
    '/firmware/{id}': {
      get: {
        tags: ['Firmware'],
        security: [{ bearerAuth: [] }],
        summary: 'Get firmware package metadata by ID',
        responses: { '200': { description: 'Firmware package' }, '404': { description: 'Not found' } },
      },
    },
    '/firmware/{id}/status': {
      patch: {
        tags: ['Firmware'],
        security: [{ bearerAuth: [] }],
        summary: 'Transition firmware status (DRAFT -> RELEASED/WITHDRAWN, RELEASED -> WITHDRAWN) (PA, SE)',
        responses: { '200': { description: 'Updated firmware package' } },
      },
    },
    '/rollouts': {
      get: {
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        summary: 'List OTA rollouts in tenant scope (CA, SE, CM)',
        responses: { '200': { description: 'Paginated rollouts' } },
      },
      post: {
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        summary: 'Create OTA rollout with optional approval gating and schedule (CA, SE)',
        responses: { '201': { description: 'Rollout created' } },
      },
    },
    '/rollouts/preview': {
      post: {
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        summary: 'Preview eligible included devices and excluded devices with reasons (CA, SE)',
        responses: { '200': { description: 'Rollout target preview' } },
      },
    },
    '/rollouts/{id}': {
      get: {
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        summary: 'Get rollout detail with firmware metadata and per-device jobs',
        responses: { '200': { description: 'Rollout detail' }, '404': { description: 'Not found' } },
      },
    },
    '/rollouts/{id}/decision': {
      post: {
        tags: ['Rollouts', 'Approvals'],
        security: [{ bearerAuth: [] }],
        summary: 'Approve or reject a PENDING_APPROVAL rollout (CM only)',
        responses: { '200': { description: 'Decision recorded' } },
      },
    },
    '/rollouts/{id}/cancel': {
      post: {
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        summary: 'Cancel rollout (cancels QUEUED jobs; in-flight DOWNLOADING/INSTALLING finish) (CA, SE)',
        responses: { '200': { description: 'Rollout cancelled' } },
      },
    },
    '/reports/kpis': {
      get: {
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        summary: 'Executive KPI summary (Availability %, MTTR, Alerts, Open Tickets, Firmware Compliance %, Maintenance Completion %)',
        responses: { '200': { description: 'KPI summary matching Section 13 formulas' } },
      },
    },
    '/reports/availability': {
      get: {
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        summary: 'Fleet availability % with per-site, per-model, and per-device breakdowns',
        responses: { '200': { description: 'Availability report' } },
      },
    },
    '/reports/alerts': {
      get: {
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        summary: 'Alert counts by severity, daily UTC trend series, and alert details in range',
        responses: { '200': { description: 'Alerts report' } },
      },
    },
    '/reports/tickets': {
      get: {
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        summary: 'MTTR hours, open tickets at range end by priority, and ticket details',
        responses: { '200': { description: 'Tickets & MTTR report' } },
      },
    },
    '/reports/firmware-compliance': {
      get: {
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        summary: 'Firmware compliance % against latest RELEASED version per model and non-compliant device list',
        responses: { '200': { description: 'Firmware compliance report' } },
      },
    },
    '/reports/maintenance': {
      get: {
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        summary: 'Maintenance completion rate % (excluding cancelled) and scheduled work orders in range',
        responses: { '200': { description: 'Maintenance completion report' } },
      },
    },
    '/reports/platform-health': {
      get: {
        tags: ['Reports', 'Platform'],
        security: [{ bearerAuth: [] }],
        summary: 'Platform-wide health telemetry, tenants, device states, firmware packages, and email failures (PA only)',
        responses: { '200': { description: 'Platform health report' }, '403': { description: 'PA only' } },
      },
    },
    '/reports/export-audit': {
      post: {
        tags: ['Reports', 'Audit'],
        security: [{ bearerAuth: [] }],
        summary: 'Record REPORT_EXPORTED audit entry when exporting CSV or PDF from browser',
        responses: { '201': { description: 'Audit recorded' } },
      },
    },
  },
};

