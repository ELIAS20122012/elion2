import { toast } from '../ui/toast.js';

export function notifAllowed() {
  try { return !!window.Notification && Notification.permission === 'granted'; } catch { return false; }
}

const FALLBACK = 'مرورگر اجازه اعلان نداد؛ یادآورها داخل برنامه نمایش داده می‌شوند';

export function askNotif() {
  try {
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission().then((p) => toast(p === 'granted' ? 'اعلان‌ها فعال شد' : FALLBACK));
    } else if (!notifAllowed()) toast(FALLBACK);
  } catch { /* unsupported */ }
}

/** In-app toast, plus a system notification when permitted. */
export function notify(msg) {
  toast(`⏰ ${msg}`);
  try { if (notifAllowed()) new Notification('Daily Order', { body: msg }); } catch { /* ignore */ }
}
