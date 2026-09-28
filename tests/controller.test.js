import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../extension/controller.js';
import { MINUTE } from '../extension/core.js';
import { fakeChrome } from './fake_chrome.js';
function fixture() {
  const f = fakeChrome(); let sequence = 0;
  f.controller = createController(f.api, { clock: () => f.world.now, id: () => `id-${++sequence}`, encouragements: [{ text: 'start', author: 'original' }] });
  f.wait = async ms => { for (let remaining = ms; remaining > 0;) { const delta = Math.min(remaining, 30_000); f.world.now += delta; remaining -= delta; await f.controller.tick(); } };
  return f;
}
test('cross-site integration: 8 + 2 break + 7 triggers once with stable ID', async () => {
  const f = fixture(); await f.controller.tick(); await f.wait(8 * MINUTE);
  f.world.windows[0].focused = false; await f.controller.tick(); await f.wait(2 * MINUTE);
  f.world.windows[0].focused = true; f.world.tabs[0].url = 'https://youtube.com/'; await f.controller.tick(); await f.wait(7 * MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, 15 * MINUTE);
  const pendingId = f.world.session.timer.pending.id; await f.controller.tick(); await f.controller.tick();
  assert.equal(f.world.session.timer.pending.id, pendingId); assert.equal(f.world.session.timer.reminderIndex, 1);
});
test('40-minute work break does not combine separate rests', async () => {
  const f = fixture(); await f.controller.tick(); await f.wait(8 * MINUTE);
  f.world.tabs[0].url = 'https://example.com'; await f.controller.tick(); await f.wait(40 * MINUTE);
  f.world.tabs[0].url = 'https://youtube.com'; await f.controller.tick(); await f.wait(7 * MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, 7 * MINUTE); assert.equal(f.world.session.timer.pending, null);
});
test('multiple windows only count focused active tab', async () => {
  const f = fixture(); f.world.windows.push({ id: 2, focused: false, type: 'normal' });
  f.world.tabs.push({ id: 11, windowId: 2, active: true, url: 'https://example.com' });
  await f.controller.tick(); await f.wait(MINUTE);
  f.world.windows[0].focused = false; f.world.windows[1].focused = true;
  await f.controller.tick(); await f.wait(MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, MINUTE);
});
test('concurrent pulses do not double-count or create duplicate IDs', async () => {
  const f = fixture(); f.world.local.settings.thresholdMinutes = 0.5; await f.controller.tick(); f.world.now = 30_000;
  await Promise.all(Array.from({ length: 12 }, () => f.controller.tick()));
  assert.equal(f.world.session.timer.accumulatedMs, 30_000); assert.equal(f.world.session.timer.reminderIndex, 1);
});
test('undeliverable reminder retries same ID after navigation', async () => {
  const f = fixture(); f.world.local.settings.thresholdMinutes = 0.5; await f.controller.tick(); f.world.delivery = false; await f.wait(30_000);
  const pendingId = f.world.session.timer.pending.id; assert.equal(f.world.session.timer.pending.shown, false);
  f.world.delivery = true; await f.controller.tick(); assert.equal(f.world.session.timer.pending.id, pendingId);
  await f.controller.handle({ type: 'reminderShown', id: pendingId }, { url: `chrome-extension://test/reminder.html?id=${pendingId}`, tab: f.world.tabs[0], frameId: 2 });
  assert.equal(f.world.session.timer.pending.shown, true);
});
test('worker recreation restores pending ID and elapsed time', async () => {
  const f = fixture(); f.world.local.settings.thresholdMinutes = 0.5; await f.controller.tick(); await f.wait(30_000);
  const pendingId = f.world.session.timer.pending.id;
  f.controller = createController(f.api, { clock: () => f.world.now }); await f.controller.tick();
  assert.equal(f.world.session.timer.pending.id, pendingId); assert.equal(f.world.session.timer.accumulatedMs, 30_000);
});
test('snooze excludes unfocused time and duplicate response cannot snooze twice', async () => {
  const f = fixture(); f.world.local.settings.thresholdMinutes = 0.5; await f.controller.tick(); await f.wait(30_000);
  const id = f.world.session.timer.pending.id;
  await f.controller.handle({ type: 'respond', id, action: 'snooze' }, f.sender);
  assert.equal(f.world.session.timer.nextReminderAtMs, 330_000);
  assert.deepEqual(await f.controller.handle({ type: 'respond', id, action: 'snooze' }, f.sender), { ok: false });
  f.world.windows[0].focused = false; await f.controller.tick(); await f.wait(2 * MINUTE);
  f.world.windows[0].focused = true; await f.controller.tick(); await f.wait(5 * MINUTE);
  assert.ok(f.world.session.timer.pending);
});
test('return opens local focus page and resets', async () => {
  const f = fixture(); f.world.local.settings.thresholdMinutes = 0.5; await f.controller.tick(); await f.wait(30_000);
  await f.controller.handle({ type: 'respond', id: f.world.session.timer.pending.id, action: 'return' }, f.sender);
  assert.equal(f.world.opened[0].url, 'chrome-extension://test/options.html#focus'); assert.equal(f.world.session.timer.accumulatedMs, 0);
});
test('learning lasts across controller restart and expires after 60 minutes', async () => {
  const f = fixture(); await f.controller.tick(); await f.controller.handle({ type: 'learning' }, f.sender);
  assert.equal(f.world.session.timer.eligible, false);
  f.controller = createController(f.api, { clock: () => f.world.now }); f.world.now = 60 * MINUTE - 1; await f.controller.tick(); assert.equal(f.world.session.timer.eligible, false);
  f.world.now++; await f.controller.tick(); assert.equal(f.world.session.timer.eligible, true);
});
test('learning toggle, closing tab, and non-target error', async () => {
  const f = fixture(); await f.controller.handle({ type: 'learning' }, f.sender); await f.controller.handle({ type: 'learning' }, f.sender); assert.equal(f.world.session.timer.eligible, true);
  await f.controller.handle({ type: 'learning' }, f.sender); await f.controller.removeTab(10); assert.equal(f.world.session.timer.learning[10], undefined);
  f.world.tabs[0].url = 'https://example.com'; await assert.rejects(f.controller.handle({ type: 'learning' }, f.sender), /请先打开/);
});
test('passive video continues but lock always pauses', async () => {
  const f = fixture(); f.world.idle = 'idle'; f.world.videoPlaying = true; await f.controller.tick(); await f.wait(MINUTE); assert.equal(f.world.session.timer.accumulatedMs, MINUTE);
  f.world.idle = 'locked'; await f.controller.tick(); await f.wait(MINUTE); assert.equal(f.world.session.timer.accumulatedMs, MINUTE);
});
test('preview never mutates timer or rotation index', async () => {
  const f = fixture(); await f.controller.tick(); const state = structuredClone(f.world.session.timer);
  await f.controller.handle({ type: 'preview', index: 2 }, f.sender); assert.deepEqual(f.world.session.timer, state);
});
test('settings save validates, persists, resets and continues', async () => {
  const f = fixture(); await f.controller.tick(); await f.wait(MINUTE);
  await f.controller.handle({ type: 'saveSettings', settings: { goal: 'new', thresholdMinutes: 2, enabled: true } }, f.sender);
  assert.equal(f.world.local.settings.goal, 'new'); assert.equal(f.world.session.timer.accumulatedMs, 0); assert.equal(f.world.session.timer.nextReminderAtMs, 2 * MINUTE);
  await assert.rejects(f.controller.handle({ type: 'saveSettings', settings: { goal: '', thresholdMinutes: 0 } }, f.sender));
});
test('global pause resumes in fresh session', async () => {
  const f = fixture(); await f.controller.tick(); await f.wait(MINUTE);
  await f.controller.handle({ type: 'toggle' }, f.sender); await f.wait(MINUTE); assert.equal(f.world.session.timer.accumulatedMs, 0);
  await f.controller.handle({ type: 'toggle' }, f.sender); assert.equal(f.world.session.timer.eligible, true);
});
test('rejects website configuration messages and subframes', async () => {
  const f = fixture(); const target = { tab: f.world.tabs[0], frameId: 0 };
  await assert.rejects(f.controller.handle({ type: 'saveSettings', settings: {} }, target), /只能在扩展设置/);
  await assert.rejects(f.controller.handle({ type: 'pulse' }, { ...target, frameId: 1 }), /消息来源/);
  await assert.rejects(f.controller.handle({ type: 'pulse' }, { tab: { url: 'https://example.com' }, frameId: 0 }), /消息来源/);
  await f.controller.handle({ type: 'pulse' }, target);
});
test('project save size validation and deletion remove pending content', async () => {
  const f = fixture(); await f.controller.tick();
  await assert.rejects(f.controller.handle({ type: 'saveProjects', projects: [1, 2, 3] }, f.sender));
  await f.controller.handle({ type: 'saveProjects', projects: [{ name: 'demo', snippets: [{ text: 'hello', path: 'README.md' }] }] }, f.sender);
  assert.equal(f.world.local.projects.length, 1);
  await f.controller.handle({ type: 'saveProjects', projects: [] }, f.sender); assert.deepEqual(f.world.local.projects, []);
});
test('clear removes user data and disables counting until a goal exists', async () => {
  const f = fixture(); await f.controller.tick(); await f.controller.handle({ type: 'clear' }, f.sender);
  assert.deepEqual(f.world.local, {}); assert.equal(f.world.session.timer.eligible, false);
});
test('hides previous tab reminder when switching away', async () => {
  const f = fixture(); f.world.local.settings.thresholdMinutes = 0.5; await f.controller.tick(); await f.wait(30_000);
  f.world.windows[0].focused = false; await f.controller.tick();
  assert.ok(f.world.sent.some(({ tabId, message }) => tabId === 10 && message.type === 'hide'));
});
test('private card content only goes to extension-origin frame with current ID', async () => {
  const f = fixture(); f.world.local.settings.thresholdMinutes = 0.5; await f.controller.tick(); await f.wait(30_000);
  const id = f.world.session.timer.pending.id;
  const frame = { url: `chrome-extension://test/reminder.html?id=${id}`, tab: f.world.tabs[0], frameId: 2 };
  const card = await f.controller.handle({ type: 'getReminder', id }, frame); assert.ok(card.text.includes('Finish the project'));
  assert.equal(f.world.sent.some(({ message }) => JSON.stringify(message).includes('Finish the project')), false);
  await assert.rejects(f.controller.handle({ type: 'getReminder', id }, { tab: f.world.tabs[0], frameId: 0 }), /只能在扩展设置/);
  await assert.rejects(f.controller.handle({ type: 'getReminder', id: 'wrong' }, frame), /已经结束/);
  await assert.rejects(f.controller.handle({ type: 'getReminder', id }, { ...frame, tab: { id: 99 } }), /已经结束/);
  assert.equal((await f.controller.handle({ type: 'getReminder', id }, { url: frame.url })).kind, 'goal');
});
test('saved user inspirations replace defaults and survive controller recreation', async () => {
  const f = fixture();
  await f.controller.handle({ type: 'saveInspirations', inspirations: [{ sourceUrl: 'https://example.com/post', text: '自己的鼓励', author: '自己' }] }, f.sender);
  f.controller = createController(f.api, { clock: () => f.world.now, encouragements: [{ text: 'default' }] });
  const card = await f.controller.handle({ type: 'preview', index: 1 }, f.sender);
  assert.equal(card.text, '自己的鼓励'); assert.equal(card.sourceUrl, 'https://example.com/post');
  assert.equal((await f.controller.handle({ type: 'status' }, f.sender)).inspirations.length, 1);
  await f.controller.handle({ type: 'saveInspirations', inspirations: [] }, f.sender);
  assert.equal((await f.controller.handle({ type: 'preview', index: 1 }, f.sender)).text, 'default');
});
test('website scripts cannot edit inspiration collection', async () => {
  const f = fixture();
  await assert.rejects(f.controller.handle({ type: 'saveInspirations', inspirations: [] }, { tab: f.world.tabs[0], frameId: 0 }), /只能在扩展设置/);
});

test('focused action popup preserves timing and learning when its parent loses window focus', async () => {
  const f = fixture();
  f.world.windows[0].focused = false;
  f.api.runtime.sendMessage = async () => ({ focused: true, windowId: 1 });
  const status = await f.controller.tick();
  assert.equal(status.isTarget, true);
  assert.equal(status.state.eligible, true);
  await f.wait(MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, MINUTE);
  await f.controller.handle({ type: 'learning' }, f.sender);
  assert.match(f.world.session.timer.reason, /学习模式/);
});
test('popup losing focus stops accumulation even if visible and video playing', async () => {
  const f = fixture(); f.world.windows[0].focused = false;
  let focused = true;
  f.api.runtime.sendMessage = async () => ({ focused, windowId: 1 });
  await f.controller.tick(); await f.wait(MINUTE);
  focused = false; f.world.videoPlaying = true;
  await f.controller.tick(); await f.wait(MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, MINUTE);
  assert.equal(f.world.session.timer.reason, 'Chrome 不在前台');
});
test('missing popup, stale window and minimized window cannot establish foreground', async () => {
  for (const response of [undefined, { focused: false, windowId: 1 }, { focused: true, windowId: 99 }, { focused: true, windowId: 1 }]) {
    const f = fixture(); f.world.windows[0].focused = false;
    if (response?.windowId === 1 && response.focused) f.world.windows[0].state = 'minimized';
    f.api.runtime.sendMessage = async () => response;
    assert.equal((await f.controller.tick()).state.eligible, false);
  }
});
test('focused browser popup window counts its active target tab', async () => {
  const f = fixture(); f.world.windows[0].type = 'popup';
  assert.equal((await f.controller.tick()).state.eligible, true);
});

test('visible playing background video stops on document blur despite stale window focus', async () => {
  const f = fixture(); f.world.documentFocused = true; f.world.videoPlaying = true;
  await f.controller.tick(); await f.wait(MINUTE);
  f.world.documentFocused = false;
  await f.controller.tick(); await f.wait(2 * MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, MINUTE);
  assert.equal(f.world.session.timer.eligible, false);
  f.world.documentFocused = true;
  await f.controller.tick(); await f.wait(MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, 2 * MINUTE);
});
test('live focused target recovers accumulation when window API says unfocused', async () => {
  const f = fixture(); f.world.windows[0].focused = false; f.world.documentFocused = true;
  await f.controller.tick(); await f.wait(MINUTE);
  assert.equal(f.world.session.timer.accumulatedMs, MINUTE);
  assert.equal(f.world.session.timer.eligible, true);
});
test('hidden or minimized target cannot recover foreground from a focus sample', async () => {
  for (const minimized of [false, true]) {
    const f = fixture(); f.world.windows[0].focused = false; f.world.documentFocused = true;
    if (minimized) f.world.windows[0].state = 'minimized';
    else f.world.visible = false;
    assert.equal((await f.controller.tick()).state.eligible, false);
  }
});
