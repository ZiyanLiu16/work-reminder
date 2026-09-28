import { normalizeWebsites, websiteOrigins } from '../extension/websites.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createController } from '../extension/controller.js';
import { formatDuration } from '../extension/core.js';
import { importProject } from '../extension/repository.js';
import { fakeChrome } from './fake_chrome.js';
const html = await readFile(new URL('../extension/options.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../extension/options.js', import.meta.url), 'utf8');
const card = await readFile(new URL('../extension/card.js', import.meta.url), 'utf8');
async function fixture() {
  const f = fakeChrome();
  f.world.tabs[0].url = 'chrome-extension://test/options.html';
  const controller = createController(f.api, { clock: () => f.world.now, encouragements: [{ text: 'encouragement', author: 'original' }] });
  const dom = new JSDOM(html, { url: 'chrome-extension://test/options.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.setInterval = () => 0;
  w.request = (type, payload = {}) => controller.handle({ type, ...payload }, f.sender);
  w.$ = selector => w.document.querySelector(selector);
  w.node = (tag, text, className) => { const el = w.document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  w.normalizeWebsites = normalizeWebsites; w.websiteOrigins = websiteOrigins; w.formatDuration = formatDuration; w.importProject = importProject;
  w.chrome = { ...f.api, alarms: { get: async () => ({}) }, permissions: { ...f.api.permissions, getAll: async () => ({ origins: ['https://*.youtube.com/*'] }) }, runtime: { ...f.api.runtime, getManifest: () => ({ version: '0.1.0' }) } };
  w.eval(card);
  // Unit harness supplies ESM dependencies; production scripts are unchanged.
  await w.eval(`(async () => { ${script.replace(/^import .*;\n/gm, '')} })()`);
  return { ...f, dom, w, $: w.$ };
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
test('settings form saves user goal and test threshold through real controller', async () => {
  const f = await fixture(); f.$('#goal').value = '完成一个项目'; f.$('#threshold').value = '0.5';
  f.$('#settings-form').dispatchEvent(new f.w.Event('submit', { cancelable: true })); await settle();
  assert.equal(f.world.local.settings.goal, '完成一个项目'); assert.equal(f.world.local.settings.thresholdMinutes, 0.5);
  assert.match(f.$('#save-status').textContent, /已保存/); f.dom.window.close();
});
test('invalid input surfaces error rather than silently changing settings', async () => {
  const f = await fixture(); f.$('#goal').value = ''; f.$('#settings-form').dispatchEvent(new f.w.Event('submit', { cancelable: true })); await settle();
  assert.match(f.$('#save-status').textContent, /填写/); assert.equal(f.world.local.settings.goal, 'Finish the project'); f.dom.window.close();
});
test('preview rotates and leaves timer state untouched', async () => {
  const f = await fixture(); const before = structuredClone(f.world.session.timer);
  f.$('#preview').click(); await settle(); let host = f.$('work-reminder-card'); assert.match(host.shadowRoot.textContent, /回到你在意的事/);
  f.$('#preview').click(); await settle(); host = f.$('work-reminder-card'); assert.match(host.shadowRoot.textContent, /给自己一点鼓励/);
  assert.deepEqual(f.world.session.timer, before); assert.equal(f.w.document.querySelectorAll('work-reminder-card').length, 1); f.dom.window.close();
});
test('repository import previews, unchecks and saves selected snippets', async () => {
  const f = await fixture(); const text = 'A sufficiently detailed project paragraph explaining the next steps.';
  const files = ['README.md', 'docs/plan.md'].map(path => ({ webkitRelativePath: `demo/${path}`, name: path.split('/').at(-1), size: text.length, text: async () => text }));
  Object.defineProperty(f.$('#project-files'), 'files', { value: files });
  await f.$('#project-files').onchange({ target: f.$('#project-files') });
  assert.equal(f.$('#import-preview').hidden, false); assert.equal(f.w.document.querySelectorAll('#candidate-list input').length, 2);
  const selectAll = f.$('#select-all-snippets');
  assert.equal(selectAll.checked, true);
  assert.match(f.$('#snippet-selection-count').textContent, /2 \/ 2/);
  selectAll.click();
  assert.equal(f.w.document.querySelectorAll('#candidate-list input:checked').length, 0);
  f.$('#save-project').click(); await settle();
  assert.equal(f.world.local.projects.length, 0);
  assert.match(f.$('#project-status').textContent, /至少选择/);
  selectAll.click();
  assert.equal(f.w.document.querySelectorAll('#candidate-list input:checked').length, 2);
  f.$('#candidate-list input').click();
  assert.equal(selectAll.checked, false); assert.equal(selectAll.indeterminate, true);
  assert.match(f.$('#snippet-selection-count').textContent, /1 \/ 2/);
  selectAll.click();
  assert.equal(selectAll.checked, true); assert.equal(selectAll.indeterminate, false);
  f.$('#candidate-list input').click();
  f.$('#save-project').click(); await settle();
  assert.equal(f.world.local.projects.length, 1); assert.equal(f.world.local.projects[0].snippets.length, 1); assert.equal(f.world.local.projects[0].snippets[0].path, 'docs/plan.md');
  assert.equal(f.$('#import-preview').hidden, true); assert.match(f.$('#projects').textContent, /demo/); f.dom.window.close();
});
test('discard import leaves storage unchanged', async () => {
  const f = await fixture(); const file = { webkitRelativePath: 'demo/README.md', name: 'README.md', size: 100, text: async () => 'A sufficiently detailed paragraph explaining a project.' };
  Object.defineProperty(f.$('#project-files'), 'files', { value: [file] }); await f.$('#project-files').onchange({ target: f.$('#project-files') });
  f.$('#discard-project').click(); assert.deepEqual(f.world.local.projects, []); assert.equal(f.$('#import-preview').hidden, true); f.dom.window.close();
});
test('pause and diagnostics work through the UI', async () => {
  const f = await fixture(); f.$('#toggle').click(); await settle(); assert.equal(f.world.local.settings.enabled, false); assert.equal(f.$('#toggle').textContent, '继续提醒');
  f.$('#diagnose').click(); await settle(); assert.match(f.$('#diagnostics').textContent, /后台连接：正常/); assert.match(f.$('#diagnostics').textContent, /后台错误：无/); f.dom.window.close();
});
test('onboarding offers all three in-product input sections', async () => {
  const f = await fixture();
  for (const anchor of ['#goal-section', '#project-section', '#inspiration-section']) {
    assert.ok(f.$(`nav a[href="${anchor}"]`)); assert.ok(f.$(anchor));
  }
  assert.match(f.$('#goal-progress').textContent, /已保存/); f.dom.window.close();
});
test('user adds an inspiration, previews it and removes it without editing code', async () => {
  const f = await fixture();
  f.$('#inspiration-url').value = 'https://www.xiaohongshu.com/explore/example';
  f.$('#inspiration-text').value = '先行动五分钟。'; f.$('#inspiration-author').value = '收藏的博主';
  f.$('#inspiration-form').dispatchEvent(new f.w.Event('submit', { cancelable: true })); await settle();
  assert.equal(f.world.local.inspirations[0].text, '先行动五分钟。'); assert.match(f.$('#inspiration-progress').textContent, /1 条/);
  f.$('#preview').click(); await settle(); f.$('#preview').click(); await settle();
  assert.match(f.$('work-reminder-card').shadowRoot.textContent, /先行动五分钟/);
  f.$('#inspirations button').click(); await settle(); assert.equal(f.world.local.inspirations.length, 0); f.dom.window.close();
});
test('inspiration form rejects unsafe URLs without losing typed input', async () => {
  const f = await fixture(); f.$('#inspiration-url').value = 'javascript:alert(1)';
  f.$('#inspiration-form').dispatchEvent(new f.w.Event('submit', { cancelable: true })); await settle();
  assert.match(f.$('#inspiration-status').textContent, /HTTPS/); assert.equal(f.$('#inspiration-url').value, 'javascript:alert(1)'); assert.equal(f.world.local.inspirations, undefined); f.dom.window.close();
});
test('consecutive additions keep earlier entries and display HTTP links', async () => {
  const f = await fixture();
  for (const [sourceUrl, text] of [['http://xhslink.com/o/1q65Rm2gonl', '第一条'], ['https://example.com/second', '第二条']]) {
    f.$('#inspiration-url').value = sourceUrl; f.$('#inspiration-text').value = text;
    f.$('#inspiration-form').dispatchEvent(new f.w.Event('submit', { cancelable: true })); await settle();
  }
  assert.deepEqual(f.world.local.inspirations.map(entry => entry.text), ['第一条', '第二条']);
  assert.equal(f.w.document.querySelectorAll('#inspirations a').length, 2);
  assert.equal(f.$('#inspirations a').href, 'http://xhslink.com/o/1q65Rm2gonl');
  assert.match(f.$('#inspiration-status').textContent, /第 2 条.*轮换/);
  assert.equal(f.$('#inspiration-url').value, '');
  f.dom.window.close();
});
test('website editor loads defaults and saves normalized custom sites without changing goal', async () => {
  const f = await fixture();
  assert.match(f.$('#websites-list').textContent, /youtube.com/);
  assert.equal(f.$('#websites-form').hidden, true);
  f.$('#edit-websites').click();
  assert.equal(f.$('#websites-form').hidden, false);
  f.$('#websites').value = 'https://www.reddit.com/r/test\nexample.com';
  f.$('#websites-form').dispatchEvent(new f.w.Event('submit', {cancelable: true})); await settle();
  assert.deepEqual(f.world.local.websites, ['reddit.com', 'example.com']);
  assert.equal(f.world.local.settings.goal, 'Finish the project');
  assert.match(f.$('#websites-status').textContent, /已保存 2/);
  assert.equal(f.$('#websites-form').hidden, true);
  assert.equal(f.$('#websites-saved').hidden, false);
  assert.deepEqual([...f.$('#websites-list').children].map(el => el.textContent), ['reddit.com', 'example.com']);
  f.dom.window.close();
});
test('denied website permission shows feedback and preserves the list', async () => {
  const f = await fixture(); f.w.chrome.permissions.request = async () => false;
  f.$('#edit-websites').click();
  f.$('#websites').value = 'example.com';
  f.$('#websites-form').dispatchEvent(new f.w.Event('submit', {cancelable: true})); await settle();
  assert.equal(f.world.local.websites, undefined);
  assert.match(f.$('#websites-status').textContent, /未获得网站权限/);
  assert.equal(f.$('#websites-form').hidden, false);
  assert.equal(f.$('#websites').value, 'example.com');
  assert.equal(f.$('#websites-form button').disabled, false);
  f.dom.window.close();
});

test('cancel website editing restores saved content without changing storage', async () => {
  const f = await fixture(); const original = f.$('#websites').value;
  f.$('#edit-websites').click(); f.$('#websites').value = 'unsaved.example.com';
  f.$('#cancel-websites').click();
  assert.equal(f.$('#websites-form').hidden, true);
  assert.equal(f.world.local.websites, undefined);
  f.$('#edit-websites').click(); assert.equal(f.$('#websites').value, original);
  f.$('#websites').value = '';
  f.$('#websites-form').dispatchEvent(new f.w.Event('submit', {cancelable: true})); await settle();
  assert.equal(f.$('#websites-form').hidden, true);
  assert.match(f.$('#websites-summary').textContent, /当前不监控/);
  assert.equal(f.$('#websites-list').children.length, 0);
  f.dom.window.close();
});
