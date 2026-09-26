import type { Database } from '../shared/database.js';

export interface OidcAdapterPayload {
  grantId?: string;
  userCode?: string;
  uid?: string;
  consumed?: number;
  [claim: string]: unknown;
}

interface StoredOidcObject {
  payload: string;
  consumed_at: string | number | null;
}

/** Persistent oidc-provider adapter backed by the Auth database. */
export class PersistentOidcAdapter {
  public constructor(
    private readonly model: string,
    private readonly database: Database,
  ) {}

  public async upsert(id: string, payload: OidcAdapterPayload, expiresIn: number): Promise<void> {
    const expiresAt = expiresIn > 0 ? Math.floor(Date.now() / 1000) + expiresIn : null;
    await this.database.query(
      `INSERT INTO auth_oidc_objects
         (model, id, payload, expires_at, consumed_at, grant_id, user_code, uid)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)
       ON CONFLICT (model, id) DO UPDATE SET
         payload = EXCLUDED.payload,
         expires_at = EXCLUDED.expires_at,
         consumed_at = auth_oidc_objects.consumed_at,
         grant_id = EXCLUDED.grant_id,
         user_code = EXCLUDED.user_code,
         uid = EXCLUDED.uid`,
      [
        this.model,
        id,
        JSON.stringify(payload),
        expiresAt,
        typeof payload.grantId === 'string' ? payload.grantId : null,
        typeof payload.userCode === 'string' ? payload.userCode : null,
        typeof payload.uid === 'string' ? payload.uid : null,
      ],
    );
  }

  public async find(id: string): Promise<OidcAdapterPayload | undefined> {
    return this.findOne('id = $2', id);
  }

  public async findByUserCode(userCode: string): Promise<OidcAdapterPayload | undefined> {
    return this.findOne('user_code = $2', userCode);
  }

  public async findByUid(uid: string): Promise<OidcAdapterPayload | undefined> {
    return this.findOne('uid = $2', uid);
  }

  private async findOne(predicate: string, value: string): Promise<OidcAdapterPayload | undefined> {
    const result = await this.database.query<StoredOidcObject>(
      `SELECT payload, consumed_at
         FROM auth_oidc_objects
        WHERE model = $1 AND ${predicate}
          AND (expires_at IS NULL OR expires_at > $3)
        LIMIT 1`,
      [this.model, value, Math.floor(Date.now() / 1000)],
    );
    const stored = result.rows[0];
    if (!stored) return undefined;
    const payload = JSON.parse(stored.payload) as OidcAdapterPayload;
    if (stored.consumed_at !== null) payload.consumed = Number(stored.consumed_at);
    return payload;
  }

  public async destroy(id: string): Promise<void> {
    await this.database.query(
      'DELETE FROM auth_oidc_objects WHERE model = $1 AND id = $2',
      [this.model, id],
    );
  }

  public async consume(id: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE auth_oidc_objects
          SET consumed_at = $3
        WHERE model = $1 AND id = $2 AND consumed_at IS NULL RETURNING id`,
      [this.model, id, Math.floor(Date.now() / 1000)],
    );
    if (!result.rows.length) throw new Error('OIDC object already consumed or missing.');
  }

  public async revokeByGrantId(grantId: string): Promise<void> {
    await this.database.query(
      'DELETE FROM auth_oidc_objects WHERE grant_id = $1',
      [grantId],
    );
  }
}

type AdapterConstructor = new (model: string) => PersistentOidcAdapter;

export function createOidcAdapter(database: Database): AdapterConstructor {
  return class AuthDatabaseAdapter extends PersistentOidcAdapter {
    public constructor(model: string) {
      super(model, database);
    }
  };
}
