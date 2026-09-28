(() => {
  const styles = `
    :host{all:initial!important;position:fixed!important;right:var(--reminder-right,28px)!important;bottom:var(--reminder-bottom,28px)!important;z-index:2147483647!important;display:block!important;width:min(410px,calc(100vw - 32px))!important;color-scheme:light!important}
    *{box-sizing:border-box} .card{font:15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#253b33;background:#fbfcf7;border:1px solid #d9e4d9;border-radius:22px;box-shadow:0 18px 65px #15332933;padding:27px;max-height:var(--reminder-max-height,80vh);overflow:auto;text-align:left}
    .eyebrow{font-size:11px;letter-spacing:2px;color:#587669;font-weight:650}h2{font-size:23px;line-height:1.4;letter-spacing:-.5px;margin:15px 0 12px;font-weight:650}p{margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace;background:#edf1e9;padding:13px;border-radius:10px;max-height:200px;overflow:auto}small{display:block;color:#65786c;font-size:11px;overflow-wrap:anywhere}button,a{font:inherit}button{cursor:pointer;border:1px solid #cddacc;padding:10px 14px;border-radius:10px;background:transparent;color:#355b4c}button:hover{background:#e6eee4}button:focus-visible,a:focus-visible{outline:3px solid #a7c2a7;outline-offset:3px}.primary{background:#347663;color:white;border-color:#347663}.primary:hover{background:#285e4e}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.close{float:right;padding:0 6px;border:0;font-size:22px;line-height:1}a{color:#347663;font-size:12px}.error{color:#a63c2b;font-size:12px}.copy{padding:4px 8px;font-size:11px;margin-top:5px}
  `;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function create(card, { preview = false, onAction = () => {} } = {}) {
    const host = document.createElement('work-reminder-card');
    const root = host.attachShadow({ mode: 'open' });
    const style = element('style', styles);
    const box = element('section', undefined, 'card');
    box.setAttribute('role', 'region'); box.setAttribute('aria-label', preview ? '提醒预览' : '回到目标提醒');
    box.setAttribute('aria-live', 'polite');
    const close = element('button', '×', 'close'); close.setAttribute('aria-label', '关闭提醒');
    const error = element('p', '', 'error');
    const buttons = [];
    async function act(action) {
      buttons.forEach(button => button.disabled = true);
      try { await onAction(action); host.remove(); }
      catch { error.textContent = '暂时无法连接扩展，请刷新页面后重试。'; buttons.forEach(button => button.disabled = false); }
    }
    close.onclick = () => act('close'); buttons.push(close);
    box.append(close, element('div', preview ? 'WORK REMINDER / 预览' : 'WORK REMINDER / 停一下', 'eyebrow'), element('h2', card.title), element('p', card.text));
    if (card.snippet) {
      box.append(element('small', `${card.path}:${card.line} · 项目快照 ${new Date(card.importedAt).toLocaleDateString()}`), element('pre', card.snippet));
      const copy = element('button', '复制文件位置', 'copy');
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(`${card.path}:${card.line}`); copy.textContent = '已复制'; }
        catch { copy.textContent = '请手动复制上方文件位置'; }
      };
      box.append(copy);
    }
    if (card.author) box.append(element('small', card.author));
    if (/^https?:\/\//i.test(card.sourceUrl || '')) {
      const link = element('a', '查看来源'); link.href = card.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
    }
    const actions = element('div', undefined, 'actions');
    for (const [action, label, className] of [['return', preview ? '结束预览' : '回到目标', 'primary'], ['snooze', '再看 5 分钟', '']]) {
      const button = element('button', label, className); button.onclick = () => act(action); buttons.push(button); actions.append(button);
    }
    box.append(actions, error); root.append(style, box);
    return host;
  }
  globalThis.WorkReminderCard = { create };
})();
