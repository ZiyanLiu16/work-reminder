import { request } from './ui.js';
const id = new URLSearchParams(location.search).get('id');
try {
  const card = await request('getReminder', { id });
  const host = WorkReminderCard.create(card, { onAction: async action => {
    await request('respond', { id, action });
  } });
  document.body.append(host);
  await request('reminderShown', { id });
} catch {
  // A stale iframe may finish loading after its reminder has been dismissed.
  document.body.textContent = '';
}
