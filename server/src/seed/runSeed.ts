import { config } from '../config.ts';
import { createDatabase } from '../repositories/db.ts';
import { createRepositories } from '../repositories/index.ts';
import { logger } from '../utils/logger.ts';
import { seedAllDemoData } from './seedMilestone2.ts';

async function main() {
  const db = createDatabase(config.databasePath);
  const repos = createRepositories(db);
  const result = await seedAllDemoData(repos, { resetExisting: true });
  logger.info('Seed completed', result);
  db.close();
}

main().catch((err) => {
  logger.error('Seed failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
