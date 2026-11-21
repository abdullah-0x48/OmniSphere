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
  `);
}

