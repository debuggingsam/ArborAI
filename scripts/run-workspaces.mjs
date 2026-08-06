import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const command = process.argv[2];
const workspaces = ['apps/web', 'apps/api', 'packages/shared'];

if (!command) {
  console.error('Usage: node scripts/run-workspaces.mjs <dev|build|lint|typecheck|test>');
  process.exit(1);
}

const runnable = workspaces.filter((workspace) => {
  const manifestPath = join(workspace, 'package.json');
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return Boolean(manifest.scripts?.[command]);
});

if (runnable.length === 0) {
  console.log(`No workspace scripts found for “${command}”; repository scaffold is ready for application setup.`);
  process.exit(0);
}

if (command === 'dev') {
  const children = runnable.map((workspace) => spawn('npm', ['run', command], { cwd: workspace, stdio: 'inherit' }));
  const stop = () => children.forEach((child) => child.kill('SIGTERM'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await Promise.race(children.map((child) => new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 1)))));
  stop();
  process.exit(1);
}

for (const workspace of runnable) {
  const result = spawnSync('npm', ['run', command], { cwd: workspace, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
