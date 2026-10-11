/* In-app reminders for timed tasks (run while the app is open). */
import { S, persist } from '../core/store.js';
import { today, nowHM, hmToMin } from '../core/dates.js';
import { notify } from '../services/notify.js';

const WINDOW_MIN = 30; // fire if we are at most this late

export function checkReminders() {
  const d = today();
  const now = hmToMin(nowHM());
  let changed = false;
  const late = (hm) => hmToMin(hm) <= now && now - hmToMin(hm) < WINDOW_MIN;

  S.tasks.forEach((t) => {
    if (t.reminder && !t.done && !t.notified && t.date === d && t.time && late(t.time)) { t.notified = true; changed = true; notify(`یادآوری: ${t.title}`); }
  });
  if (changed) persist();
}
