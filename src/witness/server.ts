import Fastify from 'fastify';
import { generateKeyPairSync, sign, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { RuntimeConfig } from '../shared/config.js';
import { createDatabase } from '../shared/database.js';
import { canonical, hash, equalSecret } from '../shared/crypto.js';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const auditEnvelope = z.object({
  id: z.uuid(), domain_id: z.uuid(), sequence: z.number().int().min(1), actor_id: z.uuid(),
  action: z.string().min(1).max(100), resource_id: z.string().min(1).max(200), request_id: z.string().min(1).max(200),
  occurred_at: z.iso.datetime(), previous_hash: digest, data: z.record(z.string(), z.unknown()), hash: digest,
}).strict();
export interface Checkpoint { domain_id: string; sequence: number; head_hash: string; witnessed_at: string; signature: string }

export async function buildWitness(config: RuntimeConfig) {
  if (config.production) throw new Error('Independent IAM and WORM storage required in production.');
  const db = await createDatabase('witness', config);
  await db.exec(`CREATE TABLE IF NOT EXISTS witness_heads(domain_id UUID PRIMARY KEY, sequence BIGINT NOT NULL DEFAULT 0, head_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS witness_checkpoints(domain_id UUID NOT NULL, sequence BIGINT NOT NULL, head_hash TEXT NOT NULL, witnessed_at TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(domain_id,sequence));`);
  const directory = join(config.dataDir, 'witness'); await mkdir(directory, { recursive: true });
  const path = join(directory, 'key.pem');
  let pem: string;
  try { pem = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await writeFile(path, pem, { flag: 'wx', mode: 0o600 });
  }
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const app = Fastify({ bodyLimit: 256 * 1024 });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (req.headers.host !== new URL(config.witnessOrigin).host) return reply.code(400).send({ error: 'invalid_host' });
    if (req.url.startsWith('/internal/') && !equalSecret(req.headers.authorization ?? '', `Bearer ${config.witnessSecret}`)) return reply.code(401).send({ error: 'unauthorized' });
  });
  app.setErrorHandler((error, _req, reply) => reply.code(error instanceof z.ZodError ? 400 : 409).send({ error: 'checkpoint_rejected' }));
  app.get('/healthz', async () => ({ status: 'ok', service: 'witness', mode: 'local-pilot' }));
  app.get('/public-key', async () => ({ algorithm: 'Ed25519', public_key: publicKey }));
  app.get('/internal/checkpoints/:domain', async req => {
    const id = z.uuid().parse((req.params as { domain: string }).domain);
    const row = (await db.query<Checkpoint>('SELECT * FROM witness_checkpoints WHERE domain_id=$1 ORDER BY sequence DESC LIMIT 1', [id])).rows[0];
    return row ? { ...row, sequence: Number(row.sequence) } : null;
  });
  app.post('/internal/checkpoints', async req => {
    const event = auditEnvelope.parse(req.body);
    const { hash: supplied, ...envelope } = event;
    if (hash(canonical(envelope)) !== supplied) throw new Error('Invalid event digest');
    return db.transaction(async tx => {
      await tx.query('INSERT INTO witness_heads(domain_id,head_hash) VALUES($1,$2) ON CONFLICT DO NOTHING', [event.domain_id, '0'.repeat(64)]);
      const head = (await tx.query<{ sequence: string; head_hash: string }>('SELECT * FROM witness_heads WHERE domain_id=$1 FOR UPDATE', [event.domain_id])).rows[0]!;
      if (event.sequence <= Number(head.sequence)) {
        const prior = (await tx.query<Checkpoint>('SELECT * FROM witness_checkpoints WHERE domain_id=$1 AND sequence=$2', [event.domain_id, event.sequence])).rows[0];
        if (!prior || prior.head_hash !== supplied) throw new Error('Fork');
        return { ...prior, sequence: Number(prior.sequence) };
      }
      if (event.sequence !== Number(head.sequence) + 1 || event.previous_hash !== head.head_hash) throw new Error('Gap or fork');
      const checkpoint = { domain_id: event.domain_id, sequence: event.sequence, head_hash: supplied, witnessed_at: new Date().toISOString() };
      const signature = sign(null, Buffer.from(canonical({ type: 'aiid.audit.checkpoint.v1', ...checkpoint })), privateKey).toString('base64url');
      await tx.query('INSERT INTO witness_checkpoints(domain_id,sequence,head_hash,witnessed_at,signature) VALUES($1,$2,$3,$4,$5)', [checkpoint.domain_id, checkpoint.sequence, checkpoint.head_hash, checkpoint.witnessed_at, signature]);
      await tx.query('UPDATE witness_heads SET sequence=$2,head_hash=$3 WHERE domain_id=$1', [event.domain_id, event.sequence, supplied]);
      return { ...checkpoint, signature };
    });
  });
  app.addHook('onClose', () => db.close());
  return { app, db, publicKey };
}
