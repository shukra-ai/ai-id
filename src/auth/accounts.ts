import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from '../shared/database.js';
import { hashPassword, normalizedEmail, verifyPassword } from './security.js';

export interface AuthAccount {
  id: string;
  domain_id: string;
  domain_name: string;
  name: string;
  email: string | null;
  password_salt: string | null;
  password_hash: string | null;
}

export interface AccountClaims {
  sub: string;
  domain_id: string;
  domain_name: string;
  name: string;
  email?: string;
  email_verified?: boolean;
}

function requiredText(value: string, label: string, maximum = 120): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maximum) throw new Error(`${label} invalide.`);
  return trimmed;
}

function validateEmail(email: string): string {
  const value = normalizedEmail(email);
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    throw new Error('Adresse email invalide.');
  }
  return value;
}

async function insertAccount(
  tx: Queryable,
  input: {
    domainName: string;
    name: string;
    email?: string;
    password?: string;
  },
): Promise<AuthAccount> {
  const domainId = randomUUID();
  const accountId = randomUUID();
  const domainName = requiredText(input.domainName, 'Nom du domaine de confiance');
  const name = requiredText(input.name, 'Nom');
  const email = input.email === undefined ? null : validateEmail(input.email);
  const password = input.password === undefined ? null : await hashPassword(input.password);

  await tx.query(
    'INSERT INTO auth_trust_domains (id, name) VALUES ($1, $2)',
    [domainId, domainName],
  );
  await tx.query(
    `INSERT INTO auth_accounts
       (id, domain_id, name, email, normalized_email, password_salt, password_hash, domain_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')`,
    [accountId, domainId, name, email, email, password?.salt ?? null, password?.hash ?? null],
  );
  return {
    id: accountId,
    domain_id: domainId,
    domain_name: domainName,
    name,
    email,
    password_salt: password?.salt ?? null,
    password_hash: password?.hash ?? null,
  };
}

/**
 * Every public registration creates a fresh trust domain and its first admin.
 * There is intentionally no lookup by email before insertion: equal email
 * strings never imply that two identities should be joined.
 */
export function createLocalAccount(
  database: Database,
  input: { domainName: string; name: string; email: string; password: string },
): Promise<AuthAccount> {
  return database.transaction((tx) => insertAccount(tx, input));
}

export async function authenticatePassword(
  database: Database,
  domainId: string,
  email: string,
  password: string,
): Promise<AuthAccount | undefined> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(domainId)) {
    return undefined;
  }
  const result = await database.query<AuthAccount>(
    `SELECT a.id, a.domain_id, d.name AS domain_name, a.name, a.email,
            a.password_salt, a.password_hash
       FROM auth_accounts a
       JOIN auth_trust_domains d ON d.id = a.domain_id
      WHERE a.domain_id = $1 AND a.normalized_email = $2
      LIMIT 1`,
    [domainId, normalizedEmail(email)],
  );
  const account = result.rows[0];
  // Keep the externally observable failure identical for an unknown account,
  // an account without a password, and a bad password.
  if (!account?.password_hash || !account.password_salt) {
    await verifyPassword(password, Buffer.alloc(16).toString('base64url'), Buffer.alloc(64).toString('base64url'));
    return undefined;
  }
  return await verifyPassword(password, account.password_salt, account.password_hash)
    ? account
    : undefined;
}

export async function findAccount(database: Database, accountId: string): Promise<AuthAccount | undefined> {
  const result = await database.query<AuthAccount>(
    `SELECT a.id, a.domain_id, d.name AS domain_name, a.name, a.email,
            a.password_salt, a.password_hash
       FROM auth_accounts a
       JOIN auth_trust_domains d ON d.id = a.domain_id
      WHERE a.id = $1
      LIMIT 1`,
    [accountId],
  );
  return result.rows[0];
}

export function claimsForAccount(account: AuthAccount): AccountClaims {
  return {
    sub: account.id,
    domain_id: account.domain_id,
    domain_name: account.domain_name,
    name: account.name,
    // No email verification workflow exists in this pilot. Never upgrade a claim.
    ...(account.email ? { email: account.email, email_verified: false } : {}),
  };
}

export async function findFederatedAccount(
  database: Database,
  issuer: string,
  subject: string,
): Promise<AuthAccount | undefined> {
  const result = await database.query<AuthAccount>(
    `SELECT a.id, a.domain_id, d.name AS domain_name, a.name, a.email,
            a.password_salt, a.password_hash
       FROM auth_federated_identities f
       JOIN auth_accounts a ON a.id = f.account_id
       JOIN auth_trust_domains d ON d.id = a.domain_id
      WHERE f.issuer = $1 AND f.subject = $2
      LIMIT 1`,
    [issuer, subject],
  );
  return result.rows[0];
}

/**
 * First use of an allowlisted upstream creates a fresh local trust domain.
 * Existing local accounts are never searched by email, so this cannot perform
 * implicit email linking or account joining.
 */
export async function createFederatedAccount(
  database: Database,
  input: { providerId: string; issuer: string; subject: string; name?: string; email?: string },
): Promise<AuthAccount> {
  const existing = await findFederatedAccount(database, input.issuer, input.subject);
  if (existing) return existing;
  try {
    return await database.transaction(async (tx) => {
      const account = await insertAccount(tx, {
        domainName: `${input.providerId}: ${input.name?.trim() || 'federated identity'}`.slice(0, 120),
        name: input.name?.trim() || `${input.providerId} identity`,
        ...(input.email ? { email: input.email } : {}),
      });
      await tx.query(
        `INSERT INTO auth_federated_identities (id, account_id, issuer, subject)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), account.id, input.issuer, input.subject],
      );
      return account;
    });
  } catch (error) {
    // A concurrent callback for the same issuer/sub can win the unique key.
    const winner = await findFederatedAccount(database, input.issuer, input.subject);
    if (winner) return winner;
    throw error;
  }
}
