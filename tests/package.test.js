import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
test('production package uses MV3 and only declared necessary permissions', () => {
  assert.equal(manifest.manifest_version, 3); assert.equal(manifest.background.type, 'module');
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'idle', 'scripting']);
  assert.equal(manifest.host_permissions.some(pattern => pattern.includes('<all_urls>') || pattern === 'https://*/*'), false);
});
test('all manifest entry points exist', async () => {
  for (const path of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(entry => entry.js), ...manifest.web_accessible_resources.flatMap(entry => entry.resources)])
    await access(new URL(`../extension/${path}`, import.meta.url));
});
test('only reminder HTML is web-accessible; repo data never enters iframe URL', async () => {
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['reminder.html']);
  const content = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
  assert.equal(content.includes('message.card'), false); assert.equal(content.includes('message.snippet'), false);
});
