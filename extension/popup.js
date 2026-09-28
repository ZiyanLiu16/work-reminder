import { $, request } from './ui.js';
import { formatDuration } from './core.js';
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'popupFocus' || sender.id !== chrome.runtime.id) return;
  chrome.windows.getCurrent().then(window => respond({
    windowId: window.id,
    focused: document.hasFocus() && document.visibilityState === 'visible'
  })).catch(() => respond({ focused: false }));
  return true;
});
async function render() {
  const data = await request('status');
  $('#elapsed').textContent = formatDuration(data.state.accumulatedMs);
  $('#reason').textContent = data.state.reason;
  $('#goal').textContent = data.settings.goal || '先填写一个真正想实现的目标。';
  $('#settings').textContent = data.settings.goal ? '目标与设置' : '开始设置';
  if (!data.settings.goal) $('#hint').textContent = '首次使用：填写目标、选择项目、收藏鼓励链接。';
  $('#toggle').textContent = data.settings.enabled ? '暂停提醒' : '继续提醒';
  $('#learning').disabled = !data.isTarget;
  $('#learning').textContent = data.state.learning[data.tabId] ? '结束本标签页学习模式' : '本标签页学习 60 分钟';
}
function failure(error) { $('#hint').textContent = error.message; $('#hint').classList.add('error'); }
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#toggle').onclick = async () => { try { await request('toggle'); await render(); } catch (error) { failure(error); } };
$('#learning').onclick = async () => { try { await request('learning'); await render(); } catch (error) { failure(error); } };
render().catch(failure);
setInterval(() => render().catch(failure), 1000);
