export function fakeChrome() {
  const local = { settings: { goal: 'Finish the project', enabled: true, thresholdMinutes: 15 }, projects: [] };
  const session = {};
  function storage(data) {
    return {
      get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, data[key]]))),
      set: async values => Object.assign(data, structuredClone(values)),
      clear: async () => { for (const key of Object.keys(data)) delete data[key]; }
    };
  }
  const world = { now: 0, local, session, windows: [{ id: 1, focused: true, type: 'normal' }], tabs: [{ id: 10, windowId: 1, active: true, url: 'https://www.bilibili.com/' }], idle: 'active', visible: true, videoPlaying: false, delivery: true, sent: [], opened: [], badge: '' };
  const api = {
    storage: { local: storage(local), session: storage(session) },
    windows: { getAll: async () => structuredClone(world.windows) },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, updateContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => {} },
    tabs: {
      query: async query => structuredClone(world.tabs.filter(tab => tab.active && tab.windowId === query.windowId)),
      sendMessage: async (tabId, message) => {
        world.sent.push({ tabId, message: structuredClone(message) });
        if (!world.delivery) throw new Error('Receiving end does not exist');
        if (message.type === 'sample') return { focused: world.documentFocused, visible: world.visible, videoPlaying: world.videoPlaying };
        return { shown: true };
      },
      create: async options => world.opened.push(options)
    },
    idle: { queryState: async () => world.idle },
    action: { setBadgeText: async ({ text }) => { world.badge = text; }, setBadgeBackgroundColor: async () => {} },
    runtime: { getURL: path => `chrome-extension://test/${path}` }
  };
  return { api, world, sender: { url: 'chrome-extension://test/options.html' } };
}
