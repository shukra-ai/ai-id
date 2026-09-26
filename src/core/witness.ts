import { verify } from 'node:crypto';
import type { Database } from '../shared/database.js';
import type { RuntimeConfig } from '../shared/config.js';
import { canonical } from '../shared/crypto.js';
import type { Checkpoint } from '../witness/server.js';

export async function publishPending(db: Database, config: RuntimeConfig) {
  // Bound encrypted response/credential retention even when the witness is offline.
  await db.query('DELETE FROM core_idempotency WHERE expires_at<=now()');
  await db.query("DELETE FROM core_sessions WHERE expires_at<=now() OR last_seen<=now()-interval '30 minutes'");
  await db.query('DELETE FROM core_login_states WHERE expires_at<=now()');
  const rows = (await db.query<Record<string, unknown>>(`SELECT a.* FROM core_audit a JOIN core_outbox o ON o.event_id=a.id WHERE o.witnessed_at IS NULL ORDER BY a.domain_id,a.sequence LIMIT 100`)).rows;
  for (const row of rows) {
    const response = await fetch(`${config.witnessOrigin}/internal/checkpoints`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.witnessSecret}` },
      body: JSON.stringify({ ...row, sequence: Number(row.sequence) }), signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Witness rejected checkpoint: ${response.status}`);
    await db.query('UPDATE core_outbox SET witnessed_at=now() WHERE event_id=$1', [row.id]);
  }
  return rows.length;
}

export async function compareWitness(db: Database, config: RuntimeConfig, domain: string) {
  try {
    const response = await fetch(`${config.witnessOrigin}/internal/checkpoints/${domain}`, { headers: { Authorization: `Bearer ${config.witnessSecret}` }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Unavailable');
    const checkpoint = await response.json() as Checkpoint | null;
    if (!checkpoint) return { status: 'pending', checkpoint: null };
    const keyResponse = await fetch(`${config.witnessOrigin}/public-key`, { signal: AbortSignal.timeout(3000) });
    if (!keyResponse.ok) throw new Error('Unavailable');
    const { public_key } = await keyResponse.json() as { public_key: string };
    const { signature, ...payload } = checkpoint;
    if (!verify(null, Buffer.from(canonical({ type: 'aiid.audit.checkpoint.v1', ...payload })), public_key, Buffer.from(signature, 'base64url'))) return { status: 'invalid_signature', checkpoint };
    const row = (await db.query<{ hash: string }>('SELECT hash FROM core_audit WHERE domain_id=$1 AND sequence=$2', [domain, checkpoint.sequence])).rows[0];
    return { status: row?.hash === checkpoint.head_hash ? 'consistent' : 'diverged', checkpoint };
  } catch { return { status: 'unavailable', checkpoint: null }; }
}
