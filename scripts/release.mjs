import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'extension/manifest.json'), 'utf8'));
const releaseDirectory = resolve(root, 'release');
const archive = resolve(releaseDirectory, `work-reminder-${manifest.version}.zip`);

execFileSync(process.execPath, [resolve(root, 'scripts/build.mjs')], { stdio: 'inherit' });
await mkdir(releaseDirectory, { recursive: true });
await rm(archive, { force: true });
execFileSync('zip', ['-r', '-q', archive, '.'], { cwd: resolve(root, 'dist') });
console.log(`Chrome Web Store package: ${archive}`);
