import { config } from './config.js';

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

/** Latin digits → Persian digits. */
export const fa = (x) => String(x).replace(/\d/g, (d) => FA[d]);

/** Persian / Arabic digits → Latin digits. */
export const en = (x) => String(x)
  .replace(/[۰-۹]/g, (d) => FA.indexOf(d))
  .replace(/[٠-٩]/g, (d) => AR.indexOf(d));

/** Lenient number parser for form input (accepts Persian digits and thousands separators). */
export function num(x) {
  const n = parseFloat(en(String(x == null ? '' : x)).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export const faInt = (n) => fa(Math.round(n).toLocaleString('en-US'));

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Format an amount in the configured currency. Pass `hide` (or enable privacy mode) to mask it. */
export function money(v, hide = config.privacy) {
  if (hide) return '••••';
  const c = config.currency || '€';
  const neg = v < 0;
  const a = Math.abs(v);
  const n = a >= 1000 || Math.round(a) === a
    ? Math.round(a).toLocaleString('en-US')
    : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return c === 'تومان'
    ? `⁧${neg ? '-' : ''}${n} تومان⁩`
    : `⁦${neg ? '-' : ''}${c} ${n}⁩`;
}
