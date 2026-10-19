import { purgeNoise } from '../data/crmBoards.js';
import type { Db } from '../data/db.js';

const DAY_MS = 86_400_000;

/**
 * The daily Noise purge: runs once now (a server that restarts often still catches up) and then
 * every 24 hours. A failure is logged and retried the next day. Returns a function that stops it.
 */
export function startNoisePurge(
  db: Db,
  retentionDays: number,
  log: (data: object, message: string) => void,
  intervalMs = DAY_MS,
): () => void {
  const run = () =>
    purgeNoise(db, retentionDays)
      .then((n) => {
        if (n.people + n.companies > 0) log(n, 'purged removed CRM cards');
      })
      .catch((err: unknown) => log({ err }, 'noise purge failed'));
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
