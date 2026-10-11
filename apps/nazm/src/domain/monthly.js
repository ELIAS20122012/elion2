/* Fixed monthly payments (electricity, internet, car installment…): a name and a monthly amount.
   They are not ticked off — their total is simply taken out of the monthly budget every month.
   Remove one when it is finished. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid } from '../core/util.js';

export const list = () => S.monthly;
export const findMonthly = (id) => S.monthly.find((m) => m.id === id);
export const total = () => S.monthly.reduce((s, m) => s + m.amount, 0);

export function saveMonthly(existing, { title, amount }) {
  const m = existing || { id: uid() };
  Object.assign(m, { title, amount });
  if (!existing) S.monthly.push(m);
  return m;
}

/** Remove one; returns what is needed to put it back. */
export function removeMonthly(id) {
  const i = S.monthly.findIndex((m) => m.id === id);
  return i < 0 ? null : { item: S.monthly.splice(i, 1)[0], index: i };
}
