import { S } from '../core/store.js';

export function applyTheme() {
  document.documentElement.classList.toggle('dark', !!S.dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', S.dark ? '#1b1b19' : '#ece8e1');
}
