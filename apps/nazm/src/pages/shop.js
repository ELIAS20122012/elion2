/* Weekly shopping: a two-column grid of names, each with a small tick. "+" in the corner adds one. */
import { commit } from '../core/store.js';
import { fa, esc } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/widgets.js';
import { pageHead, empty } from '../ui/kit.js';
import * as SH from '../domain/shopping.js';
import { shopSheet } from '../features/plan-sheets.js';

export default {
  id: 'shop',
  title: 'خرید',
  render() {
    const items = SH.ordered();
    const bought = SH.boughtCount();
    return `${pageHead('خرید هفتگی', `${fa(SH.remaining())} مورد باقی‌مانده`, 'add')}
      ${items.length ? `<div class="shop-grid">${items.map((i) => `<button class="shop-item${i.done ? ' done' : ''}" data-act="toggle" data-hold="item" data-id="${i.id}"><span class="truncate">${esc(i.title)}</span><i class="tick">${icon('check')}</i></button>`).join('')}</div>
        <div class="row-between"><small>نگه‌داشتن روی یک مورد: ویرایش یا حذف</small>${bought ? `<button class="link" data-act="clear">پاک کردن خریده‌شده‌ها (${fa(bought)})</button>` : ''}</div>` : empty('فهرست خرید خالی است')}`;
  },
  act: {
    add: () => shopSheet(),
    toggle(el) { const i = SH.findItem(el.dataset.id); if (i) { i.done = !i.done; commit(); } },
    clear() { const n = SH.clearBought(); commit(); toast(`${fa(n)} مورد پاک شد`); },
  },
  hold: { item: (el) => shopSheet(el.dataset.id) },
};
