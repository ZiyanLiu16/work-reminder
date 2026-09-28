import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeChrome } from './fake_chrome.js';
import { readFile } from 'node:fs/promises';
const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); }, fire(...args) { return this.listeners.map(listener => listener(...args)); } });
const settle = () => new Promise(resolve => setImmediate(resolve));
test('Chrome service worker entry has no top-level await', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  // A regular function rejects await outside nested async functions, matching the
  // Chrome service-worker restriction that Node's ESM loader does not enforce.
  assert.doesNotThrow(() => new Function(source.replace(/^import .*;\n/gm, '')));
});
test('worker registers all listeners before async startup; restores alarm and handles messages', async () => {
  const { api, world, sender } = fakeChrome();
  for (const name of ['onActivated', 'onUpdated', 'onRemoved']) api.tabs[name] = event();
  api.windows.onFocusChanged = event(); api.idle.onStateChanged = event(); api.idle.setDetectionInterval = seconds => { world.idleInterval = seconds; };
  for (const name of ['onMessage', 'onInstalled', 'onStartup']) api.runtime[name] = event();
  api.runtime.openOptionsPage = async () => { world.optionsOpened = true; };
  api.alarms = { onAlarm: event(), get: async () => undefined, create: async (name, config) => { world.alarm = { name, config }; } };
  let completeFetch;
  globalThis.chrome = api;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(resolve => { completeFetch = () => resolve({ json: async () => [{ text: 'start', author: 'original' }] }); });
  try {
    const loading = import(`../extension/background.js?test=${Date.now()}`);
    while (!completeFetch) await settle();
    assert.equal(api.runtime.onMessage.listeners.length, 1);
    assert.equal(api.tabs.onActivated.listeners.length, 1);
    assert.equal(api.windows.onFocusChanged.listeners.length, 1);
    completeFetch(); await loading;
    assert.deepEqual(world.alarm, { name: 'work-reminder', config: { periodInMinutes: 0.5 } });
    assert.equal(world.idleInterval, 120);
    const response = await new Promise(resolve => api.runtime.onMessage.fire({ type: 'status' }, sender, resolve));
    assert.equal(response.ok, true); assert.equal(response.result.settings.goal, 'Finish the project');
    const denied = await new Promise(resolve => api.runtime.onMessage.fire({ type: 'status' }, { url: 'https://example.com' }, resolve));
    assert.equal(denied.ok, false);
    api.runtime.onInstalled.fire({ reason: 'install' }); await settle(); assert.equal(world.optionsOpened, true);
    world.windows[0].focused = false; await Promise.all(api.windows.onFocusChanged.fire(-1)); assert.equal(world.session.timer.eligible, false);
    await Promise.all(api.alarms.onAlarm.fire({ name: 'work-reminder' })); await settle();
    assert.equal(world.session.lastError, undefined);
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
