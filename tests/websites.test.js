import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebsites, websiteOrigins, syncWebsiteScripts, DEFAULT_WEBSITES } from '../extension/websites.js';
import { targetHost, MINUTE } from '../extension/core.js';
import { createController } from '../extension/controller.js';
import { fakeChrome } from './fake_chrome.js';

test('URLs normalize to unique domains and ignore paths, ports, queries and case', () => {
  assert.deepEqual(normalizeWebsites(' https://WWW.Reddit.com/r/test?a=1\nreddit.com\nhttp://news.example.com:8080/a\n'), ['reddit.com', 'news.example.com']);
  assert.deepEqual(normalizeWebsites(''), []);
  assert.deepEqual(normalizeWebsites('https://例子.中国/'), ['xn--fsqu00a.xn--fiqs8s']);
});
test('invalid schemes, credentials, wildcards and malformed names are rejected', () => {
  for (const value of ['chrome://extensions', 'file:///tmp/test', 'javascript:alert(1)', 'https://a:b@example.com', '*.com', 'not a website', 'https://bad..com', '-bad.com'])
    assert.throws(() => normalizeWebsites(value), /网站格式/);
  assert.throws(() => normalizeWebsites(Array.from({length: 51}, (_, i) => `${i}.example.com`)), /50/);
});
test('custom sites match HTTP/HTTPS and real subdomains but not lookalikes or removed defaults', () => {
  const sites = ['reddit.com'];
  for (const url of ['http://reddit.com/a', 'https://old.reddit.com/r/test']) assert.equal(targetHost(url, sites), 'reddit.com');
  for (const url of ['https://reddit.com.evil.com', 'https://notreddit.com', 'https://youtube.com', 'file://reddit.com']) assert.equal(targetHost(url, sites), null);
  assert.equal(targetHost('https://reddit.com', []), null);
});
test('dynamic registration uses only granted origins and injects existing tabs', async () => {
  const {api} = fakeChrome(); const operations = [];
  api.permissions.contains = async ({origins}) => origins[0].startsWith('https:');
  api.scripting.registerContentScripts = async scripts => operations.push(scripts[0]);
  api.tabs.query = async query => { assert.deepEqual(query.url, ['https://*.reddit.com/*']); return [{id: 88}]; };
  api.scripting.executeScript = async options => operations.push(options);
  await syncWebsiteScripts(api, ['reddit.com']);
  assert.deepEqual(operations[0].matches, ['https://*.reddit.com/*']);
  assert.equal(operations[0].persistAcrossSessions, true);
  assert.equal(operations[1].target.tabId, 88);
});
test('existing registration updates and an empty list unregisters it', async () => {
  const {api} = fakeChrome(); let updated, removed;
  api.scripting.getRegisteredContentScripts = async () => [{id: 'configured-websites'}];
  api.scripting.updateContentScripts = async scripts => { updated = scripts; };
  api.scripting.unregisterContentScripts = async filter => { removed = filter; };
  await syncWebsiteScripts(api, ['example.com']);
  assert.deepEqual(updated[0].matches, websiteOrigins(['example.com']));
  await syncWebsiteScripts(api, []);
  assert.deepEqual(removed.ids, ['configured-websites']);
});
test('custom site saves, survives controller restart, counts and emits a reminder', async () => {
  const {api,world,sender} = fakeChrome();
  let controller = createController(api, {clock: () => world.now});
  assert.deepEqual((await controller.tick()).settings.websites, DEFAULT_WEBSITES);
  await controller.handle({type: 'saveWebsites', websites: ['example.com']}, sender);
  world.tabs[0].url = 'http://sub.example.com/read';
  world.local.settings.thresholdMinutes = 0.5;
  // Saving goal settings must not replace the website list.
  await controller.handle({type: 'saveSettings', settings: world.local.settings}, sender);
  controller = createController(api, {clock: () => world.now});
  const page = {frameId: 0, tab: world.tabs[0]};
  await controller.handle({type: 'pulse'}, page);
  world.now += MINUTE / 2;
  await controller.tick();
  assert.equal(world.session.timer.accumulatedMs, MINUTE / 2);
  assert.ok(world.session.timer.pending);
  assert.ok(world.sent.some(({message}) => message.type === 'reminder'));
  await controller.handle({type: 'saveWebsites', websites: []}, sender);
  assert.equal(world.session.timer.eligible, false);
  assert.equal(world.session.timer.pending, null);
  assert.deepEqual((await controller.tick()).settings.websites, []);
  await assert.rejects(controller.handle({type: 'pulse'}, page), /不支持/);
});
test('denied permissions and script registration failure preserve the saved list', async () => {
  const {api,world,sender} = fakeChrome();
  const controller = createController(api);
  api.permissions.contains = async () => false;
  await assert.rejects(controller.handle({type: 'saveWebsites', websites: ['example.com']}, sender), /权限/);
  assert.equal(world.local.websites, undefined);
  api.permissions.contains = async () => true;
  api.scripting.registerContentScripts = async () => { throw new Error('registration failed'); };
  await assert.rejects(controller.handle({type: 'saveWebsites', websites: ['example.com']}, sender), /registration failed/);
  assert.equal(world.local.websites, undefined);
});
