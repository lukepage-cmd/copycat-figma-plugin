type Bucket = { count: number; resetAt: number };

const DAILY_MS = 24 * 60 * 60 * 1000;
const HOURLY_MS = 60 * 60 * 1000;
const GLOBAL_DAILY_LIMIT = 500;
const PER_IP_HOURLY_LIMIT = 100;

const globalBucket: Bucket = { count: 0, resetAt: 0 };
const ipBuckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: 'global' | 'per-ip' };

export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  if (globalBucket.resetAt <= now) {
    globalBucket.count = 0;
    globalBucket.resetAt = now + DAILY_MS;
  }
  if (globalBucket.count >= GLOBAL_DAILY_LIMIT) {
    return { ok: false, reason: 'global' };
  }

  const ipBucket = ipBuckets.get(ip);
  if (!ipBucket || ipBucket.resetAt <= now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + HOURLY_MS });
  } else {
    if (ipBucket.count >= PER_IP_HOURLY_LIMIT) {
      return { ok: false, reason: 'per-ip' };
    }
    ipBucket.count += 1;
  }

  globalBucket.count += 1;
  return { ok: true };
}

export function _resetRateLimit(): void {
  globalBucket.count = 0;
  globalBucket.resetAt = 0;
  ipBuckets.clear();
}
