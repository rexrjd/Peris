export type GameClockSample = { version: 1; rate: 1 | 10 | 100; profile_id: 'normal-v1' | 'accelerated-test-v1'; real_now: string; game_now: string };
/** Domain fallback: the caller's injected world instant, never device time. */
export function worldGameNow(world: { server_now: string }): number {
  const now = Date.parse(world.server_now);
  if (!Number.isFinite(now)) throw new Error('Invalid game clock world instant');
  return now;
}
/** Presentation only: map virtual deadlines to real UTC on the sampled clock. */
export function realTimeForGameDate(world: { game_clock?: GameClockSample } | undefined, timestamp: string | number): number {
  const gameMs = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
  if (!Number.isFinite(gameMs)) throw new Error('Invalid game clock date');
  if (!world?.game_clock) return gameMs;
  const clock = validateGameClock(world.game_clock);
  return Date.parse(clock.real_now) + (gameMs - Date.parse(clock.game_now)) / clock.rate;
}

export function validateGameClock(value: unknown): GameClockSample {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid game clock...');
  const obj = value as Record<string, unknown>;
  if (!('version' in obj) || obj.version !== 1) throw new Error('Invalid game clock...');
  const rate = obj.rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate !== 1 && rate !== 10 && rate !== 100) throw new Error('Invalid game clock...');
  const profile = obj.profile_id;
  if (typeof profile !== 'string' || profile !== 'normal-v1' && profile !== 'accelerated-test-v1') throw new Error('Invalid game clock...');
  if (profile === 'normal-v1' && rate !== 1) throw new Error('Invalid game clock...');
  const realNow = obj.real_now;
  const gameNow = obj.game_now;
  if (typeof realNow !== 'string' || !Number.isFinite(Date.parse(realNow))) throw new Error('Invalid game clock...');
  if (typeof gameNow !== 'string' || !Number.isFinite(Date.parse(gameNow))) throw new Error('Invalid game clock...');
  return { version: 1, rate, profile_id: profile, real_now: realNow, game_now: gameNow };
}

export function projectGameNow(sample: GameClockSample, elapsedRealMs: number): number {
  const clock = validateGameClock(sample);
  if (typeof elapsedRealMs !== 'number' || !Number.isFinite(elapsedRealMs)) throw new Error('Invalid game clock...');
  const gameNowMs = Date.parse(clock.game_now);
  if (!Number.isFinite(gameNowMs)) throw new Error('Invalid game clock...');
  const result = gameNowMs + Math.max(0, elapsedRealMs) * clock.rate;
  if (!Number.isFinite(result)) throw new Error('Invalid game clock...');
  return result;
}

export function realSecondsUntil(deadlineGameMs: number, nowGameMs: number, rate: 1 | 10 | 100): number {
  if (typeof deadlineGameMs !== 'number' || !Number.isFinite(deadlineGameMs)) throw new Error('Invalid game clock...');
  if (typeof nowGameMs !== 'number' || !Number.isFinite(nowGameMs)) throw new Error('Invalid game clock...');
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate !== 1 && rate !== 10 && rate !== 100) throw new Error('Invalid game clock...');
  const diff = deadlineGameMs - nowGameMs;
  if (!Number.isFinite(diff)) throw new Error('Invalid game clock...');
  return Math.max(0, diff) / 1000 / rate;
}
