export const DEFAULT_WEBSITES = ['youtube.com', 'bilibili.com', 'xiaohongshu.com'];

export function normalizeWebsites(input) {
  const entries = Array.isArray(input) ? input : String(input).split(/\n/);
  const hosts = entries.map(entry => {
    const value = String(entry).trim();
    if (!value) return null;
    try {
      if (/[\s*]/.test(value)) throw new Error();
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
      if (!host || !/^[a-z0-9.-]+$/.test(host) || host.split('.').some(part => !part || part.startsWith('-') || part.endsWith('-'))) throw new Error();
      return host;
    } catch { throw new Error(`网站格式不正确：${value}。请填写域名或 HTTP / HTTPS 网址。`); }
  }).filter(Boolean);
  const unique = [...new Set(hosts)];
  if (unique.length > 50) throw new Error('最多添加 50 个网站。');
  return unique;
}
export function websiteOrigins(hosts) {
  return hosts.flatMap(host => ['http', 'https'].map(protocol => `${protocol}://*.${host}/*`));
}

// Persist registrations so newly opened pages work after Chrome restarts.
export async function syncWebsiteScripts(api, hosts) {
  const matches = [];
  for (const origin of websiteOrigins(hosts)) {
    if (await api.permissions.contains({ origins: [origin] })) matches.push(origin);
  }
  const id = 'configured-websites';
  const existing = await api.scripting.getRegisteredContentScripts({ ids: [id] });
  if (matches.length) {
    const script = { id, matches, js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true };
    if (existing.length) await api.scripting.updateContentScripts([script]);
    else await api.scripting.registerContentScripts([script]);
    // Also enable already-open tabs without making users refresh them.
    const tabs = await api.tabs.query({ url: matches });
    await Promise.all(tabs.map(tab => api.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {})));
  } else if (existing.length) await api.scripting.unregisterContentScripts({ ids: [id] });
}
