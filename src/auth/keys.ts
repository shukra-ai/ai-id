import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, link, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exportJWK, generateKeyPair, type JWK } from 'jose';
import type { RuntimeConfig } from '../shared/config.js';

interface JsonWebKeySet {
  keys: JWK[];
}

function assertPrivateSigningKeySet(value: unknown): asserts value is JsonWebKeySet {
  if (!value || typeof value !== 'object' || !Array.isArray((value as JsonWebKeySet).keys)) {
    throw new Error('Invalid development JWKS file.');
  }
  const keys = (value as JsonWebKeySet).keys;
  if (keys.length < 1 || keys.some((key) => key.use !== 'sig' || key.alg !== 'RS256' || typeof key.kid !== 'string' || typeof key.d !== 'string')) {
    throw new Error('Development JWKS must contain an RS256 private signing key.');
  }
}

/**
 * Development-only key persistence. Production deliberately fails closed:
 * loading an extractable private key from disk is not an acceptable substitute
 * for the Typed Signer/KMS boundary described by the architecture.
 */
export async function loadDevelopmentJwks(config: RuntimeConfig): Promise<JsonWebKeySet> {
  if (config.production) {
    throw new Error('Auth startup refused: production requires an external KMS/HSM signing adapter.');
  }
  const path = join(config.dataDir, 'auth', 'jwks.json');
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    assertPrivateSigningKeySet(parsed);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(dirname(path), { recursive: true });
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const key = await exportJWK(privateKey);
  key.use = 'sig';
  key.alg = 'RS256';
  key.kid = randomUUID();
  const jwks: JsonWebKeySet = { keys: [key] };
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(jwks, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path); // Atomic create-only publication, never replace an existing key.
  } catch (error) {
    await rm(temporary, { force: true });
    // Another process may have initialized the key. Never overwrite it.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  const persisted: unknown = JSON.parse(await readFile(path, 'utf8'));
  assertPrivateSigningKeySet(persisted);
  return persisted;
}
