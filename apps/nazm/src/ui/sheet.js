/* Bottom sheets: generic container, form builder, action menu, confirm and info dialogs. */
import { $$ } from '../core/util.js';
import { esc } from '../core/format.js';

const CLOSE_MS = 200;
const LATER_MS = 210; // let the closing sheet finish before running a follow-up

const later = (fn) => setTimeout(fn, LATER_MS);

export function openSheet(build) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = '<div class="sheet-grip"></div>';
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), CLOSE_MS);
    document.removeEventListener('keydown', onKey);
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  build(sheet, close);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return close;
}

const textOf = (tag, text, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };

function iconChip(o) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.innerHTML = `${o.icon ? `<span class="material-symbols-outlined">${o.icon}</span>` : ''}<b></b>`;
  b.lastChild.textContent = o.label;
  return b;
}

function buildField(fd, vals, form) {
  vals[fd.name] = fd.value;
  let wrap;

  if (fd.type === 'switch') {
    wrap = document.createElement('div');
    wrap.className = `switch${fd.value ? ' on' : ''}`;
    wrap.innerHTML = '<span></span><i></i>';
    wrap.firstChild.textContent = fd.label;
    wrap.onclick = () => { vals[fd.name] = !vals[fd.name]; wrap.classList.toggle('on', vals[fd.name]); };
    return wrap;
  }

  if (fd.type === 'chips') {
    wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.append(textOf('span', fd.label));
    const box = document.createElement('div');
    box.className = 'chips';
    fd.options.forEach((o) => {
      const c = iconChip(o);
      if (o.value === fd.value) c.classList.add('on');
      c.onclick = () => {
        vals[fd.name] = o.value;
        $$('.chip', box).forEach((x) => x.classList.remove('on'));
        c.classList.add('on');
        if (fd.onChange) fd.onChange(o.value, form);
      };
      box.appendChild(c);
    });
    wrap.appendChild(box);
    return wrap;
  }

  wrap = document.createElement('label');
  wrap.className = 'field';
  wrap.append(textOf('span', fd.label));
  let input;
  if (fd.type === 'select') {
    input = document.createElement('select');
    fd.options.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.value; op.textContent = o.label; op.selected = o.value === fd.value;
      input.appendChild(op);
    });
  } else if (fd.type === 'textarea') {
    input = document.createElement('textarea');
    input.value = fd.value == null ? '' : fd.value;
  } else {
    input = document.createElement('input');
    input.type = fd.type === 'number' ? 'text' : (fd.type || 'text');
    if (fd.type === 'number') input.inputMode = 'decimal';
    input.value = fd.value == null ? '' : fd.value;
  }
  input.className = 'input';
  input.name = fd.name;
  if (fd.placeholder) input.placeholder = fd.placeholder;
  if (['time', 'date', 'number'].includes(fd.type)) input.classList.add('input-ltr');
  const sync = () => { vals[fd.name] = input.value; };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  wrap.appendChild(input);
  return wrap;
}

/** form({ title, sub, fields:[{name,label,type,value,options,placeholder,row,onChange}],
 *         submit, extra:[{label,cls,run}], focus, onSubmit(values, form) → false keeps it open }) */
export function form(cfg) {
  return openSheet((sheet, close) => {
    sheet.insertAdjacentHTML('beforeend', `<h3>${esc(cfg.title)}</h3>${cfg.sub ? `<p class="sheet-sub">${esc(cfg.sub)}</p>` : ''}`);
    const f = document.createElement('form');
    f.noValidate = true;
    const vals = {};
    let rowWrap = null;
    let rowKey = null;

    cfg.fields.forEach((fd) => {
      const wrap = buildField(fd, vals, f);
      if (fd.row) {
        if (rowKey !== fd.row) {
          rowWrap = document.createElement('div');
          rowWrap.className = fd.row.startsWith('3') ? 'row3' : 'row2';
          rowKey = fd.row;
          f.appendChild(rowWrap);
        }
        rowWrap.appendChild(wrap);
      } else { rowKey = null; f.appendChild(wrap); }
    });

    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    (cfg.extra || []).forEach((x) => {
      const b = textOf('button', x.label, `btn ${x.cls || ''}`);
      b.type = 'button';
      b.onclick = () => { close(); x.run(); };
      actions.appendChild(b);
    });
    const submit = textOf('button', cfg.submit || 'ذخیره', 'btn primary');
    submit.type = 'submit';
    actions.appendChild(submit);
    f.appendChild(actions);

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (cfg.onSubmit(vals, f) !== false) close();
    });
    sheet.appendChild(f);

    const first = f.querySelector('input.input, textarea.input');
    if (first && cfg.focus !== false) setTimeout(() => { try { first.focus(); } catch { /* ignore */ } }, 250);
  });
}

/** menu(title, [{icon,label,run,danger}|falsy], sub) */
export function menu(title, items, sub) {
  return openSheet((sheet, close) => {
    sheet.insertAdjacentHTML('beforeend', `<h3>${esc(title)}</h3>${sub ? `<p class="sheet-sub">${esc(sub)}</p>` : ''}<div class="menu"></div>`);
    const box = sheet.lastChild;
    items.filter(Boolean).forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (it.danger) b.className = 'danger';
      b.innerHTML = `<span class="material-symbols-outlined">${it.icon || 'chevron_left'}</span><span></span>`;
      b.lastChild.textContent = it.label;
      b.onclick = () => { close(); later(it.run); };
      box.appendChild(b);
    });
  });
}

export function confirmBox(title, sub, okLabel, run) {
  return openSheet((sheet, close) => {
    sheet.insertAdjacentHTML('beforeend', `<h3>${esc(title)}</h3><p class="sheet-sub">${esc(sub)}</p><div class="sheet-actions"><button class="btn">انصراف</button><button class="btn primary">${esc(okLabel)}</button></div>`);
    const [cancel, ok] = $$('.btn', sheet);
    cancel.onclick = close;
    ok.onclick = () => { close(); run(); };
  });
}

/** Read-only sheet. Elements with data-pick inside `html` call onPick(el, close). */
export function infoSheet(title, html, buttons = [], onPick) {
  return openSheet((sheet, close) => {
    sheet.insertAdjacentHTML('beforeend', `<h3>${esc(title)}</h3><div class="sheet-body">${html}</div>`);
    if (onPick) {
      sheet.addEventListener('click', (e) => {
        const el = e.target.closest('[data-pick]');
        if (el) onPick(el, close);
      });
    }
    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    buttons.forEach((x) => {
      const b = textOf('button', x.label, `btn ${x.cls || ''}`);
      b.onclick = () => { close(); later(x.run); };
      actions.appendChild(b);
    });
    const closeBtn = textOf('button', 'بستن', 'btn');
    closeBtn.onclick = close;
    actions.appendChild(closeBtn);
    sheet.appendChild(actions);
  });
}

export { later };
