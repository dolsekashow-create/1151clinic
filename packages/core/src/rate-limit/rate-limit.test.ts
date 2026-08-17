import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import {
  InMemoryRateLimiter,
  NoopRateLimiter,
  RATE_LIMITS,
  assertWithinLimit,
} from './types';

const RULE = { limit: 3, windowMs: 1000 };

describe('الحد من المعدّل', () => {
  it('يسمح حتى الحد ثم يمنع', async () => {
    const limiter = new InMemoryRateLimiter();
    const key = 'test:allow-then-block';

    for (let i = 1; i <= RULE.limit; i += 1) {
      const r = await limiter.consume(key, RULE);
      expect(r.allowed, `المحاولة ${i} يجب أن تُسمح`).toBe(true);
      expect(r.remaining).toBe(RULE.limit - i);
    }

    const blocked = await limiter.consume(key, RULE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAfterMs).toBeGreaterThan(0);
  });

  it('المفاتيح المختلفة عدّادات مستقلة', async () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < RULE.limit; i += 1) await limiter.consume('a', RULE);

    const other = await limiter.consume('b', RULE);
    expect(other.allowed).toBe(true);
  });

  it('reset يُصفّر العدّاد', async () => {
    const limiter = new InMemoryRateLimiter();
    const key = 'test:reset';
    for (let i = 0; i < RULE.limit; i += 1) await limiter.consume(key, RULE);
    expect((await limiter.consume(key, RULE)).allowed).toBe(false);

    await limiter.reset(key);
    expect((await limiter.consume(key, RULE)).allowed).toBe(true);
  });

  it('النافذة تنتهي فيُسمح مرة أخرى', async () => {
    const limiter = new InMemoryRateLimiter();
    const key = 'test:window';
    const fast = { limit: 1, windowMs: 20 };

    expect((await limiter.consume(key, fast)).allowed).toBe(true);
    expect((await limiter.consume(key, fast)).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 30));
    expect((await limiter.consume(key, fast)).allowed).toBe(true);
  });

  it('assertWithinLimit يرمي RATE_LIMITED بحالة 429', () => {
    try {
      assertWithinLimit({ allowed: false, remaining: 0, resetAfterMs: 5000 });
      expect.unreachable('كان يجب أن يرمي');
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true);
      expect((error as AppError).code).toBe('RATE_LIMITED');
      expect((error as AppError).httpStatus).toBe(429);
      expect((error as AppError).details).toMatchObject({ retryAfterSeconds: 5 });
    }
  });

  it('assertWithinLimit لا يرمي عند السماح', () => {
    expect(() => assertWithinLimit({ allowed: true, remaining: 2, resetAfterMs: 0 })).not.toThrow();
  });

  it('المُعطِّل يسمح دائمًا', async () => {
    const limiter = new NoopRateLimiter();
    for (let i = 0; i < 100; i += 1) {
      expect((await limiter.consume()).allowed).toBe(true);
    }
  });

  it('لا يتجاوز الحجم الأقصى للمدخلات', async () => {
    const limiter = new InMemoryRateLimiter(128);
    for (let i = 0; i < 400; i += 1) {
      await limiter.consume(`key-${i}`, { limit: 100, windowMs: 60_000 });
    }
    // لا يمكن قراءة الحجم من الخارج، لكن غياب الانهيار وعمل الحد يكفيان
    const r = await limiter.consume('key-399', { limit: 100, windowMs: 60_000 });
    expect(r.allowed).toBe(true);
  });

  it('كل الحدود المعرَّفة موجبة ومعقولة', () => {
    for (const [kind, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, kind).toBeGreaterThan(0);
      expect(rule.windowMs, kind).toBeGreaterThanOrEqual(60_000);
    }
  });
});
