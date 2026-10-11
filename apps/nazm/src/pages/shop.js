/* Weekly shopping: a two-column grid of names, each with a small tick. */
import { commit } from '../core/store.js';
import { fa, esc } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/widgets.js';
import { pageHead, empty } from '../ui/kit.js';
import * as SH from '../domain/shopping.js';
import { shopSheet, quickShop } from '../features/plan-sheets.js';

export default {
  id: 'shop',
  title: 'خرید',
  render() {
    const items = SH.ordered();
    const bought = SH.boughtCount();
    return `${pageHead('خرید هفتگی', `${fa(SH.remaining())} مورد باقی‌مانده`)}
      <form class="add-line" data-submit="add">${icon('add_shopping_cart', 'muted')}<input data-key="qs" name="qs" autocomplete="off" placeholder="مثلاً ماست…"><button class="btn-sm" type="submit">افزودن</button></form>
      ${items.length ? `<div class="shop-grid">${items.map((i) => `<button class="shop-item${i.done ? ' done' : ''}" data-act="toggle" data-hold="item" data-id="${i.id}"><span class="truncate">${esc(i.title)}</span><i class="tick">${icon('check')}</i></button>`).join('')}</div>
        <div class="row-between"><small>نگه‌داشتن روی یک مورد: ویرایش یا حذف</small>${bought ? `<button class="link" data-act="clear">پاک کردن خریده‌شده‌ها (${fa(bought)})</button>` : ''}</div>` : empty('فهرست خرید خالی است')}`;
  },
  act: {
    add(el) { const input = el.querySelector('input'); if (quickShop(input.value)) input.value = ''; },
    toggle(el) { const i = SH.findItem(el.dataset.id); if (i) { i.done = !i.done; commit(); } },
    clear() { const n = SH.clearBought(); commit(); toast(`${fa(n)} مورد پاک شد`); },
  },
  hold: { item: (el) => shopSheet(el.dataset.id) },
};
