/* Weekly shopping list: just names with a bought tick. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid } from '../core/util.js';

export function addItem(title) {
  const it = { id: uid(), title: title.trim(), cat: 'other', done: false };
  S.shopping.push(it);
  return it;
}
export const findItem = (id) => S.shopping.find((i) => i.id === id);
export const remaining = () => S.shopping.filter((i) => !i.done).length;
export const boughtCount = () => S.shopping.filter((i) => i.done).length;
export const clearBought = () => { const n = boughtCount(); S.shopping = S.shopping.filter((i) => !i.done); return n; };

/** Open items first (in the order they were added), bought ones after. */
export const ordered = () => S.shopping.slice().sort((a, b) => Number(a.done) - Number(b.done));
