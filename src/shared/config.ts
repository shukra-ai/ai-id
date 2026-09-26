import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface RuntimeConfig {
  dataDir: string;
  coreOrigin: string;
  issuer: string;
  witnessOrigin: string;
  oidcClientSecret: string;
  internalAuthSecret: string;
  witnessSecret: string;
  cookieSecret: string;
  production: boolean;
  databaseUrl?: string;
}

export async function loadConfig(): Promise<RuntimeConfig> {
  // No development secret or software signing key may silently become production.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Production gated: configure audited workload IAM, external signing, TLS and independent witness before deployment. See docs/architecture/phase-2-contrats-et-plan.md.');
  }
  const dataDir = resolve(process.env.AIID_DATA_DIR ?? '.local');
  await mkdir(dataDir, { recursive: true });
  const file = resolve(dataDir, 'runtime.json');
  let saved: Record<string, string>;
  try { saved = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    saved = Object.fromEntries(['oidcClientSecret', 'internalAuthSecret', 'witnessSecret', 'cookieSecret'].map(k => [k, randomBytes(32).toString('base64url')]));
    try { await writeFile(file, JSON.stringify(saved, null, 2), { flag: 'wx', mode: 0o600 }); }
    catch (race) {
      if ((race as NodeJS.ErrnoException).code !== 'EEXIST') throw race;
      saved = JSON.parse(await readFile(file, 'utf8'));
    }
  }
  for (const key of ['oidcClientSecret', 'internalAuthSecret', 'witnessSecret', 'cookieSecret']) {
    if (typeof saved[key] !== 'string' || saved[key].length < 32) throw new Error(`Invalid runtime secret: ${key}`);
  }
  const config: RuntimeConfig = {
    dataDir, coreOrigin: process.env.AIID_CORE_ORIGIN ?? 'http://localhost:4100',
    issuer: process.env.AIID_ISSUER ?? 'http://localhost:4101',
    witnessOrigin: process.env.AIID_WITNESS_ORIGIN ?? 'http://localhost:4102',
    oidcClientSecret: saved.oidcClientSecret!, internalAuthSecret: saved.internalAuthSecret!,
    witnessSecret: saved.witnessSecret!, cookieSecret: saved.cookieSecret!, production: false,
    databaseUrl: process.env.DATABASE_URL,
  };
  for (const origin of [config.coreOrigin, config.issuer, config.witnessOrigin]) {
    const url = new URL(origin);
    if (url.origin !== origin || url.hostname !== 'localhost' || url.protocol !== 'http:') {
      throw new Error('Local pilot accepts exact http://localhost:PORT origins only.');
    }
  }
  return config;
}
