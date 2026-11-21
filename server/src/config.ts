import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Ephemeral in-memory fallback for development when JWT_SECRET is not provided via env.
const ephemeralJwtSecret = crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0
    ? process.env.JWT_SECRET.trim()
    : ephemeralJwtSecret,
  jwtExpiresIn: '8h' as const,
  demoMode: (process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  databasePath: process.env.DATABASE_PATH ?? './data/omnisphere.db',
  telemetryRetentionDays: Number(process.env.TELEMETRY_RETENTION_DAYS ?? 90),
  smtp: {
    host: process.env.SMTP_HOST?.trim() || '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER?.trim() || '',
    pass: process.env.SMTP_PASS?.trim() || '',
    from: process.env.SMTP_FROM?.trim() || 'no-reply@omnisphere.local',
  },
  security: {
    bcryptCost: 10,
    maxFailedLogins: 5,
    lockoutMinutes: 15,
    passwordResetExpiryMinutes: 60,
  },
};

export function isSmtpConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}
