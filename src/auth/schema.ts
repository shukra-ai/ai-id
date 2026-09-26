import type { Database } from '../shared/database.js';

/**
 * Authentication owns this schema.  The tables deliberately do not share
 * foreign keys with the core database: crossing that boundary happens through
 * opaque identifiers and authenticated APIs, never through a database join.
 */
export async function initializeAuthSchema(database: Database): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS auth_trust_domains (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      domain_id TEXT NOT NULL REFERENCES auth_trust_domains(id),
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      email TEXT,
      normalized_email TEXT,
      password_salt TEXT,
      password_hash TEXT,
      domain_role TEXT NOT NULL DEFAULT 'admin' CHECK (domain_role = 'admin'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((password_salt IS NULL) = (password_hash IS NULL)),
      UNIQUE (domain_id, normalized_email)
    );

    CREATE TABLE IF NOT EXISTS auth_passkeys (
      credential_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_type TEXT NOT NULL,
      backed_up BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS auth_passkeys_account_idx
      ON auth_passkeys(account_id);

    CREATE TABLE IF NOT EXISTS auth_webauthn_challenges (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
      challenge TEXT NOT NULL,
      account_id TEXT REFERENCES auth_accounts(id) ON DELETE CASCADE,
      interaction_uid TEXT,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS auth_webauthn_challenges_expiry_idx
      ON auth_webauthn_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS auth_federated_identities (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (issuer, subject)
    );

    CREATE TABLE IF NOT EXISTS auth_federation_flows (
      state TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      issuer TEXT NOT NULL,
      nonce TEXT NOT NULL,
      pkce_verifier TEXT NOT NULL,
      interaction_uid TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS auth_federation_flows_expiry_idx
      ON auth_federation_flows(expires_at);

    CREATE TABLE IF NOT EXISTS auth_oidc_objects (
      model TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires_at BIGINT,
      consumed_at BIGINT,
      grant_id TEXT,
      user_code TEXT,
      uid TEXT,
      PRIMARY KEY (model, id)
    );
    CREATE INDEX IF NOT EXISTS auth_oidc_objects_grant_idx
      ON auth_oidc_objects(grant_id);
    CREATE INDEX IF NOT EXISTS auth_oidc_objects_user_code_idx
      ON auth_oidc_objects(model, user_code);
    CREATE INDEX IF NOT EXISTS auth_oidc_objects_uid_idx
      ON auth_oidc_objects(model, uid);
    CREATE INDEX IF NOT EXISTS auth_oidc_objects_expiry_idx
      ON auth_oidc_objects(expires_at);
  `);
}
