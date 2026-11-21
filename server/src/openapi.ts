export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'OmniSphere Industrial IoT Platform API',
    version: '1.0.0',
    description:
      'Multi-tenant Industrial IoT Device Lifecycle and Management Platform REST API (Milestone 1: Identity, Tenants, Users, Audit, Email Outbox).',
  },
  servers: [{ url: '/api/v1', description: 'Web API v1' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
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
  },
};
