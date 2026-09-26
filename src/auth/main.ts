import { loadConfig } from '../shared/config.js';
import { buildAuth } from './server.js';
const config = await loadConfig();
const { app, db } = await buildAuth(config);
const server = app.listen(Number(new URL(config.issuer).port), '127.0.0.1', () => console.log(`Auth: ${config.issuer} (local pilot)`));
const stop = () => server.close(() => { void db.close().then(() => process.exit(0)); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
