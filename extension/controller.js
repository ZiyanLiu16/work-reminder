import { DEFAULT_WEBSITES, normalizeWebsites, websiteOrigins, syncWebsiteScripts } from './websites.js';
import { DEFAULT_SETTINGS, MINUTE, freshState, eligibility, advance, isDue, respond, validateSettings, targetHost } from './core.js';
import { chooseReminder, validateInspirations } from './reminders.js';

export function createController(api, { clock = Date.now, encouragements = [], id = () => crypto.randomUUID() } = {}) {
  let queue = Promise.resolve();
  const serialize = work => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };

  async function read() {
    const [local, session] = await Promise.all([api.storage.local.get(['settings', 'projects', 'inspirations', 'websites']), api.storage.session.get('timer')]);
    const settings = { ...DEFAULT_SETTINGS, ...local.settings, websites: local.websites ?? DEFAULT_WEBSITES };
    return { settings, projects: local.projects || [], inspirations: local.inspirations || [], state: session.timer || freshState(clock(), settings.thresholdMinutes * MINUTE) };
  }

  const reminderContent = data => ({ goal: data.settings.goal || '完成一件真正想做的事', projects: data.projects,
    encouragements: data.inspirations.length ? data.inspirations : encouragements });

  async function send(tabId, message) {
    if (tabId === undefined) return null;
    try { return await api.tabs.sendMessage(tabId, message, { frameId: 0 }); }
    catch { return null; } // Expected while navigating, reloading or before content-script injection.
  }

  async function refresh({ suppressReminder = false } = {}) {
    const data = await read();
    const { settings, projects, inspirations, state } = data;
    const now = clock();
    const windows = await api.windows.getAll();
    let focusedWindow = windows.find(window => window.focused && ['normal', 'popup'].includes(window.type));
    let [tab] = focusedWindow ? await api.tabs.query({ active: true, windowId: focusedWindow.id }) : [];
    let sample = targetHost(tab?.url, settings.websites) ? await send(tab.id, { type: 'sample' }) : null;
    if (sample?.focused === false || sample?.visible === false) focusedWindow = undefined;
    if (!focusedWindow) {
      // On macOS the action popup can own focus while its browser window reports false.
      // Ask the live popup; never infer foreground from the last-used window alone.
      try {
        const popup = await api.runtime.sendMessage({ type: 'popupFocus' });
        if (popup?.focused === true) focusedWindow = windows.find(window =>
          window.id === popup.windowId && ['normal', 'popup'].includes(window.type) && window.state !== 'minimized');
      } catch { /* No action popup is open. */ }
      if (focusedWindow) {
        [tab] = await api.tabs.query({ active: true, windowId: focusedWindow.id });
        sample = targetHost(tab?.url, settings.websites) ? await send(tab.id, { type: 'sample' }) : null;
      } else {
        // A visible background tab is not proof of foreground. A live focused
        // document can recover from a stale windows API focus snapshot, however.
        tab = undefined;
        sample = null;
        for (const window of windows.filter(window => ['normal', 'popup'].includes(window.type) && window.state !== 'minimized')) {
          const [candidate] = await api.tabs.query({ active: true, windowId: window.id });
          const reading = targetHost(candidate?.url, settings.websites) ? await send(candidate.id, { type: 'sample' }) : null;
          if (reading?.focused === true && reading.visible === true) {
            focusedWindow = window; tab = candidate; sample = reading; break;
          }
        }
      }
    }
    const idle = await api.idle.queryState(120);
    const observation = eligibility({ settings, focused: !!focusedWindow, url: tab?.url,
      idle, visible: sample?.visible === true, videoPlaying: sample?.videoPlaying === true,
      learningUntil: state.learning[tab?.id], now });
    let next = advance(state, now, observation, settings.thresholdMinutes * MINUTE);
    next.learning = Object.fromEntries(Object.entries(next.learning).filter(([, until]) => until > now));
    if (!suppressReminder && isDue(next)) {
      next.pending = { id: id(), card: chooseReminder(reminderContent(data), next.reminderIndex), shown: false };
      next.reminderIndex++;
      next.sequence++;
    }
    if (state.displayedTabId !== undefined && (!next.eligible || state.displayedTabId !== tab?.id || !next.pending)) {
      await send(state.displayedTabId, { type: 'hide' });
      delete next.displayedTabId;
    }
    // Persist the ID before delivery so a worker restart cannot create another reminder.
    await api.storage.session.set({ timer: next });
    if (next.pending && next.eligible && !suppressReminder) {
      next.displayedTabId = tab.id;
      await api.storage.session.set({ timer: next });
      // Only the extension-origin iframe receives private content, not the host page DOM.
      await send(tab.id, { type: 'reminder', id: next.pending.id, kind: next.pending.card.kind });
      await api.storage.session.set({ timer: next });
    }
    await api.action.setBadgeBackgroundColor({ color: '#347663' });
    await api.action.setBadgeText({ text: next.pending ? '•' : settings.enabled && settings.goal ? String(Math.floor(next.accumulatedMs / MINUTE)) : '' });
    return { settings, projects, inspirations, state: next, tabId: tab?.id, isTarget: !!targetHost(tab?.url, settings.websites) };
  }

  async function resetSession(settings, state) {
    await send(state.displayedTabId, { type: 'hide' });
    await api.storage.session.set({ timer: { ...freshState(clock(), settings.thresholdMinutes * MINUTE, state.reminderIndex), learning: state.learning } });
  }

  return {
    syncWebsites: () => serialize(async () => syncWebsiteScripts(api, (await read()).settings.websites)),
    tick: () => serialize(() => refresh()),
    handle: (message, sender = {}) => serialize(async () => {
      const senderUrl = sender.url?.split(/[?#]/)[0];
      const fromPage = ['options.html', 'popup.html'].some(path => senderUrl === api.runtime.getURL(path));
      const fromCard = senderUrl === api.runtime.getURL('reminder.html');
      const fromTarget = sender.frameId === 0 && !!targetHost(sender.tab?.url, (await read()).settings.websites);
      if (!fromPage && !fromTarget && !fromCard) throw new Error('不支持的消息来源。');
      if (['getReminder', 'reminderShown'].includes(message.type) && fromCard) {
        const data = await read();
        if (data.state.pending?.id !== message.id || (sender.tab && data.state.displayedTabId !== sender.tab.id) || !data.state.eligible)
          throw new Error('这条提醒已经结束。');
        if (message.type === 'reminderShown') {
          data.state.pending.shown = true;
          await api.storage.session.set({ timer: data.state });
          return { ok: true };
        }
        return data.state.pending.card;
      }
      if (message.type === 'pulse' && fromTarget) { await refresh(); return { ok: true }; }
      if (message.type === 'respond' && (fromPage || fromCard) && ['close', 'snooze', 'return'].includes(message.action)) {
        const data = await refresh({ suppressReminder: true });
        if (data.state.pending?.id !== message.id) return { ok: false };
        if (fromCard && sender.tab && data.state.displayedTabId !== sender.tab.id) return { ok: false };
        const next = respond(data.state, message.id, message.action, clock(), data.settings.thresholdMinutes * MINUTE);
        await send(data.state.displayedTabId, { type: 'hide' });
        delete next.displayedTabId;
        await api.storage.session.set({ timer: next });
        if (message.action === 'return') await api.tabs.create({ url: api.runtime.getURL('options.html#focus') });
        await refresh();
        return { ok: true };
      }
      if (!fromPage) throw new Error('这个操作只能在扩展设置中进行。');
      if (message.type === 'status') return refresh();
      if (message.type === 'saveWebsites') {
        const websites = normalizeWebsites(message.websites);
        if (websites.length && !await api.permissions.contains({ origins: websiteOrigins(websites) }))
          throw new Error('尚未获得网站权限，请点击保存并允许 Chrome 的网站访问请求。');
        const data = await read();
        await syncWebsiteScripts(api, websites);
        await api.storage.local.set({ websites });
        await resetSession(data.settings, data.state);
        return refresh();
      }
      if (message.type === 'preview') {
        const data = await read();
        return chooseReminder(reminderContent(data), Math.max(0, Math.floor(Number(message.index) || 0)));
      }
      if (message.type === 'saveInspirations') {
        const inspirations = validateInspirations(message.inspirations);
        const data = await read();
        await api.storage.local.set({ inspirations });
        await resetSession(data.settings, data.state);
        return { inspirations };
      }
      if (message.type === 'saveSettings') {
        const settings = validateSettings(message.settings);
        const data = await refresh({ suppressReminder: true });
        await api.storage.local.set({ settings });
        await resetSession(settings, data.state);
        return refresh();
      }
      if (message.type === 'toggle') {
        const data = await refresh({ suppressReminder: true });
        const settings = { ...data.settings, enabled: !data.settings.enabled };
        await api.storage.local.set({ settings });
        await resetSession(settings, data.state);
        return refresh();
      }
      if (message.type === 'learning') {
        const data = await refresh({ suppressReminder: true });
        if (!data.isTarget) throw new Error('请先打开你的网站列表中的一个标签页。');
        if (data.state.learning[data.tabId]) delete data.state.learning[data.tabId];
        else data.state.learning[data.tabId] = clock() + 60 * MINUTE;
        await api.storage.session.set({ timer: data.state });
        return refresh();
      }
      if (message.type === 'saveProjects') {
        const projects = message.projects;
        if (!Array.isArray(projects) || projects.length > 2 || JSON.stringify(projects).length > 100_000 ||
          projects.some(p => typeof p.name !== 'string' || !Array.isArray(p.snippets) || p.snippets.length > 30 ||
            p.snippets.some(s => typeof s.text !== 'string' || s.text.length > 501 || typeof s.path !== 'string')))
          throw new Error('项目片段格式或大小不符合限制。');
        const data = await read();
        await api.storage.local.set({ projects });
        // A deleted snapshot must not remain in a pending card.
        await resetSession(data.settings, data.state);
        return { ok: true };
      }
      if (message.type === 'clear') {
        const data = await read();
        await send(data.state.displayedTabId, { type: 'hide' });
        await api.storage.local.clear();
        await syncWebsiteScripts(api, DEFAULT_WEBSITES);
        await api.storage.session.clear();
        return refresh();
      }
      throw new Error('未知操作。');
    }),
    removeTab: tabId => serialize(async () => {
      const data = await read();
      delete data.state.learning[tabId];
      await api.storage.session.set({ timer: data.state });
      return refresh();
    })
  };
}
