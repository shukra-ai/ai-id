import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RuntimeConfig } from '../shared/config.js';

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function scryptPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export function validatePassword(password: string): void {
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < 12 || bytes > 1_024) {
    throw new Error('Le mot de passe doit contenir au moins 12 caractères.');
  }
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = await scryptPassword(password, salt);
  return { salt: salt.toString('base64url'), hash: hash.toString('base64url') };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  if (Buffer.byteLength(password, 'utf8') > 1_024) return false;
  const expected = Buffer.from(expectedHash, 'base64url');
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = await scryptPassword(password, Buffer.from(salt, 'base64url'));
  return timingSafeEqual(actual, expected);
}

export function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    cookies.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()));
  }
  return cookies;
}

function signedValue(secret: string, value: string): string {
  return `${value}.${hmac(secret, value)}`;
}

function verifySignedValue(secret: string, candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const separator = candidate.lastIndexOf('.');
  if (separator < 1) return undefined;
  const value = candidate.slice(0, separator);
  const supplied = Buffer.from(candidate.slice(separator + 1));
  const expected = Buffer.from(hmac(secret, value));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  return value;
}

function cookieSecurity(config: RuntimeConfig): string {
  return config.production ? '; Secure' : '';
}

export function issueCsrfToken(req: Request, res: Response, config: RuntimeConfig): string {
  const existing = verifySignedValue(config.cookieSecret, parseCookies(req.headers.cookie).get('aiid_csrf'));
  if (existing) return existing;
  const token = randomBytes(24).toString('base64url');
  res.append(
    'Set-Cookie',
    `aiid_csrf=${encodeURIComponent(signedValue(config.cookieSecret, token))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${cookieSecurity(config)}`,
  );
  return token;
}

export function requireCsrf(config: RuntimeConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookieToken = verifySignedValue(
      config.cookieSecret,
      parseCookies(req.headers.cookie).get('aiid_csrf'),
    );
    const body = req.body as Record<string, unknown> | undefined;
    const submitted = req.get('x-csrf-token') ?? (typeof body?._csrf === 'string' ? body._csrf : undefined);
    if (!cookieToken || !submitted) {
      res.status(403).json({ error: 'csrf_validation_failed' });
      return;
    }
    const left = Buffer.from(cookieToken);
    const right = Buffer.from(submitted);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      res.status(403).json({ error: 'csrf_validation_failed' });
      return;
    }
    next();
  };
}

export function requireSameOrigin(config: RuntimeConfig) {
  const expected = new URL(config.issuer).origin;
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get('origin');
    let valid = false;
    try { valid = typeof origin === 'string' && new URL(origin).origin === expected; }
    catch { valid = false; }
    if (!valid) {
      res.status(403).json({ error: 'origin_validation_failed' });
      return;
    }
    next();
  };
}

interface AccountSession {
  accountId: string;
  expiresAt: number;
}

export function setEnrollmentSession(res: Response, config: RuntimeConfig, accountId: string): void {
  const payload = Buffer.from(JSON.stringify({
    accountId,
    expiresAt: Math.floor(Date.now() / 1000) + 10 * 60,
  })).toString('base64url');
  res.append(
    'Set-Cookie',
    `aiid_enrollment=${encodeURIComponent(signedValue(config.cookieSecret, payload))}; Path=/passkeys; HttpOnly; SameSite=Strict; Max-Age=600${cookieSecurity(config)}`,
  );
}

export function enrollmentAccount(req: Request, config: RuntimeConfig): string | undefined {
  const encoded = verifySignedValue(
    config.cookieSecret,
    parseCookies(req.headers.cookie).get('aiid_enrollment'),
  );
  if (!encoded) return undefined;
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AccountSession;
    if (typeof value.accountId !== 'string' || value.expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
    return value.accountId;
  } catch {
    return undefined;
  }
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  public constructor(
    private readonly limit = 12,
    private readonly windowMs = 60_000,
  ) {}

  public middleware(scope: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const now = Date.now();
      const key = `${scope}:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + this.windowMs };
        this.buckets.set(key, bucket);
      }
      bucket.count += 1;
      res.setHeader('RateLimit-Limit', String(this.limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, this.limit - bucket.count)));
      res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
      if (bucket.count > this.limit) {
        res.status(429).json({ error: 'rate_limit_exceeded' });
        return;
      }
      next();
    };
  }
}

export function pairwiseSubject(secret: string, sector: string, accountId: string): string {
  return createHmac('sha256', secret)
    .update('aiid-pairwise-subject\0')
    .update(sector)
    .update('\0')
    .update(accountId)
    .digest('base64url');
}
