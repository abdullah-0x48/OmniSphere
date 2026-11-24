# OmniSphere – Industrial IoT Device Lifecycle and Management Platform

## 1. Project Overview

**OmniSphere** is a multi-tenant Industrial IoT (IIoT) Device Lifecycle and Management Platform built for industrial IoT service providers and their client organizations. It covers the full operational lifecycle of industrial field devices across **6 role-based personas** (`PLATFORM_ADMIN`, `SUPPORT_ENGINEER`, `FIELD_TECHNICIAN`, `CLIENT_ADMIN`, `CLIENT_MANAGER`, `CLIENT_OPERATOR`):

- Organization onboarding, tenant isolation, RBAC, and immutable audit logging
- Global device model catalogue, sites, device registry, bulk CSV import, and strict lifecycle state transitions
- Authenticated `/device/v1` REST API, live in-memory telemetry & heartbeat state, down-sampled historical charts, and offline detection
- Threshold and offline alert rules, alert de-duplication, suppression during maintenance/suspension, multi-level critical escalation, in-app notifications, and email outbox delivery
- End-to-end support tickets, field maintenance work orders (mobile-first technician view), client downtime approvals, and recurring preventive maintenance plans
- Versioned configuration profiles, SHA-256 verified firmware packages, approval-gated & scheduled OTA rollouts, and remote device commands
- Executive KPI analytics dashboards with client-side CSV and PDF exports
- Built-in fleet simulator (in-app control panel and standalone zero-dependency Node.js CLI) exercising the real `/device/v1` HTTP API

> **Storage Architecture Note:** Because the server-side Firestore Admin SDK is not provisioned in this container runtime, OmniSphere persists all relational and operational collections in SQLite (`better-sqlite3`, WAL mode) behind clean `TenantContext`-scoped repository interfaces (`server/src/repositories/`).

---

## 2. Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Web Browser / Mobile Client                         │
│     React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query +         │
│                   Recharts + jsPDF (SPA served at /)                       │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │ HTTPS / JSON (JWT Bearer + X-Tenant-Id)
                               ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   Node.js + Express Single Process (:3000)                 │
│                                                                            │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐ │
│  │  Web API (/api/v1/*) │  │ Device API           │  │ OpenAPI & Docs   │ │
│  │  • JWT + RBAC        │  │ (/device/v1/*)       │  │ • /api/docs      │ │
│  │  • TenantContext     │  │ • X-Device-Id        │  │ • /api/v1/       │ │
│  │  • Zod validation    │  │ • X-API-Key (SHA256) │  │   openapi.json   │ │
│  │  • Rate limiting     │  │ • 256KB body limit   │  └──────────────────┘ │
│  └──────────┬───────────┘  └──────────┬───────────┘                       │
│             │                         │                                    │
│  ┌──────────▼─────────────────────────▼─────────────────────────────────┐ │
│  │                    Domain Services & Pure Logic                      │ │
│  │  Auth · Tenants · Users · Sites · DeviceModels · Devices · Fleet ·   │ │
│  │  Alerts · Tickets · WorkOrders · MaintenancePlans · ConfigProfiles · │ │
│  │  Firmware · Rollouts · Reports · Notifications · Email · Audit       │ │
│  └──────────┬───────────────────────────────────┬───────────────────────┘ │
│             │                                   │                          │
│  ┌──────────▼───────────────┐    ┌──────────────▼───────────────────────┐ │
│  │ In-Memory LiveStateStore │    │ In-Process Background Jobs           │ │
│  │ • Latest readings/health │    │ • Offline detector (15s)             │ │
│  │ • 15m ring buffer        │    │ • Rollout scheduler (10s)            │ │
│  │ • 60s flush + on shutdown│    │ • Telemetry flusher (60s)            │ │
│  └──────────┬───────────────┘    │ • Critical alert escalation (60s)    │ │
│             │                    │ • Maintenance planner (5m)           │ │
│             │                    │ • Email outbox worker (30s)          │ │
│             │                    │ • Telemetry retention (daily, 90d)   │ │
│             │                    └──────────────────────────────────────┘ │
│             ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ Tenant-Scoped Repository Layer  ──▶  SQLite (data/omnisphere.db)     │ │
│  │ Local Firmware Binary Store     ──▶  Filesystem (data/firmware/)     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────▲─────────────────────────────────────────────┘
                               │ Real HTTP calls to /device/v1/*
                 ┌─────────────┴─────────────┐
                 │  In-App Simulator Manager  │   or   Standalone CLI:
                 │  (/simulator)              │   node simulator/simulator.mjs
                 └───────────────────────────┘
```

---

## 3. Module List

| Module | Backend Router / Service | Frontend Pages |
| :--- | :--- | :--- |
| **1. Identity, Access & Tenants** | `auth`, `tenants`, `users`, `platform`, `audit`, `emailOutbox` | `/login`, `/forgot-password`, `/reset-password/:token`, `/profile`, `/platform`, `/tenants`, `/tenants/:id`, `/staff`, `/users`, `/settings`, `/audit`, `/email-outbox` |
| **2. Sites, Models & Device Lifecycle** | `sites`, `deviceModels`, `devices`, `deviceLifecycle` | `/sites`, `/device-models`, `/devices`, `/devices/:id` |
| **3. Live Monitoring, Telemetry & Device API** | `deviceApi`, `fleet`, `liveStateStore`, `backgroundJobs` | `/noc`, `/dashboard`, `/live-status`, `/devices/:id` (Telemetry & Live tabs) |
| **4. Alerts, Escalation & Notifications** | `alertRules`, `alerts`, `notifications`, `emailService` | `/alerts`, `/alert-rules`, `/notifications`, header Notification Bell |
| **5. Tickets, Field Work Orders & Preventive Maintenance** | `tickets`, `workOrders`, `maintenancePlans` | `/tickets`, `/tickets/:id`, `/work-orders`, `/work-orders/:id`, `/my-work-orders`, `/approvals`, `/maintenance-plans` |
| **6. Configuration Profiles, Firmware & OTA Rollouts** | `configProfiles`, `firmware`, `rollouts` | `/config-profiles`, `/firmware`, `/rollouts`, `/rollouts/:id`, `/approvals` |
| **7. Analytics Reports & Exports** | `reports`, `kpiFormulas` | `/reports` (Availability, Alerts, Tickets & MTTR, Firmware Compliance, Maintenance, Platform Health) |
| **8. Device Simulator** | `simulator`, `simulatorManager`, `simulator/simulator.mjs` | `/simulator` + standalone CLI |

---

## 4. Environment Variables & Secrets

All configuration is read from environment variables (see `.env.example`). Never commit secrets to source control.

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | No | `3000` | HTTP port for the Express + SPA server. |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `production`, `test`). |
| `JWT_SECRET` | **Prod** | Ephemeral random (dev) | HS256 signing secret for session JWTs (min 32 chars in production). |
| `DEMO_MODE` | No | `true` | Enables login demo-accounts panel and PA demo-data reset endpoint (`POST /api/v1/platform/seed-demo`). Set `false` in production. |
| `PUBLIC_BASE_URL` | No | `http://localhost:3000` | Base URL embedded in password-reset, alert, and approval email links. |
| `DATABASE_PATH` | No | `./data/omnisphere.db` | Path to the SQLite database file. |
| `FIRMWARE_DIR` | No | `./data/firmware` | Local directory where uploaded firmware binaries are stored. |
| `TELEMETRY_RETENTION_DAYS` | No | `90` | Number of days to retain 10-minute telemetry buckets (audit logs are never purged). |
| `SMTP_HOST` | No | *(empty)* | Optional SMTP server host. When empty, OmniSphere runs in outbox-only mode (`/email-outbox`). |
| `SMTP_PORT` | No | `587` | SMTP server port. |
| `SMTP_USER` | No | *(empty)* | Optional SMTP username. |
| `SMTP_PASS` | No | *(empty)* | Optional SMTP password. |
| `SMTP_FROM` | No | `no-reply@omnisphere.local` | Sender address for outbound notifications and password resets. |

---

## 5. How to Run Locally & Deploy

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Copy environment template
cp .env.example .env

# 3. Seed the demo dataset (idempotent; creates 3 orgs, 17 users, 4 models, 36 devices, 24h telemetry, alerts, tickets, WOs, firmware)
npm run seed

# 4. Start the unified Express + Vite dev server on http://localhost:3000
npm run dev
```

Interactive OpenAPI documentation is available at **`http://localhost:3000/api/docs`** (raw spec at `/api/v1/openapi.json`).

### Production Build & Run

```bash
npm run build
NODE_ENV=production JWT_SECRET="$(openssl rand -hex 32)" DEMO_MODE=false npm start
```

### Deploy to Google Cloud Run

```bash
gcloud run deploy omnisphere \
  --source . \
  --region us-central1 \
  --port 3000 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,DEMO_MODE=false,PUBLIC_BASE_URL=https://<your-service-url>" \
  --set-secrets "JWT_SECRET=omnisphere-jwt-secret:latest"
```

---

## 6. Demo Accounts

All seeded demo accounts use the password **`Demo@12345`** (visible on `/login` when `DEMO_MODE=true`).

| Role | Code | Email | Scope / Organizations | Home Route |
| :--- | :--- | :--- | :--- | :--- |
| Platform Admin | `PA` | `admin@omnisphere.demo` | Global (Service Provider) | `/platform` |
| Support Engineer (Supervisor) | `SE` | `noc1@omnisphere.demo` | KTL, MFP | `/noc` |
| Support Engineer | `SE` | `noc2@omnisphere.demo` | MFP, SCW | `/noc` |
| Field Technician | `FT` | `tech1@omnisphere.demo` | KTL, MFP, SCW | `/my-work-orders` |
| Field Technician | `FT` | `tech2@omnisphere.demo` | KTL, MFP, SCW | `/my-work-orders` |
| Client Admin | `CA` | `admin.ktl@omnisphere.demo` | Karnaphuli Textiles Ltd (`KTL`) | `/dashboard` |
| Client Manager | `CM` | `manager.ktl@omnisphere.demo` | Karnaphuli Textiles Ltd (`KTL`) | `/dashboard` |
| Client Operator | `CO` | `operator1.ktl@omnisphere.demo` | Karnaphuli Textiles Ltd (`KTL`) | `/live-status` |
| Client Operator | `CO` | `operator2.ktl@omnisphere.demo` | Karnaphuli Textiles Ltd (`KTL`) | `/live-status` |
| Client Admin | `CA` | `admin.mfp@omnisphere.demo` | Meghna Food Processing (`MFP`) | `/dashboard` |
| Client Manager | `CM` | `manager.mfp@omnisphere.demo` | Meghna Food Processing (`MFP`) | `/dashboard` |
| Client Operator | `CO` | `operator1.mfp@omnisphere.demo` | Meghna Food Processing (`MFP`) | `/live-status` |
| Client Operator | `CO` | `operator2.mfp@omnisphere.demo` | Meghna Food Processing (`MFP`) | `/live-status` |
| Client Admin | `CA` | `admin.scw@omnisphere.demo` | Sundarbans Cement Works (`SCW`) | `/dashboard` |
| Client Manager | `CM` | `manager.scw@omnisphere.demo` | Sundarbans Cement Works (`SCW`) | `/dashboard` |
| Client Operator | `CO` | `operator1.scw@omnisphere.demo` | Sundarbans Cement Works (`SCW`) | `/live-status` |
| Client Operator | `CO` | `operator2.scw@omnisphere.demo` | Sundarbans Cement Works (`SCW`) | `/live-status` |

---

## 7. How to Run the Simulator

Every simulated device executes **real HTTP requests** over `http://localhost:3000/device/v1/*` using its `X-Device-Id` and `X-API-Key` credentials.

### Option A: In-App Simulator UI (`/simulator`)
1. Sign in as `PA`, `SE`, or `CA` and open **Simulator** in the sidebar (`/simulator`).
2. Either **Create Demo Devices** (1–50 devices for a selected model and site) or **Attach Existing Device** by pasting its one-time provisioning JSON.
3. Choose an interval (5–60s) and behavior profile (`NORMAL`, `DRIFTING_TEMPERATURE`, `BATTERY_DRAIN`, `RANDOM_DROPOUTS`) and click **Start**.
4. Inject faults on demand (`FORCE_OFFLINE`, `SPIKE_METRIC`, `LOW_BATTERY`, `FAIL_OTA_CHECKSUM`, `FAIL_OTA_BOOT`, `IGNORE_NEXT_CONFIG`, `CLEAR_FAULTS`) and watch the live HTTP request log.

### Option B: Standalone CLI Simulator (`simulator/simulator.mjs`)
Zero external npm dependencies (uses Node.js built-ins only). Accepts either a downloaded provisioning JSON file or environment variables:

```bash
# Using a downloaded provisioning JSON file from device registration
node simulator/simulator.mjs ./provisioning-dev_xxx.json

# Or using environment variables
BASE_URL=http://localhost:3000 \
DEVICE_ID=dev_xxxx \
API_KEY=os_live_xxxx \
INTERVAL_SEC=10 \
node simulator/simulator.mjs
```

The CLI simulator performs `/device/v1/handshake`, sends periodic `/device/v1/telemetry` and `/device/v1/heartbeat`, polls `/device/v1/commands`, applies config updates (`/config-ack`), simulates `RESTART` reboots, and downloads + verifies SHA-256 firmware binaries for OTA rollouts.

---

## 8. Device API (`/device/v1`) Reference Summary

All device endpoints enforce a **256 KB JSON payload limit**, per-device rate limiting, and **required headers**:

```http
X-Device-Id: <deviceId>
X-API-Key: <rawDeviceApiKey>
```

| Method & Path | Purpose | Responses |
| :--- | :--- | :--- |
| `POST /device/v1/handshake` | Authenticate device and activate `PROVISIONED -> ACTIVE`. Returns `serverTime`, `heartbeatIntervalSec`, and pending config. | `200`, `401`, `403`, `429` |
| `POST /device/v1/heartbeat` | Record liveness and optional health metrics (`batteryPct`, `rssiDbm`, `cpuPct`, `memPct`). | `202`, `401`, `403`, `429` |
| `POST /device/v1/telemetry` | Ingest timestamped metrics validated against the device model's `metricDefinitions`; triggers alert evaluation. | `202`, `400`, `401`, `403`, `429` |
| `GET /device/v1/commands` | Poll pending config profile, active OTA rollout job, and remote commands (counts as heartbeat). | `200`, `401`, `403`, `429` |
| `POST /device/v1/config-ack` | Report `APPLIED` or `FAILED` for a config version. | `200`, `400`, `401`, `403` |
| `POST /device/v1/commands/:id/ack` | Report `ACKED` or `FAILED` for a queued remote command (e.g. `RESTART`). | `200`, `400`, `401`, `403`, `404` |
| `GET /device/v1/firmware/:firmwareId/download` | Stream firmware binary (header-authenticated only, no signed URLs). Includes `X-Checksum-SHA256` and `X-Firmware-Version`. | `200`, `401`, `403`, `404` |
| `POST /device/v1/updates/:jobId/status` | Report OTA state (`DOWNLOADING`, `INSTALLING`, `VERIFIED`, `FAILED`) with optional `newVersion` / `errorCode`. | `200`, `400`, `401`, `403`, `404` |

Status rules: unknown device or bad API key returns `401` (audited as `DEVICE_AUTH_FAILED`, rate-limited to 1 per device per 5 minutes); `SUSPENDED` or `DECOMMISSIONED` devices and `SUSPENDED` tenants return `403`.

---

## 9. How to Run Tests

```bash
# Full Vitest integration & API test suite (tenant isolation, RBAC, lifecycle, telemetry, alerts, tickets/WOs, OTA, reports)
npm test

# Pure-logic unit tests (state machines, KPI formulas, alert/escalation evaluation, rollout eligibility)
npx --yes tsx --test server/src/services/*.test.ts

# TypeScript static typecheck
npm run lint

# Production bundle verification
npm run build
```

---

## 10. Requirement-to-Feature Traceability Table

| Req ID | Priority | Summary | UI Page(s) | API Endpoint(s) |
| :--- | :---: | :--- | :--- | :--- |
| `FR-ORG-01` | M | Create/edit/suspend/reactivate client organizations | `/tenants`, `/tenants/:id` | `GET/POST /api/v1/tenants`, `PATCH /api/v1/tenants/:id`, `POST /api/v1/tenants/:id/{suspend,reactivate}` |
| `FR-ORG-02` | M | Manage users and roles within scope | `/staff`, `/users` | `GET/POST /api/v1/users`, `PATCH /api/v1/users/:id`, `POST /api/v1/users/:id/{deactivate,reactivate,send-reset}` |
| `FR-ORG-03` | M | Strict multi-tenant data isolation (404 cross-tenant) | App-wide (`X-Tenant-Id` switcher for SE) | Enforced in `TenantContext` middleware & all repositories |
| `FR-ORG-04` | M | Manage sites per tenant (block delete if devices exist) | `/sites` | `GET/POST /api/v1/sites`, `PATCH/DELETE /api/v1/sites/:id` |
| `FR-ORG-05` | S | Per-tenant operational settings | `/settings`, `/tenants/:id` | `PATCH /api/v1/tenants/:id/settings` |
| `FR-DEV-01` | M | Global device model catalogue with metric definitions | `/device-models` | `GET/POST /api/v1/device-models`, `PATCH /api/v1/device-models/:id` |
| `FR-DEV-02` | M | Register single device with one-time API key & provisioning JSON | `/devices` | `POST /api/v1/devices` |
| `FR-DEV-03` | M | Bulk CSV device import with dry-run validation | `/devices` (Import modal) | `POST /api/v1/devices/import?dryRun=true|false` |
| `FR-DEV-04` | M | Paginated search & multi-facet device inventory | `/devices`, header Global Search | `GET /api/v1/devices`, `GET /api/v1/devices/tags` |
| `FR-DEV-05` | M | Device detail view & live metadata | `/devices/:id` | `GET /api/v1/devices/:id`, `GET /api/v1/devices/:id/live` |
| `FR-DEV-06` | S | Edit device metadata & bulk tag/suspend | `/devices`, `/devices/:id` | `PATCH /api/v1/devices/:id`, `POST /api/v1/devices/bulk` |
| `FR-DEV-07` | S | Rotate device API key immediately | `/devices/:id` | `POST /api/v1/devices/:id/regenerate-key` |
| `FR-LCM-01` | M | Enforce strict device lifecycle state machine | `/devices/:id` | `POST /api/v1/devices/:id/state`, `POST /device/v1/handshake` |
| `FR-LCM-02` | M | Activate PROVISIONED device on first authenticated handshake | `/devices/:id`, `/simulator` | `POST /device/v1/handshake` |
| `FR-LCM-03` | M | Suspend/resume device (reject suspended device API calls) | `/devices/:id` | `POST /api/v1/devices/:id/state` (`SUSPEND`, `RESUME`) |
| `FR-LCM-04` | M | Permanent decommission (CA-only, serial confirmation, key revoked) | `/devices/:id` | `POST /api/v1/devices/:id/state` (`DECOMMISSION`) |
| `FR-LCM-05` | S | Chronological device lifecycle & connectivity timeline | `/devices/:id` (Timeline tab) | `GET /api/v1/devices/:id/history` |
| `FR-MON-01` | M | Live heartbeat & online/offline status detection | `/noc`, `/dashboard`, `/live-status`, `/devices/:id` | `POST /device/v1/heartbeat`, `GET /api/v1/devices/:id/live`, Offline Detector job |
| `FR-MON-02` | M | Role-specific fleet overview dashboards | `/platform`, `/noc`, `/dashboard`, `/live-status` | `GET /api/v1/fleet/summary`, `GET /api/v1/fleet/overview`, `GET /api/v1/platform/overview` |
| `FR-MON-03` | S | Device health telemetry (battery, RSSI, CPU, memory) | `/devices/:id` (Live & Telemetry tabs) | `POST /device/v1/heartbeat`, `POST /device/v1/telemetry`, `GET /api/v1/devices/:id/telemetry` |
| `FR-TEL-01` | M | Authenticated telemetry ingestion validated against model | `/simulator`, CLI simulator | `POST /device/v1/telemetry` |
| `FR-TEL-02` | M | Historical telemetry charts (15m, 1h, 24h, 7d, ≤300 pts) | `/devices/:id` (Telemetry tab) | `GET /api/v1/devices/:id/telemetry` |
| `FR-TEL-03` | M | 10-minute bucket rollups + 90-day retention cleanup | Background jobs | Telemetry Flusher (60s) & Retention Job (daily) |
| `FR-TEL-04` | S | Export device telemetry as CSV | `/devices/:id` (Telemetry tab) | Client-side CSV export from `GET /api/v1/devices/:id/telemetry` |
| `FR-TEL-05` | S | Built-in simulator + standalone CLI over real HTTP | `/simulator` | `GET /api/v1/simulator/status`, `POST /api/v1/simulator/{demo-devices,attach,start,stop,inject}` |
| `FR-TEL-06` | C | *Phase 2 — Out of scope per spec (MQTT / WebSocket streaming)* | — | — |
| `FR-FW-01` | M | Versioned configuration profiles & immutable history | `/config-profiles` | `GET/POST /api/v1/config-profiles`, `PATCH /api/v1/config-profiles/:id`, `GET /api/v1/config-profiles/:id/versions` |
| `FR-FW-02` | M | Push config profile to devices/tag/site with device ack | `/config-profiles`, `/devices/:id` | `POST /api/v1/config-profiles/:id/push`, `GET /device/v1/commands`, `POST /device/v1/config-ack` |
| `FR-FW-03` | M | Firmware upload (≤5 MB), SHA-256 verification, lifecycle status | `/firmware` | `GET/POST /api/v1/firmware`, `PATCH /api/v1/firmware/:id/status` |
| `FR-FW-04` | M | OTA rollout creation, preview, CM approval gate, schedule, cancel | `/rollouts`, `/rollouts/:id`, `/approvals` | `POST /api/v1/rollouts/preview`, `GET/POST /api/v1/rollouts`, `POST /api/v1/rollouts/:id/{decision,cancel}` |
| `FR-FW-05` | M | Authenticated firmware download & per-device job tracking | `/rollouts/:id`, `/devices/:id` | `GET /device/v1/firmware/:id/download`, `POST /device/v1/updates/:jobId/status` |
| `FR-FW-06` | S | Remote `RESTART` command with device ack | `/devices/:id` | `POST /api/v1/devices/:id/commands`, `GET /device/v1/commands`, `POST /device/v1/commands/:id/ack` |
| `FR-FW-07` | C | *Phase 2 — Out of scope per spec (Canary/staged wave automation)* | — | — |
| `FR-ALR-01` | M | Threshold & offline alert rules (create/edit/toggle/delete) | `/alert-rules` | `GET/POST /api/v1/alert-rules`, `PATCH/DELETE /api/v1/alert-rules/:id` |
| `FR-ALR-02` | M | Real-time evaluation with de-duplication & suppression | Background & ingestion hook | Evaluated in `AlertService` on telemetry & offline sweeps |
| `FR-ALR-03` | M | Alert lifecycle (`OPEN -> ACKNOWLEDGED -> CLOSED`), never auto-closed | `/alerts`, `/live-status`, `/noc` | `GET /api/v1/alerts`, `POST /api/v1/alerts/:id/{acknowledge,close}` |
| `FR-ALR-04` | M | Multi-level critical escalation (`L0 -> L1 -> L2`) | `/alerts`, `/notifications` | Escalation Job (60s) |
| `FR-ALR-05` | M | In-app notifications bell & notification center | Header Bell, `/notifications` | `GET /api/v1/notifications`, `POST /api/v1/notifications/{:id/read,read-all}` |
| `FR-ALR-06` | S | Non-blocking email outbox & retry worker | `/email-outbox` | `GET /api/v1/email-outbox`, Email Worker job (30s) |
| `FR-ALR-07` | S | Alert detail inspection & audit timeline | `/alerts` (detail drawer) | `GET /api/v1/alerts/:id` |
| `FR-MNT-01` | M | Support tickets (from alert, service request, manual) & comments | `/tickets`, `/tickets/:id`, `/live-status` | `POST /api/v1/alerts/:id/ticket`, `GET/POST /api/v1/tickets`, `PATCH /api/v1/tickets/:id`, `POST /api/v1/tickets/:id/comments` |
| `FR-MNT-02` | M | Ticket resolution, client confirm/reopen, SE close with reason | `/tickets/:id` | `POST /api/v1/tickets/:id/{resolve,confirm,reopen,close}` |
| `FR-MNT-03` | M | Work orders, FT assignment, CM downtime approval gate | `/work-orders`, `/work-orders/:id`, `/approvals` | `GET/POST /api/v1/work-orders`, `PATCH /api/v1/work-orders/:id`, `POST /api/v1/work-orders/:id/{assign,decision,cancel}` |
| `FR-MNT-04` | M | Mobile-first FT execution (start -> `UNDER_MAINTENANCE`, complete -> `ACTIVE`) | `/my-work-orders`, `/work-orders/:id` | `PATCH /api/v1/work-orders/:id/checklist`, `POST /api/v1/work-orders/:id/{start,complete}` |
| `FR-MNT-05` | M | Recurring preventive maintenance plans | `/maintenance-plans` | `GET/POST /api/v1/maintenance-plans`, `PATCH/DELETE /api/v1/maintenance-plans/:id`, Planner job (5m) |
| `FR-MNT-06` | S | Automatic ticket linking & post-maintenance device timeline | `/tickets/:id`, `/work-orders/:id`, `/devices/:id` | Enforced in `WorkOrderService` & `TicketService` |
| `FR-MNT-07` | S | Approval queue for Client Managers (rollouts & downtime WOs) | `/approvals` | `POST /api/v1/work-orders/:id/decision`, `POST /api/v1/rollouts/:id/decision` |
| `FR-RPT-01` | M | Executive KPIs matching Section 13 formulas | `/reports`, `/dashboard` | `GET /api/v1/reports/kpis` |
| `FR-RPT-02` | M | Fleet Availability, Alerts, Tickets/MTTR, Firmware, Maintenance reports | `/reports` | `GET /api/v1/reports/{availability,alerts,tickets,firmware-compliance,maintenance}` |
| `FR-RPT-03` | M | Client-side CSV & PDF report exports with audit trail | `/reports` | Client-side export + `POST /api/v1/reports/export-audit` |
| `FR-RPT-04` | S | Platform-wide health report (PA only) | `/reports` (Platform Health tab), `/platform` | `GET /api/v1/reports/platform-health` |
| `FR-RPT-05` | C | *Phase 2 — Out of scope per spec (Scheduled emailed reports)* | — | — |
| `FR-SEC-01` | M | Email/password auth (bcrypt ≥12), JWT, lockout (5 tries / 15m), password reset | `/login`, `/forgot-password`, `/reset-password/:token`, `/profile` | `POST /api/v1/auth/{login,logout,change-password,forgot-password,reset-password}`, `GET /api/v1/auth/me` |
| `FR-SEC-02` | M | Role-based access control across 6 personas | `RoleGuard` in `App.tsx`, `AppShell.tsx` | `requireRole` middleware on every route |
| `FR-SEC-03` | M | Append-only audit trail (filterable, never deleted) | `/audit` | `GET /api/v1/audit` |
| `FR-SEC-04` | M | Per-device hashed API keys & constant-time auth verification | `/devices`, `/devices/:id` | `deviceAuth` middleware on `/device/v1/*` |
| `FR-SEC-05` | C | *Phase 2 — Out of scope per spec (SSO / SAML / OIDC / MFA)* | — | — |
