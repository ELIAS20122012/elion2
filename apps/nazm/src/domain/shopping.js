/* Weekly shopping list. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid } from '../core/util.js';

export const CATS = {
  produce: { label: 'میوه و سبزی', icon: 'nutrition' },
  dairy: { label: 'لبنیات', icon: 'egg_alt' },
  bakery: { label: 'نان و غلات', icon: 'bakery_dining' },
  meat: { label: 'گوشت و مرغ', icon: 'set_meal' },
  home: { label: 'خانه و بهداشت', icon: 'cleaning_services' },
  other: { label: 'سایر', icon: 'shopping_basket' },
};
export const catOf = (it) => CATS[it.cat] || CATS.other;

export function addItem(title, cat = 'other') {
  const it = { id: uid(), title: title.trim(), cat, done: false };
  S.shopping.push(it);
  return it;
}
export const findItem = (id) => S.shopping.find((i) => i.id === id);
export const remaining = () => S.shopping.filter((i) => !i.done).length;
export const clearBought = () => { const n = S.shopping.filter((i) => i.done).length; S.shopping = S.shopping.filter((i) => !i.done); return n; };

/** Items grouped by category (open items first inside each group). */
export function grouped() {
  return Object.keys(CATS).map((cat) => ({
    cat, items: S.shopping.filter((i) => (CATS[i.cat] ? i.cat : 'other') === cat).sort((a, b) => Number(a.done) - Number(b.done)),
  })).filter((g) => g.items.length);
}
