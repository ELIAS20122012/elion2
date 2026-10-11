/* One-time upgrade helpers for documents saved by older versions. Pure — no store access. */
import { uid } from './util.js';

/** Old documents had loans and bills; fold the live ones into plain monthly payments (once). */
export function fromLegacy(state) {
  const out = [];
  (state.loans || []).forEach((l) => {
    if (l.count && Object.keys(l.paid || {}).length >= l.count) return; // fully paid off
    out.push({ id: uid(), title: l.title, amount: l.amount, paid: {} });
  });
  (state.bills || []).forEach((b) => {
    if (b.paused) return;
    const paid = Object.values(b.paid || {}).map((p) => p.amount).filter((x) => x > 0);
    const avg = paid.length ? paid.reduce((s, x) => s + x, 0) / paid.length : b.amount;
    out.push({ id: uid(), title: b.title, amount: Math.round((avg / (b.every || 1)) * 100) / 100, paid: {} });
  });
  return out;
}
