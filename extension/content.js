(() => {
  if (globalThis.workReminderContentLoaded) return;
  globalThis.workReminderContentLoaded = true;
  let host = null;
  let currentId = null;
  let alive = true;
  let lastPulseAt = 0;
  function sample() {
    return { focused: document.hasFocus(), visible: document.visibilityState === 'visible', videoPlaying: [...document.querySelectorAll('video')].some(video =>
      !video.paused && !video.ended && video.readyState >= 3 && video !== document.pictureInPictureElement) };
  }
  function hide() { host?.remove(); host = null; currentId = null; }
  async function pulse(force = false) {
    if (!alive || (force !== true && Date.now() - lastPulseAt < 500)) return;
    lastPulseAt = Date.now();
    try { await chrome.runtime.sendMessage({ type: 'pulse' }); }
    catch { alive = false; clearInterval(interval); hide(); }
  }
  function mount() {
    if (!host) return false;
    const full = document.fullscreenElement;
    if (document.visibilityState !== 'visible' || full?.tagName === 'VIDEO') { host.remove(); return false; }
    const parent = full || document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    return true;
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === 'sample') { reply(sample()); return; }
    if (message.type === 'hide') { hide(); reply({ ok: true }); return; }
    if (message.type !== 'reminder') return;
    if (currentId !== message.id || !host) {
      hide(); currentId = message.id;
      host = document.createElement('iframe');
      host.dataset.workReminder = '';
      host.title = '回到目标提醒';
      host.src = chrome.runtime.getURL(`reminder.html?id=${encodeURIComponent(message.id)}`);
      host.allow = 'clipboard-write';
      const height = message.kind === 'project' ? '570px' : '360px';
      host.style.cssText = `color-scheme:light!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;border:0!important;background:transparent!important;width:min(450px,calc(100vw - 16px))!important;height:min(${height},90vh)!important;display:block!important;`;
    }
    reply({ shown: mount() });
  });
  document.addEventListener('visibilitychange', () => { mount(); pulse(); });
  document.addEventListener('fullscreenchange', () => { mount(); pulse(); });
  for (const event of ['play', 'pause', 'ended', 'waiting', 'playing', 'enterpictureinpicture', 'leavepictureinpicture'])
    document.addEventListener(event, pulse, true);
  window.addEventListener('pageshow', pulse);
  // App switches may leave visibilityState unchanged. Do not throttle these
  // transitions: a quick switch away and back must settle both timing boundaries.
  window.addEventListener('focus', () => pulse(true));
  window.addEventListener('blur', () => pulse(true));
  const interval = setInterval(() => { if (document.visibilityState === 'visible') pulse(); }, 15_000);
  pulse();
})();
