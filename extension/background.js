import { createController } from './controller.js';

// Register listeners synchronously: a waking worker must not miss the event that woke it.
const ready = fetch(chrome.runtime.getURL('encouragements.json'))
  .then(response => response.json()).then(encouragements => createController(chrome, { encouragements }));
async function reportError(error) {
  console.error('[Work Reminder]', error);
  await chrome.storage.session.set({ lastError: String(error.message || error) });
}
const tick = () => ready.then(controller => controller.tick()).catch(reportError);
chrome.tabs.onActivated.addListener(tick);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.status === 'complete') tick(); });
chrome.tabs.onRemoved.addListener(id => ready.then(controller => controller.removeTab(id)).catch(reportError));
chrome.windows.onFocusChanged.addListener(tick);
chrome.idle.setDetectionInterval(120);
chrome.idle.onStateChanged.addListener(tick);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'work-reminder') tick(); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ready.then(controller => controller.handle(message, sender)).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
  tick();
});
chrome.runtime.onStartup.addListener(tick);
// Chrome extension service-worker modules do not permit top-level await.
async function start() {
  if (!await chrome.alarms.get('work-reminder')) await chrome.alarms.create('work-reminder', { periodInMinutes: 0.5 });
  await (await ready).syncWebsites();
  await tick();
}
start().catch(reportError);
