import { S, commit } from '../core/store.js';
import { toast } from './toast.js';

export function applyTheme() {
  document.documentElement.classList.toggle('dark', !!S.dark);
  const btn = document.querySelector('[data-act="theme"] .material-symbols-outlined');
  if (btn) btn.textContent = S.dark ? 'light_mode' : 'dark_mode';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', S.dark ? '#1b1b19' : '#ece8e1');
}

export function toggleDark() {
  S.dark = !S.dark;
  commit();
  applyTheme();
  toast(S.dark ? 'حالت تاریک فعال شد' : 'حالت روشن فعال شد');
}
