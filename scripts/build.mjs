import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'extension');
const output = resolve(root, 'dist');
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
for (const file of await readdir(source)) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', resolve(source, file)]);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
console.log(`Built Work Reminder ${manifest.version}\nLoad unpacked directory: ${output}`);
