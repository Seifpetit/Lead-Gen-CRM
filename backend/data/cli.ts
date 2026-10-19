import { createDb } from './db.js';
import { recordError } from './appErrors.js';
import { MigrationError, migrateDown, migrateUp } from './migrate.js';
import { seedDemo, seedReference } from './seed.js';

// Database commands. Needs only DATABASE_URL, so it does not go through loadEnv.
const [command] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const db = createDb(url);
try {
  switch (command) {
    case 'migrate': {
      try {
        const ran = await migrateUp(db);
        await seedReference(db);
        console.log(ran.length ? `applied ${ran.join(', ')}` : 'already up to date');
      } catch (err) {
        // Say which migration failed and that nothing was left half done, then note it.
        if (err instanceof MigrationError) {
          console.error(
            `The database update stopped at ${err.migrationId}: ${err.cause instanceof Error ? err.cause.message : 'unknown problem'}.\n` +
              'That step was undone, so nothing is half applied. Fix the problem and run npm run db:migrate again.',
          );
          await recordError(db, {
            source: 'migration',
            kind: 'migration_failed',
            step: err.migrationId,
            message: err.message,
            stack: err.stack,
            secrets: [url],
          });
          process.exitCode = 1;
          break;
        }
        throw err;
      }
      break;
    }
    case 'rollback': {
      const undone = await migrateDown(db, 1);
      console.log(undone.length ? `rolled back ${undone.join(', ')}` : 'nothing to roll back');
      break;
    }
    case 'seed':
      await seedReference(db);
      await seedDemo(db);
      console.log('seeded reference and demo data');
      break;
    default:
      console.error('usage: cli.ts migrate | rollback | seed');
      process.exitCode = 1;
  }
} finally {
  await db.end();
}
