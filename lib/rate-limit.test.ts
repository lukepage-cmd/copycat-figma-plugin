import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, _resetRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => _resetRateLimit());

  it('allows the first request from a new IP', () => {
    const r = checkRateLimit('1.2.3.4', 1000);
    expect(r.ok).toBe(true);
  });

  it('blocks a per-IP request after 100 in one hour', () => {
    for (let i = 0; i < 100; i++) checkRateLimit('1.2.3.4', 1000);
    const r = checkRateLimit('1.2.3.4', 1000);
    expect(r).toEqual({ ok: false, reason: 'per-ip' });
  });

  it('resets the per-IP counter after one hour', () => {
    for (let i = 0; i < 100; i++) checkRateLimit('1.2.3.4', 1000);
    const HOUR = 60 * 60 * 1000;
    const r = checkRateLimit('1.2.3.4', 1000 + HOUR + 1);
    expect(r.ok).toBe(true);
  });

  it('blocks the global daily request after 500 across all IPs', () => {
    for (let i = 0; i < 500; i++) {
      checkRateLimit(`ip-${i}`, 1000);
    }
    const r = checkRateLimit('new-ip', 1000);
    expect(r).toEqual({ ok: false, reason: 'global' });
  });

  it('treats per-IP and global as independent counters', () => {
    for (let i = 0; i < 99; i++) checkRateLimit('1.2.3.4', 1000);
    const r = checkRateLimit('5.6.7.8', 1000);
    expect(r.ok).toBe(true);
  });
});
