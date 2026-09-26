import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { RuntimeConfig } from '../src/shared/config.js';
import { randomSecret } from '../src/shared/crypto.js';
export function testConfig(port = 4410): RuntimeConfig {
  return {
    dataDir: resolve('.local', 'tests', randomUUID()), coreOrigin: `http://localhost:${port}`,
    issuer: `http://localhost:${port + 1}`, witnessOrigin: `http://localhost:${port + 2}`,
    oidcClientSecret: randomSecret(), internalAuthSecret: randomSecret(), witnessSecret: randomSecret(), cookieSecret: randomSecret(), production: false,
  };
}
