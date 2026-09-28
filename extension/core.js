import { DEFAULT_WEBSITES } from './websites.js';
export const MINUTE = 60_000;
export const BREAK_MS = 5 * MINUTE;
export const MAX_GAP_MS = 90_000;
export const TARGETS = DEFAULT_WEBSITES;
export const DEFAULT_SETTINGS = { goal: '', enabled: true, thresholdMinutes: 15 };

export function targetHost(url, websites = TARGETS) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && websites.find(host =>
      parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)) || null;
  } catch { return null; }
}

export function validateSettings(value) {
  const goal = String(value.goal ?? '').trim();
  const thresholdMinutes = Number(value.thresholdMinutes);
  if (!goal || goal.length > 300) throw new Error('请填写 1–300 字的目标。');
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes < 0.5 || thresholdMinutes > 120)
    throw new Error('提醒间隔应在 0.5–120 分钟之间。');
  return { goal, thresholdMinutes, enabled: value.enabled !== false };
}

export function freshState(now, thresholdMs = 15 * MINUTE, reminderIndex = 0) {
  return { accumulatedMs: 0, lastObservedAt: now, inactiveSince: now,
    eligible: false, nextReminderAtMs: thresholdMs, pending: null,
    reminderIndex, sequence: 0, reason: '等待目标网站', learning: {} };
}

export function eligibility({ settings, focused, url, idle, videoPlaying, visible, learningUntil = 0, now }) {
  if (!settings.goal) return { eligible: false, reason: '先填写你的目标' };
  if (!settings.enabled) return { eligible: false, reason: '提醒已暂停' };
  if (!focused) return { eligible: false, reason: 'Chrome 不在前台' };
  if (!targetHost(url, settings.websites)) return { eligible: false, reason: '当前不是目标网站' };
  if (learningUntil > now) return { eligible: false, reason: '本标签页学习模式中' };
  if (idle === 'locked') return { eligible: false, reason: '屏幕已锁定' };
  if (idle === 'idle' && !(videoPlaying && visible)) return { eligible: false, reason: '暂时没有活动' };
  return { eligible: true, reason: videoPlaying ? '正在累计 · 视频播放中' : '正在累计浏览时间' };
}

// All elapsed time is settled against the PREVIOUS observation, never the new tab.
export function advance(state, now, observation, thresholdMs) {
  const next = structuredClone(state);
  const elapsed = now - state.lastObservedAt;
  if (elapsed < 0 || elapsed > MAX_GAP_MS) {
    // Sleep / clock changes are not browsing. A long gap starts a fresh session.
    if (elapsed < 0 || elapsed >= BREAK_MS) {
      next.accumulatedMs = 0;
      next.nextReminderAtMs = thresholdMs;
      next.pending = null;
    }
  } else if (state.eligible) next.accumulatedMs += elapsed;

  if (!state.eligible && state.inactiveSince !== null && now - state.inactiveSince >= BREAK_MS) {
    next.accumulatedMs = 0;
    next.nextReminderAtMs = thresholdMs;
    next.pending = null;
  }
  next.lastObservedAt = now;
  next.eligible = observation.eligible;
  next.reason = observation.reason;
  next.inactiveSince = observation.eligible ? null :
    (state.eligible || state.inactiveSince === null ? now : state.inactiveSince);
  return next;
}

export function isDue(state) {
  return state.eligible && !state.pending && state.accumulatedMs >= state.nextReminderAtMs;
}

export function respond(state, id, action, now, thresholdMs) {
  if (!state.pending || state.pending.id !== id) return state;
  const next = structuredClone(state);
  next.pending = null;
  if (action === 'return') {
    next.accumulatedMs = 0;
    next.nextReminderAtMs = thresholdMs;
  } else next.nextReminderAtMs = next.accumulatedMs + (action === 'snooze' ? 5 * MINUTE : thresholdMs);
  next.lastObservedAt = now;
  return next;
}

export function formatDuration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
