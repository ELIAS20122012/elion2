/* In-app reminders for tasks, planner blocks and due payments (run while the app is open). */
import { S, persist } from '../core/store.js';
import { today, nowHM, hmToMin } from '../core/dates.js';
import { fa } from '../core/format.js';
import { notify } from '../services/notify.js';
import { dueItems } from '../domain/finance.js';

const WINDOW_MIN = 30; // fire if we are at most this late

function dueReminder() {
  if (S.wallet.lastDueNotice === today()) return;
  const items = dueItems(1).filter((d) => d.ref.remind !== false);
  if (!items.length) return;
  const over = items.filter((d) => d.due < today()).length;
  S.wallet.lastDueNotice = today();
  persist();
  const soon = items.length - over;
  const msg = over
    ? `${fa(over)} پرداخت معوق دارید${soon ? ` و ${fa(soon)} سررسید امروز/فردا` : ''}`
    : `${fa(items.length)} سررسید قسط/قبض برای امروز یا فردا`;
  setTimeout(() => notify(msg), 1200);
}

export function checkReminders() {
  try { dueReminder(); } catch (e) { console.error(e); }
  const d = today();
  const now = hmToMin(nowHM());
  let changed = false;
  const late = (hm) => hmToMin(hm) <= now && now - hmToMin(hm) < WINDOW_MIN;

  S.tasks.forEach((t) => {
    if (t.reminder && !t.done && !t.notified && t.date === d && t.time && late(t.time)) { t.notified = true; changed = true; notify(`یادآوری: ${t.title}`); }
  });
  S.blocks.forEach((b) => {
    if (b.notify && !b.done && !b.notified && b.date === d && late(b.start)) { b.notified = true; changed = true; notify(`شروع بلوک: ${b.title} (${b.start})`); }
  });
  if (changed) persist();
}
