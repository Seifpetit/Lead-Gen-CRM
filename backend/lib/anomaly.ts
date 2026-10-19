// Rules for noticing a run that is not going well. Pure: the watchdog reads the facts from the
// database and asks these what they mean, so each rule can be tested with plain numbers.

export interface StuckInput {
  /** The last moment anything was written for the run (a log line), or when it started. */
  lastActivity: Date;
  now: Date;
  /** Minutes without progress after which a run "may be stuck". */
  minutes: number;
}

/** True when nothing has happened for `minutes` or longer. A non-positive setting turns it off. */
export function isStuck({ lastActivity, now, minutes }: StuckInput): boolean {
  if (!(minutes > 0)) return false;
  return now.getTime() - lastActivity.getTime() >= minutes * 60_000;
}

export interface SpendInput {
  /** What the steps that have finished were estimated to cost. */
  estimatedUsd: number;
  /** What those same steps really cost. */
  actualUsd: number;
  /** Warn when actual is more than this many times the estimate (for example 2). */
  factor: number;
  /** Ignore overruns smaller than this, so a cent over a cent estimate is not an alarm. */
  floorUsd: number;
}

/** A run spending faster than its estimate by more than the factor. */
export function isSpendingFast({ estimatedUsd, actualUsd, factor, floorUsd }: SpendInput): boolean {
  if (!(factor > 0)) return false;
  if (actualUsd - estimatedUsd < floorUsd) return false;
  return actualUsd > estimatedUsd * factor;
}

export interface DailyInput {
  todayUsd: number;
  /** The spend of each of the days before today that had any, most recent first. */
  earlierDaysUsd: readonly number[];
  /** Warn when today is at least this many times the usual day. */
  factor: number;
  /** Ignore days under this amount, however they compare. */
  floorUsd: number;
}

export interface DailyJump {
  jump: boolean;
  /** The usual day: the average of the earlier days; 0 when there are none. */
  usualUsd: number;
}

/** Today's spend at least `factor` times the usual day, where the usual day is never taken below the floor. */
export function dailySpendJump({
  todayUsd,
  earlierDaysUsd,
  factor,
  floorUsd,
}: DailyInput): DailyJump {
  const usual =
    earlierDaysUsd.length === 0
      ? 0
      : earlierDaysUsd.reduce((a, b) => a + b, 0) / earlierDaysUsd.length;
  if (!(factor > 0) || todayUsd < floorUsd) return { jump: false, usualUsd: usual };
  const base = Math.max(usual, floorUsd);
  return { jump: todayUsd >= base * factor, usualUsd: usual };
}
