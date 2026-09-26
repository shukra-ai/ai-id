import { loadConfig } from '../shared/config.js';
import { buildWitness } from './server.js';
const config = await loadConfig();
const { app } = await buildWitness(config);
await app.listen({ host: '127.0.0.1', port: Number(new URL(config.witnessOrigin).port) });
console.log(`Witness: ${config.witnessOrigin} (local pilot)`);
const stop = () => { void app.close().then(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
