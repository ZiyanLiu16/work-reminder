import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const cardCode = await readFile(new URL('../extension/card.js', import.meta.url), 'utf8');
const contentCode = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
function setup() {
  const dom = new JSDOM('<!doctype html><html><body><video></video></body></html>', { url: 'https://youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(cardCode); return dom;
}
test('card uses text nodes so hostile repo content cannot execute', () => {
  const dom = setup(); const host = dom.window.WorkReminderCard.create({ title: '<img src=x onerror=alert(1)>', text: '<script>bad()</script>', snippet: '<iframe src=evil></iframe>', path: 'a.js', line: 1, importedAt: 0 });
  dom.window.document.body.append(host);
  assert.equal(host.shadowRoot.querySelector('img,script,iframe'), null); assert.match(host.shadowRoot.textContent, /<script>/); dom.window.close();
});
test('card isolates styles, provides accessible controls and removes on action', async () => {
  const dom = setup(); const actions = []; const host = dom.window.WorkReminderCard.create({ title: 'Hi', text: 'Goal' }, { onAction: action => actions.push(action) });
  dom.window.document.body.append(host); assert.ok(host.shadowRoot.querySelector('[aria-label="关闭提醒"]'));
  host.shadowRoot.querySelector('.primary').click(); await Promise.resolve();
  assert.deepEqual(actions, ['return']); assert.equal(host.isConnected, false); dom.window.close();
});
test('connection failure leaves a retryable card', async () => {
  const dom = setup(); const host = dom.window.WorkReminderCard.create({ title: 'Hi' }, { onAction: () => { throw new Error('offline'); } });
  dom.window.document.body.append(host); host.shadowRoot.querySelector('.primary').click(); await Promise.resolve();
  assert.ok(host.isConnected); assert.match(host.shadowRoot.querySelector('.error').textContent, /刷新/); assert.equal(host.shadowRoot.querySelector('.primary').disabled, false); dom.window.close();
});
test('HTTP Xiaohongshu source remains clickable on the actual card', () => {
  const dom = setup(); const sourceUrl = 'http://xhslink.com/o/1q65Rm2gonl';
  const host = dom.window.WorkReminderCard.create({ title: '鼓励', text: '开始行动', sourceUrl });
  const link = host.shadowRoot.querySelector('a');
  assert.equal(link.href, sourceUrl); assert.equal(link.target, '_blank'); assert.match(link.rel, /noopener/);
  dom.window.close();
});
function contentFixture() {
  const dom = setup(); let listener; const sent = [];
  dom.window.chrome = { runtime: { getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => listener = fn }, sendMessage: async msg => { sent.push(msg); return { ok: true }; } } };
  dom.window.eval(contentCode);
  return { dom, sent, message: msg => { let result; listener(msg, {}, response => result = response); return result; } };
}
test('content script deduplicates reminder IDs and responds to hide', () => {
  const f = contentFixture(); const msg = { type: 'reminder', id: 'a', card: { title: 'Hello', text: 'Goal' } };
  assert.equal(f.message(msg).shown, true); const host = f.dom.window.document.querySelector('iframe[data-work-reminder]');
  f.message(msg); assert.equal(f.dom.window.document.querySelector('iframe[data-work-reminder]'), host);
  assert.equal(f.dom.window.document.querySelectorAll('iframe[data-work-reminder]').length, 1);
  f.message({ type: 'hide' }); assert.equal(host.isConnected, false); f.dom.window.close();
});
test('content video detection excludes paused, buffering, ended and PiP', () => {
  const f = contentFixture(); const video = f.dom.window.document.querySelector('video');
  for (const [key, value] of Object.entries({ paused: false, ended: false, readyState: 4 })) Object.defineProperty(video, key, { value, configurable: true });
  assert.equal(f.message({ type: 'sample' }).videoPlaying, true);
  Object.defineProperty(video, 'readyState', { value: 2, configurable: true }); assert.equal(f.message({ type: 'sample' }).videoPlaying, false);
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true }); Object.defineProperty(f.dom.window.document, 'pictureInPictureElement', { value: video }); assert.equal(f.message({ type: 'sample' }).videoPlaying, false);
  f.dom.window.close();
});
test('native video fullscreen defers overlay until fullscreen exits', () => {
  const f = contentFixture(); const document = f.dom.window.document;
  Object.defineProperty(document, 'fullscreenElement', { value: document.querySelector('video'), configurable: true });
  assert.equal(f.message({ type: 'reminder', id: 'a', card: { title: 'hello' } }).shown, false);
  assert.equal(document.querySelector('iframe[data-work-reminder]'), null);
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  document.dispatchEvent(new f.dom.window.Event('fullscreenchange'));
  assert.ok(document.querySelector('iframe[data-work-reminder]')); f.dom.window.close();
});
test('fullscreen container mounts card inside fullscreen element', () => {
  const f = contentFixture(); const document = f.dom.window.document;
  Object.defineProperty(document, 'fullscreenElement', { value: document.body });
  f.message({ type: 'reminder', id: 'a', card: { title: 'hello' } }); assert.equal(document.querySelector('iframe[data-work-reminder]').parentElement, document.body); f.dom.window.close();
});
test('content samples document focus and sends rapid blur/focus without throttling', () => {
  const f = contentFixture();
  let focused = true;
  f.dom.window.document.hasFocus = () => focused;
  assert.equal(f.message({ type: 'sample' }).focused, true);
  const before = f.sent.length;
  focused = false; f.dom.window.dispatchEvent(new f.dom.window.Event('blur'));
  assert.equal(f.message({ type: 'sample' }).focused, false);
  focused = true; f.dom.window.dispatchEvent(new f.dom.window.Event('focus'));
  assert.equal(f.sent.length, before + 2);
  f.dom.window.close();
});
test('reinjecting content script does not duplicate its startup pulse or timers', () => {
  const f = contentFixture(); const before = f.sent.length;
  f.dom.window.eval(contentCode);
  assert.equal(f.sent.length, before);
  f.dom.window.close();
});
