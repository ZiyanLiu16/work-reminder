import test from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, BREAK_MS, MAX_GAP_MS, freshState, advance, eligibility, isDue, respond, targetHost, validateSettings, formatDuration } from '../extension/core.js';
const active = { eligible: true, reason: 'active' };
const paused = { eligible: false, reason: 'paused' };
function run(state, duration, observation = active) {
  let time = state.lastObservedAt;
  for (let left = duration; left > 0;) {
    const delta = Math.min(left, 30_000); left -= delta; time += delta;
    state = advance(state, time, observation, 15 * MINUTE);
  }
  return state;
}
const start = () => advance(freshState(0), 0, active, 15 * MINUTE);
for (const url of ['https://youtube.com/watch?v=a', 'https://www.bilibili.com/video/a', 'https://www.xiaohongshu.com/explore', 'https://m.youtube.com'])
  test(`recognizes ${url}`, () => assert.ok(targetHost(url)));
for (const url of ['https://youtube.com.evil.test', 'https://notyoutube.com', 'file:///youtube.com', 'chrome://newtab', undefined, 'not a URL'])
  test(`rejects unsupported target ${url}`, () => assert.equal(targetHost(url), null));
test('8 minutes + 7 minutes on another target reaches threshold', () => {
  const state = run(run(start(), 8 * MINUTE), 7 * MINUTE);
  assert.equal(state.accumulatedMs, 15 * MINUTE); assert.ok(isDue(state));
});
test('8 min + 2 min break + 7 min counts only 15 browsing minutes', () => {
  let state = run(start(), 8 * MINUTE);
  state = advance(state, state.lastObservedAt, paused, 15 * MINUTE);
  state = run(state, 2 * MINUTE, paused);
  state = advance(state, state.lastObservedAt, active, 15 * MINUTE);
  state = run(state, 7 * MINUTE);
  assert.equal(state.accumulatedMs, 15 * MINUTE); assert.ok(isDue(state));
});
for (const breakTime of [5 * MINUTE, 40 * MINUTE]) test(`${breakTime / MINUTE} minute break resets old time`, () => {
  let state = run(start(), 8 * MINUTE);
  state = advance(state, state.lastObservedAt, paused, 15 * MINUTE);
  state = run(state, breakTime, paused);
  state = advance(state, state.lastObservedAt, active, 15 * MINUTE);
  state = run(state, 7 * MINUTE);
  assert.equal(state.accumulatedMs, 7 * MINUTE); assert.equal(isDue(state), false);
});
test('4:59 break preserves elapsed; boundary at exactly 5:00 resets', () => {
  let state = run(start(), MINUTE); state = advance(state, state.lastObservedAt, paused, 15 * MINUTE);
  state = run(state, BREAK_MS - 1, paused); assert.equal(state.accumulatedMs, MINUTE);
  state = advance(state, state.lastObservedAt + 1, active, 15 * MINUTE); assert.equal(state.accumulatedMs, 0);
});
test('foreground transition settles previous state', () => {
  const state = advance(start(), 10_000, paused, 15 * MINUTE);
  assert.equal(state.accumulatedMs, 10_000);
  assert.equal(advance(state, 20_000, active, 15 * MINUTE).accumulatedMs, 10_000);
});
test('long sleep never accrues browsing and resets session', () => {
  const before = run(start(), 8 * MINUTE);
  const after = advance(before, before.lastObservedAt + 8 * 60 * MINUTE, active, 15 * MINUTE);
  assert.equal(after.accumulatedMs, 0); assert.equal(isDue(after), false);
});
test('suspicious gap is discarded without adding time', () => {
  const before = run(start(), MINUTE);
  assert.equal(advance(before, before.lastObservedAt + MAX_GAP_MS + 1, active, 15 * MINUTE).accumulatedMs, MINUTE);
});
test('clock rollback resets without negative accumulated time', () => assert.equal(advance(run(start(), MINUTE), 1, active, 15 * MINUTE).accumulatedMs, 0));
test('same timestamp cannot double count', () => {
  const state = run(start(), MINUTE); assert.equal(advance(state, state.lastObservedAt, active, 15 * MINUTE).accumulatedMs, MINUTE);
});
test('state survives serialization and worker restarts', () => {
  let state = JSON.parse(JSON.stringify(run(start(), 8 * MINUTE))); state = run(state, 7 * MINUTE); assert.ok(isDue(state));
});
const input = { settings: { goal: 'test', enabled: true }, focused: true, url: 'https://youtube.com', idle: 'active', visible: true, videoPlaying: false, now: 100 };
for (const [name, change, expected] of [
  ['foreground browsing', {}, true], ['unfocused window', { focused: false }, false], ['different website', { url: 'https://example.com' }, false],
  ['locked while playing', { idle: 'locked', videoPlaying: true }, false], ['idle without video', { idle: 'idle' }, false],
  ['passive watching', { idle: 'idle', videoPlaying: true }, true], ['hidden playing video', { idle: 'idle', videoPlaying: true, visible: false }, false],
  ['learning', { learningUntil: 101 }, false], ['learning expiry', { learningUntil: 100 }, true],
  ['paused globally', { settings: { goal: 'test', enabled: false } }, false], ['empty goal', { settings: { goal: '', enabled: true } }, false]
]) test(`eligibility: ${name}`, () => assert.equal(eligibility({ ...input, ...change }).eligible, expected));
for (const [action, remaining] of [['close', 15], ['snooze', 5]]) test(`${action} schedules next reminder by browsing time`, () => {
  const state = { ...run(start(), 15 * MINUTE), pending: { id: 'a' } };
  const next = respond(state, 'a', action, state.lastObservedAt, 15 * MINUTE);
  assert.equal(next.pending, null); assert.equal(next.nextReminderAtMs - next.accumulatedMs, remaining * MINUTE); assert.equal(isDue(next), false);
});
test('return clears accumulated time', () => {
  const state = { ...run(start(), 15 * MINUTE), pending: { id: 'a' } };
  assert.equal(respond(state, 'a', 'return', state.lastObservedAt, 15 * MINUTE).accumulatedMs, 0);
});
test('duplicate and stale actions are no-ops', () => {
  const state = { ...start(), pending: { id: 'a' } }; assert.equal(respond(state, 'b', 'close', 0, MINUTE), state);
  const clean = start(); assert.equal(respond(clean, 'a', 'close', 0, MINUTE), clean);
});
test('pending reminder cannot generate another', () => assert.equal(isDue({ ...run(start(), 20 * MINUTE), pending: { id: 'a' } }), false));
test('advance is immutable', () => { const state = start(); const copy = structuredClone(state); run(state, MINUTE); assert.deepEqual(state, copy); });
test('settings trim goal and accept test interval', () => assert.deepEqual(validateSettings({ goal: ' hi ', thresholdMinutes: 0.5 }), { goal: 'hi', thresholdMinutes: 0.5, enabled: true }));
for (const thresholdMinutes of [0, -1, NaN, Infinity, 121]) test(`invalid threshold ${thresholdMinutes}`, () => assert.throws(() => validateSettings({ goal: 'a', thresholdMinutes })));
test('goal required and bounded', () => { assert.throws(() => validateSettings({ goal: ' ', thresholdMinutes: 15 })); assert.throws(() => validateSettings({ goal: 'a'.repeat(301), thresholdMinutes: 15 })); });
test('duration displays minutes and seconds', () => { assert.equal(formatDuration(90_999), '01:30'); assert.equal(formatDuration(-1), '00:00'); });
test('HTTP target sites are supported alongside HTTPS', () => {
  assert.equal(targetHost('http://youtube.com/watch?v=test'), 'youtube.com');
});
