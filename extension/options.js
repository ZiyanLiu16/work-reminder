import { normalizeWebsites, websiteOrigins } from './websites.js';
import { $, node, request } from './ui.js';
import { formatDuration } from './core.js';
import { importProject } from './repository.js';
let projects = [];
let inspirations = [];
let settings;
let savedWebsites = [];
let draft;
let replaceId;
let abort;
let previewIndex = 0;
let previewHost;
function feedback(selector, text, error = false) {
  $(selector).textContent = text; $(selector).classList.toggle('error', error);
}
async function updateStatus() {
  const data = await request('status');
  settings = data.settings;
  $('#goal-progress').textContent = settings.goal ? '已保存 · 随时可以修改' : '用一句话写下你真正想实现的事';
  $('#elapsed').textContent = formatDuration(data.state.accumulatedMs);
  $('#timer-reason').textContent = data.state.reason;
  $('#next-reminder').textContent = data.state.pending ? '有一条提醒等待你查看' : `再浏览 ${formatDuration(data.state.nextReminderAtMs - data.state.accumulatedMs)} 后提醒`;
  $('#progress').style.width = `${Math.min(100, data.state.accumulatedMs / data.state.nextReminderAtMs * 100)}%`;
  $('#toggle').textContent = settings.enabled ? '暂停提醒' : '继续提醒';
  return data;
}
function renderProjects() {
  $('#project-progress').textContent = projects.length ? `已添加 ${projects.length} 个项目 · 可重新导入` : '选择本地文件夹，预览后保存片段';
  $('#projects').replaceChildren();
  for (const project of projects) {
    const item = node('div', undefined, 'project');
    item.append(node('strong', project.name), node('p', `${project.snippets.length} 个片段 · 快照 ${new Date(project.importedAt).toLocaleDateString()}`, 'hint'));
    const row = node('div', undefined, 'button-row');
    const refresh = node('button', '重新导入'); refresh.onclick = () => chooseProject(project.id);
    refresh.disabled = !!abort || !!draft;
    const remove = node('button', '移除'); remove.onclick = async () => {
      try { const updated = projects.filter(p => p.id !== project.id); await request('saveProjects', { projects: updated }); projects = updated; renderProjects(); }
      catch (error) { feedback('#project-status', error.message, true); }
    };
    remove.disabled = !!abort || !!draft;
    row.append(refresh, remove); item.append(row); $('#projects').append(item);
  }
  $('#choose-project').disabled = projects.length >= 2 || !!abort || !!draft;
}
function chooseProject(id) {
  replaceId = id;
  $('#project-files').value = '';
  $('#project-files').click();
}
function renderInspirations() {
  $('#inspiration-progress').textContent = inspirations.length ? `已收藏 ${inspirations.length} 条鼓励 · 可继续添加` : '粘贴链接，可附上一句喜欢的话';
  $('#inspirations').replaceChildren();
  inspirations.forEach((entry, index) => {
    const item = node('div', undefined, 'project');
    item.append(node('p', entry.text || '仅保存链接，尚未填写摘录'));
    const link = node('a', entry.author || '查看收藏的原帖');
    link.href = entry.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const remove = node('button', '移除');
    remove.onclick = async () => {
      try {
        const saved = await request('saveInspirations', { inspirations: inspirations.filter((_, i) => i !== index) });
        inspirations = saved.inspirations; renderInspirations();
        feedback('#inspiration-status', inspirations.length ? '已移除。' : '已移除，暂时使用内置原创鼓励。');
      } catch (error) { feedback('#inspiration-status', error.message, true); }
    };
    const row = node('div', undefined, 'button-row'); row.append(link, remove); item.append(row); $('#inspirations').append(item);
  });
  $('#inspiration-form button[type=submit]').disabled = inspirations.length >= 20;
}
$('#inspiration-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#inspiration-form button[type=submit]'); button.disabled = true;
  try {
    const saved = await request('saveInspirations', { inspirations: [...inspirations, {
      sourceUrl: $('#inspiration-url').value.trim(), text: $('#inspiration-text').value, author: $('#inspiration-author').value
    }] });
    inspirations = saved.inspirations; $('#inspiration-form').reset(); renderInspirations();
    feedback('#inspiration-status', `已保存第 ${inspirations.length} 条。可以继续添加，提醒时会逐条轮换。`);
  } catch (error) { feedback('#inspiration-status', error.message, true); }
  finally { button.disabled = inspirations.length >= 20; }
};
function updateSnippetSelection() {
  const boxes = [...$('#candidate-list').querySelectorAll('input[type=checkbox]')];
  const selected = boxes.filter(box => box.checked).length;
  $('#select-all-snippets').checked = boxes.length > 0 && selected === boxes.length;
  $('#select-all-snippets').indeterminate = selected > 0 && selected < boxes.length;
  $('#select-all-snippets').disabled = boxes.length === 0;
  $('#snippet-selection-count').textContent = `已选 ${selected} / ${boxes.length} 个片段`;
}
$('#select-all-snippets').onchange = () => {
  for (const box of $('#candidate-list').querySelectorAll('input[type=checkbox]'))
    box.checked = $('#select-all-snippets').checked;
  updateSnippetSelection();
};
$('#candidate-list').addEventListener('change', updateSnippetSelection);
function discard() {
  draft = null; $('#import-preview').hidden = true; $('#candidate-list').replaceChildren(); updateSnippetSelection(); renderProjects();
}
$('#choose-project').onclick = () => chooseProject(undefined);
$('#project-files').onchange = async event => {
  if (!event.target.files.length) return;
  discard(); abort = new AbortController(); renderProjects();
  $('#import-progress').hidden = false; $('#import-message').textContent = '正在筛选文本文件…';
  feedback('#project-status', '');
  try {
    draft = await importProject(event.target.files, { signal: abort.signal, onProgress: (done, total) => $('#import-message').textContent = `正在读取候选文件 ${done} / ${total}` });
    if (!draft.snippets.length) { draft = null; feedback('#project-status', '没有找到合适的文本片段。目标提醒仍可正常使用。'); return; }
    for (const [index, snippet] of draft.snippets.entries()) {
      const box = node('div', undefined, 'snippet-preview');
      const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.checked = true; check.dataset.index = index;
      label.append(check, node('span', `${snippet.path}:${snippet.line}`)); box.append(label, node('pre', snippet.text)); $('#candidate-list').append(box);
    }
    updateSnippetSelection();
    $('#import-preview').hidden = false;
  } catch (error) { draft = null; feedback('#project-status', error.name === 'AbortError' ? '已取消导入，没有保存新片段。' : error.message, error.name !== 'AbortError'); }
  finally { abort = null; $('#import-progress').hidden = true; event.target.value = ''; renderProjects(); }
};
$('#cancel-import').onclick = () => abort?.abort();
$('#discard-project').onclick = discard;
$('#save-project').onclick = async () => {
  const snippets = [...$('#candidate-list').querySelectorAll('input:checked')].map(input => draft.snippets[Number(input.dataset.index)]);
  if (!snippets.length) { feedback('#project-status', '请至少选择一个片段，或取消导入。', true); return; }
  const saved = { ...draft, snippets };
  const updated = replaceId ? projects.map(p => p.id === replaceId ? saved : p) : [...projects, saved];
  try { await request('saveProjects', { projects: updated }); projects = updated; discard(); feedback('#project-status', '项目片段已保存在本机。'); }
  catch (error) { feedback('#project-status', error.message, true); }
};
function showSavedWebsites(websites) {
  savedWebsites = [...websites];
  $('#websites-list').replaceChildren(...savedWebsites.map(host => node('li', host)));
  $('#websites-summary').textContent = savedWebsites.length ? `已保存 · ${savedWebsites.length} 个网站` : '已保存 · 当前不监控任何网站';
  $('#websites').value = savedWebsites.join('\n');
  $('#websites-form').hidden = true;
  $('#websites-saved').hidden = false;
  $('#edit-websites').disabled = false;
}
$('#edit-websites').onclick = () => {
  $('#websites').value = savedWebsites.join('\n');
  $('#websites-saved').hidden = true;
  $('#websites-form').hidden = false;
  feedback('#websites-status', '正在编辑，修改尚未保存。');
  $('#websites').focus();
};
$('#cancel-websites').onclick = () => {
  showSavedWebsites(savedWebsites);
  feedback('#websites-status', '已取消，保留原来的网站列表。');
  $('#edit-websites').focus();
};
$('#websites-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#websites-form button');
  try {
    const websites = normalizeWebsites($('#websites').value);
    button.disabled = true; $('#cancel-websites').disabled = true;
    // Must request directly from the user's click, before any other async work.
    if (websites.length && !await chrome.permissions.request({ origins: websiteOrigins(websites) }))
      throw new Error('未获得网站权限，列表尚未更改。请再次保存并允许访问。');
    const data = await request('saveWebsites', { websites });
    showSavedWebsites(data.settings.websites);
    $('#edit-websites').focus();
    feedback('#websites-status', websites.length ? `已保存 ${websites.length} 个网站，包含子域名。下一轮从零开始累计。` : '已保存，目前不监控任何网站。');
    await updateStatus();
  } catch (error) { feedback('#websites-status', error.message, true); }
  finally { button.disabled = false; $('#cancel-websites').disabled = false; }
};
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  try { await request('saveSettings', { settings: { goal: $('#goal').value, thresholdMinutes: Number($('#threshold').value), enabled: settings.enabled } });
    feedback('#save-status', Number($('#threshold').value) < 1 ? '已保存。当前为短间隔体验，结束后记得改回 15 分钟。' : '已保存。下一轮从零开始累计。'); await updateStatus(); }
  catch (error) { feedback('#save-status', error.message, true); }
};
$('#toggle').onclick = async () => { try { await request('toggle'); await updateStatus(); } catch (error) { feedback('#save-status', error.message, true); } };
$('#preview').onclick = async () => {
  try { const card = await request('preview', { index: previewIndex++ }); previewHost?.remove(); previewHost = WorkReminderCard.create(card, { preview: true }); document.body.append(previewHost); }
  catch (error) { feedback('#save-status', error.message, true); }
};
$('#diagnose').onclick = async () => {
  try {
    const [data, alarm, granted, errors] = await Promise.all([updateStatus(), chrome.alarms.get('work-reminder'), chrome.permissions.getAll(), chrome.storage.session.get('lastError')]);
    $('#diagnostics').textContent = [
      `扩展版本：${chrome.runtime.getManifest().version}`,
      `后台连接：正常`, `定时检查：${alarm ? '已启用（约 30 秒）' : '缺失，请重新加载扩展'}`,
      `目标配置：${data.settings.goal ? '已填写' : '尚未填写'}`, `网站权限：${granted.origins?.join('、')}`,
      `计时状态：${data.state.reason}`, `本轮：${formatDuration(data.state.accumulatedMs)}`,
      `项目快照：${data.projects.length}`, `上次观察：${new Date(data.state.lastObservedAt).toLocaleTimeString()}`,
      `后台错误：${errors.lastError || '无'}`
    ].join('\n');
  } catch (error) { $('#diagnostics').textContent = error.message; }
};
$('#clear-data').onclick = async () => {
  if (!confirm('清除目标、所有项目片段、鼓励链接与计时记录？此操作无法撤销。')) return;
  try { await request('clear'); location.reload(); } catch (error) { $('#diagnostics').textContent = error.message; }
};
try {
  const data = await updateStatus(); projects = data.projects; inspirations = data.inspirations;
  showSavedWebsites(settings.websites);
  $('#goal').value = settings.goal; $('#threshold').value = settings.thresholdMinutes; renderProjects(); renderInspirations();
  if (location.hash === '#focus') {
    $('#focus').hidden = false; $('#focus-goal').textContent = settings.goal;
    const project = projects.find(p => p.snippets.length);
    if (project) $('#focus-snippet').append(node('small', `${project.name} / ${project.snippets[0].path}:${project.snippets[0].line}`), node('pre', project.snippets[0].text));
    $('#focus').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
} catch (error) { feedback('#save-status', error.message, true); }
setInterval(() => { if (document.visibilityState === 'visible') updateStatus().catch(error => feedback('#save-status', error.message, true)); }, 1000);
