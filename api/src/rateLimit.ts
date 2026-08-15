/**
 * Fixed-window limiter, in-process. Fine for one API instance; would need a
 * shared store (Redis) the moment this runs replicated — nothing here
 * pretends otherwise.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > max;
}

// Sweeps stale entries so a long-running process doesn't accumulate one
// forever per distinct IP that's ever hit a limited route.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  },
  10 * 60_000,
).unref();
