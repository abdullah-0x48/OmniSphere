import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp, type AppRuntime } from './server/src/app.ts';
import { config } from './server/src/config.ts';
import { createDatabase } from './server/src/repositories/db.ts';
import { createRepositories } from './server/src/repositories/index.ts';
import { seedAllDemoData } from './server/src/seed/seedMilestone2.ts';
import { seedMilestone3Telemetry } from './server/src/seed/seedMilestone3.ts';
import { logger } from './server/src/utils/logger.ts';

async function startServer() {
  const db = createDatabase(config.databasePath);
  const repos = createRepositories(db);

  // Auto-seed demo tenants, accounts, sites, models, devices, and 24h telemetry on boot when missing
  const existingTenants = repos.tenants.countByStatus();
  const existingModels = repos.deviceModels.countAll();
  if (existingTenants.total === 0 || existingModels === 0) {
    const seedRes = await seedAllDemoData(repos);
    logger.info('Initial seed populated database', seedRes);
  } else if (repos.telemetry.countBuckets() === 0 && repos.devices.listAllSystem().length > 0) {
    const backfillRes = seedMilestone3Telemetry(repos);
    logger.info('Seeded 24h telemetry backfill', backfillRes);
  }

  const app = createApp(repos);
  const runtime = app.locals.runtime as AppRuntime;
  runtime.simulator.syncFromDatabase();
  runtime.backgroundJobs.start();

  const isProd = config.nodeEnv === 'production';
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`OmniSphere server listening on http://0.0.0.0:${config.port}`, {
      env: config.nodeEnv,
      demoMode: config.demoMode,
    });
  });

  const shutdown = () => {
    logger.info('Shutting down OmniSphere server...');
    runtime.simulator.stopAll();
    runtime.backgroundJobs.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  logger.error('Failed to start OmniSphere server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
