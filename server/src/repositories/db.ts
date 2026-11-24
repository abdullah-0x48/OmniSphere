import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export function createDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  initializeSchema(db);
  return db;
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
      contact_email TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN (
        'PLATFORM_ADMIN',
        'SUPPORT_ENGINEER',
        'FIELD_TECHNICIAN',
        'CLIENT_ADMIN',
        'CLIENT_MANAGER',
        'CLIENT_OPERATOR'
      )),
      tenant_id TEXT NULL REFERENCES tenants(id),
      assigned_tenant_ids_json TEXT NOT NULL DEFAULT '[]',
      is_supervisor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
      password_hash TEXT NOT NULL,
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT NULL,
      password_reset_token_hash TEXT NULL,
      password_reset_expires_at TEXT NULL,
      last_login_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(password_reset_token_hash);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      tenant_id TEXT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
      ip TEXT NOT NULL,
      details_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_at ON audit_logs(at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_at ON audit_logs(tenant_id, at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);

    -- Append-only enforcement at the database layer (FR-SEC-03)
    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit_logs is append-only: updates are forbidden');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit_logs is append-only: deletes are forbidden');
    END;

    CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NULL,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NULL,
      last_error TEXT NULL,
      related_type TEXT NULL,
      related_id TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_outbox_tenant ON email_outbox(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);

    CREATE TABLE IF NOT EXISTS counters (
      id TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );

    -- Milestone 2: Sites (FR-ORG-05)
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, name COLLATE NOCASE)
    );

    CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);

    -- Milestone 2: Device Models (FR-DEV-01, global)
    CREATE TABLE IF NOT EXISTS device_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      manufacturer TEXT NOT NULL,
      hardware_revision TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      supported_firmware_family TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Milestone 2: Devices (FR-DEV-02 to 07, FR-LCM-01 to 05)
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      model_id TEXT NOT NULL REFERENCES device_models(id),
      name TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      hardware_id TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL CHECK (state IN (
        'PROVISIONED',
        'ACTIVE',
        'UNDER_MAINTENANCE',
        'SUSPENDED',
        'DECOMMISSIONED'
      )),
      connectivity TEXT NOT NULL CHECK (connectivity IN ('ONLINE', 'OFFLINE', 'UNKNOWN')),
      last_seen_at TEXT NULL,
      firmware_version TEXT NULL,
      api_key_hash TEXT NULL,
      api_key_last4 TEXT NULL,
      config_json TEXT NOT NULL,
      latest_metrics_json TEXT NOT NULL DEFAULT '{}',
      latest_health_json TEXT NOT NULL DEFAULT '{}',
      invalid_payload_count INTEGER NOT NULL DEFAULT 0,
      decommissioned_at TEXT NULL,
      decommission_reason TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_devices_tenant_site ON devices(tenant_id, site_id);
    CREATE INDEX IF NOT EXISTS idx_devices_tenant_model ON devices(tenant_id, model_id);
    CREATE INDEX IF NOT EXISTS idx_devices_tenant_state ON devices(tenant_id, state);
    CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial_number);
    CREATE INDEX IF NOT EXISTS idx_devices_hw ON devices(hardware_id);

    -- Platform-wide uniqueness table for serialNumber and hardwareId (Section 4)
    CREATE TABLE IF NOT EXISTS unique_keys (
      key_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_unique_keys_device ON unique_keys(device_id);

    -- Device lifecycle state history (Section 4 & 5.1)
    CREATE TABLE IF NOT EXISTS device_state_history (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      from_state TEXT NULL,
      to_state TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dsh_device_at ON device_state_history(device_id, at);
    CREATE INDEX IF NOT EXISTS idx_dsh_tenant ON device_state_history(tenant_id);

    -- Connectivity transitions for timeline and availability KPIs (Section 4)
    CREATE TABLE IF NOT EXISTS connectivity_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      state TEXT NOT NULL CHECK (state IN ('ONLINE', 'OFFLINE')),
      at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cev_device_at ON connectivity_events(device_id, at);
    CREATE INDEX IF NOT EXISTS idx_cev_tenant_at ON connectivity_events(tenant_id, at);

    -- Server-only simulator credentials store (Section 12 & 15; never exposed to browser)
    CREATE TABLE IF NOT EXISTS simulator_credentials (
      device_id TEXT PRIMARY KEY REFERENCES devices(id),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      api_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Milestone 3: Telemetry 10-minute buckets (Section 3.2)
    CREATE TABLE IF NOT EXISTS telemetry_buckets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      bucket_start TEXT NOT NULL,
      samples_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tb_device_bucket ON telemetry_buckets(device_id, bucket_start);
    CREATE INDEX IF NOT EXISTS idx_tb_tenant_bucket ON telemetry_buckets(tenant_id, bucket_start);
    CREATE INDEX IF NOT EXISTS idx_tb_bucket_start ON telemetry_buckets(bucket_start);

    -- Milestone 3: Device commands queue (Section 4 & 6)
    CREATE TABLE IF NOT EXISTS device_commands (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      type TEXT NOT NULL CHECK (type IN ('APPLY_CONFIG', 'RESTART')),
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'DELIVERED', 'ACKED', 'FAILED')),
      created_by TEXT NOT NULL,
      delivered_at TEXT NULL,
      acked_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dcmd_device_status ON device_commands(device_id, status);
    CREATE INDEX IF NOT EXISTS idx_dcmd_tenant ON device_commands(tenant_id, created_at);

    -- Milestone 4: Alert Rules (Section 4 & 8.4)
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('THRESHOLD', 'OFFLINE')),
      metric_key TEXT NULL,
      operator TEXT NULL CHECK (operator IS NULL OR operator IN ('GT', 'GTE', 'LT', 'LTE')),
      threshold REAL NULL,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      severity TEXT NOT NULL CHECK (severity IN ('WARNING', 'CRITICAL')),
      scope_type TEXT NOT NULL CHECK (scope_type IN ('DEVICE', 'MODEL', 'SITE')),
      scope_id TEXT NOT NULL,
      recipients_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules(tenant_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_scope ON alert_rules(tenant_id, scope_type, scope_id);

    -- Milestone 4: Alerts (Section 4, 5.3, 8.4, 8.9)
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      rule_id TEXT NULL REFERENCES alert_rules(id) ON DELETE SET NULL,
      device_id TEXT NOT NULL REFERENCES devices(id),
      severity TEXT NOT NULL CHECK (severity IN ('WARNING', 'CRITICAL')),
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'CLOSED')),
      message TEXT NOT NULL,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      acknowledged_by TEXT NULL,
      acknowledged_at TEXT NULL,
      ticket_id TEXT NULL,
      escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level IN (0, 1, 2)),
      escalated_at TEXT NULL,
      email_delivery_failed INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT NULL,
      closed_by TEXT NULL,
      close_reason TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_tenant_status ON alerts(tenant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_device_rule_status ON alerts(device_id, rule_id, status);
    CREATE INDEX IF NOT EXISTS idx_alerts_escalation ON alerts(status, severity, escalation_level);
    CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id, created_at);

    -- Milestone 4: In-app Notifications (Section 4 & 8.8)
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(status, next_attempt_at);

    -- Milestone 5: Tickets & Service Requests (Section 4, 5.3, 8.5)
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      device_id TEXT NULL REFERENCES devices(id),
      site_id TEXT NULL REFERENCES sites(id),
      source TEXT NOT NULL CHECK (source IN ('ALERT', 'SERVICE_REQUEST', 'INTERNAL')),
      alert_id TEXT NULL REFERENCES alerts(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      status TEXT NOT NULL CHECK (status IN (
        'OPEN',
        'IN_PROGRESS',
        'WAITING_ON_CLIENT',
        'RESOLVED',
        'CLOSED'
      )),
      assignee_id TEXT NULL REFERENCES users(id),
      created_by TEXT NOT NULL,
      root_cause TEXT NULL,
      resolution_notes TEXT NULL,
      resolved_at TEXT NULL,
      closed_at TEXT NULL,
      close_reason TEXT NULL,
      comments_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets(tenant_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_device ON tickets(device_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_alert ON tickets(alert_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id, status);

    -- Milestone 5: Maintenance Plans (Section 4 & 8.5)
    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('DEVICE', 'TAG', 'SITE')),
      scope_value TEXT NOT NULL,
      every_days INTEGER NOT NULL CHECK (every_days >= 1),
      next_run_at TEXT NOT NULL,
      last_run_at TEXT NULL,
      template_json TEXT NOT NULL,
      assigned_to TEXT NULL REFERENCES users(id),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mplans_tenant ON maintenance_plans(tenant_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_mplans_due ON maintenance_plans(enabled, next_run_at);

    -- Milestone 5: Work Orders (Section 4, 5.3, 8.5)
    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      ticket_id TEXT NULL REFERENCES tickets(id) ON DELETE SET NULL,
      plan_id TEXT NULL REFERENCES maintenance_plans(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('CORRECTIVE', 'PREVENTIVE')),
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      checklist_json TEXT NOT NULL DEFAULT '[]',
      assigned_to TEXT NULL REFERENCES users(id),
      planned_start TEXT NULL,
      planned_end TEXT NULL,
      downtime_required INTEGER NOT NULL DEFAULT 0,
      approval_status TEXT NOT NULL CHECK (approval_status IN (
        'NOT_REQUIRED',
        'PENDING',
        'APPROVED',
        'REJECTED'
      )),
      approval_note TEXT NULL,
      approved_by TEXT NULL REFERENCES users(id),
      approved_at TEXT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'PLANNED',
        'ASSIGNED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED'
      )),
      started_at TEXT NULL,
      completed_at TEXT NULL,
      completion_json TEXT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wo_tenant_status ON work_orders(tenant_id, status, planned_start);
    CREATE INDEX IF NOT EXISTS idx_wo_assigned ON work_orders(assigned_to, status, planned_start);
    CREATE INDEX IF NOT EXISTS idx_wo_device ON work_orders(device_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wo_ticket ON work_orders(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_wo_approval ON work_orders(tenant_id, approval_status);

    -- Milestone 6: Configuration Profiles & Version History (Section 4 & 8.6)
    CREATE TABLE IF NOT EXISTS config_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      model_id TEXT NOT NULL REFERENCES device_models(id),
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cfg_profiles_tenant ON config_profiles(tenant_id, model_id);

    CREATE TABLE IF NOT EXISTS config_profile_versions (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES config_profiles(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(profile_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_cfg_versions_profile ON config_profile_versions(profile_id, version DESC);

    -- Milestone 6: Firmware Packages (global catalog, Section 4 & 8.7)
    CREATE TABLE IF NOT EXISTS firmware_packages (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES device_models(id),
      version TEXT NOT NULL,
      release_notes TEXT NOT NULL DEFAULT '',
      checksum_sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      file_ref TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('DRAFT', 'RELEASED', 'WITHDRAWN')),
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(model_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_firmware_model_status ON firmware_packages(model_id, status);

    -- Milestone 6: OTA Rollouts & Per-Device Rollout Jobs (Section 4, 5.3, 8.7)
    CREATE TABLE IF NOT EXISTS rollouts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      firmware_id TEXT NOT NULL REFERENCES firmware_packages(id),
      model_id TEXT NOT NULL REFERENCES device_models(id),
      target_type TEXT NOT NULL CHECK (target_type IN ('DEVICE', 'TAG', 'SITE')),
      target_value TEXT NOT NULL,
      scheduled_at TEXT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'PENDING_APPROVAL',
        'PENDING',
        'RUNNING',
        'COMPLETED',
        'REJECTED',
        'CANCELLED'
      )),
      created_by TEXT NOT NULL,
      decided_by TEXT NULL,
      decision_reason TEXT NULL,
      counts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rollouts_tenant_status ON rollouts(tenant_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rollouts_sched ON rollouts(status, scheduled_at);

    CREATE TABLE IF NOT EXISTS rollout_jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      rollout_id TEXT NOT NULL REFERENCES rollouts(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(id),
      from_version TEXT NULL,
      to_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'QUEUED',
        'DOWNLOADING',
        'INSTALLING',
        'VERIFIED',
        'FAILED',
        'CANCELLED'
      )),
      error_code TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rjobs_rollout ON rollout_jobs(rollout_id, status);
    CREATE INDEX IF NOT EXISTS idx_rjobs_device_status ON rollout_jobs(device_id, status);
  `);
}
