import { spawn } from 'node:child_process';
import { loadConfig } from '../src/shared/config.js';

const config = await loadConfig();
const children = ['witness', 'auth', 'core'].map(service => spawn(process.execPath, ['--import', 'tsx', `src/${service}/main.ts`], { stdio: 'inherit', windowsHide: true, env: process.env }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => process.exit(code), 5000); timer.unref();
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`AI ID — pilote local : ${config.coreOrigin}\nNe pas utiliser d’identités réelles. Ctrl+C arrête les trois services.`);
