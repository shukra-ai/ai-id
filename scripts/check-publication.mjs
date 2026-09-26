// Deterministic preflight for the explicit publication roots, not a full security audit.
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = [
  '.gitignore', 'LICENSE', 'README.md', 'README.fr.md', 'VISION.md', 'SCOPE.md',
  'ROADMAP.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md',
  'package.json', 'package-lock.json', 'tsconfig.json', '.github', 'docs',
  'src', 'public', 'scripts', 'tests',
];
const files = [];
function walk(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Publication rejects symlinks: ${relative(root, path)}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) walk(resolve(path, name));
  } else files.push(relative(root, path).split(sep).join('/'));
}
for (const entry of entries) walk(resolve(root, entry));

const problems = [];
const signals = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
];
for (const file of files) {
  if (/(^|\/)(?:\.local|node_modules|\.env(?:\..*)?|\.git)(\/|$)|\.(pem|key|sqlite|db)$/i.test(file)) problems.push(`${file}: forbidden publication path`);
  const content = readFileSync(resolve(root, file), 'utf8');
  if (file !== 'scripts/check-publication.mjs' && signals.some(pattern => pattern.test(content))) problems.push(`${file}: possible secret; inspect locally`);
  if (/\.(md)$/i.test(file)) {
    for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:|#)/.test(target) || /(?:^|\/)issues(?:\/|\?)/.test(target)) continue;
      if (!existsSync(resolve(dirname(resolve(root, file)), decodeURIComponent(target)))) problems.push(`${file}: missing link ${target}`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else if (process.argv.includes('--manifest')) {
  console.log(JSON.stringify(files));
} else {
  console.log(`Publication preflight: ${files.length} allowlisted files; relative file links and selected secret patterns passed. Human review still required.`);
}
