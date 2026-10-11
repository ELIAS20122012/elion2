/* Daily Order App — shared runtime: state, UI kit, nav, settings, page modules */
(function () {
  'use strict';
  var PAGE = document.body.getAttribute('data-page') || 'dashboard';
  var KEY = 'daily-order-v2';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- dates & formatting ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function today() { return iso(new Date()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function hmToMin(t) { if (!t) return null; var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  var FA = '۰۱۲۳۴۵۶۷۸۹';
  function fa(x) { return String(x).replace(/\d/g, function (d) { return FA[d]; }); }
  function en(x) { return String(x).replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); }
  function num(x) { var n = parseFloat(en(String(x == null ? '' : x)).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  var faDate = function (d, opt) { try { return new Intl.DateTimeFormat(S && S.profile && S.profile.calendar === 'gregorian' ? 'fa-IR-u-ca-gregory' : 'fa-IR-u-ca-persian', opt).format(d); } catch (e) { return iso(d); } };
  function faDayMonth(d) { return faDate(d, { day: 'numeric', month: 'long' }); }
  function faDayNum(d) { return faDate(d, { day: 'numeric' }); }
  var WD_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش']; // index = getDay()
  var WD_LONG = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // index = getDay()
  function weekStart(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var back = (x.getDay() + 1) % 7; return addDays(x, -back); } // Saturday
  function money(v, hide) {
    if (hide) return '••••';
    var c = S.profile.currency || '€';
    var neg = v < 0, a = Math.abs(v);
    var n = a >= 1000 || Math.round(a) === a ? Math.round(a).toLocaleString('en-US') : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return c === 'تومان' ? '\u2067' + (neg ? '-' : '') + n + ' تومان\u2069' : '\u2066' + (neg ? '-' : '') + c + ' ' + n + '\u2069';
  }
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------------- state ---------------- */
  var memStore = null;
  function loadState() { try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return memStore; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { memStore = S; } }

  function seed() {
    var t = new Date(), d = function (n) { return iso(addDays(t, n)); };
    var tx = [], spend = [5, 10, 26, 20, 48, 32, 14];
    // expenses over last 7 days (today = first)
    var cats = ['cafe', 'shopping', 'food', 'transport', 'shopping', 'bills', 'cafe'];
    spend.forEach(function (a, i) { tx.push({ id: uid(), type: 'expense', amount: a, category: cats[i], note: '', date: d(-i) }); });
    var m1 = iso(new Date(t.getFullYear(), t.getMonth(), 1));
    tx.push({ id: uid(), type: 'income', amount: 1200, category: 'salary', note: 'حقوق', date: m1 });
    tx.push({ id: uid(), type: 'income', amount: 1150, category: 'salary', note: 'حقوق ماه قبل', date: d(-31) });
    tx.push({ id: uid(), type: 'expense', amount: 85, category: 'bills', note: 'قبض اینترنت', date: d(-12) });
    tx.push({ id: uid(), type: 'expense', amount: 60, category: 'food', note: 'خرید هفتگی', date: d(-16) });
    tx.push({ id: uid(), type: 'income', amount: 1150, category: 'salary', note: 'حقوق', date: d(-39) });
    tx.push({ id: uid(), type: 'expense', amount: 640, category: 'bills', note: 'اجاره', date: d(-35) });
    var weights = []; for (var i = 30; i >= 0; i--) weights.push({ date: d(-i), kg: Math.round((76.5 + i * 0.105 + (i % 3 === 0 ? 0.1 : 0)) * 10) / 10 });
    weights[weights.length - 1].kg = 76.5;
    var sessions = {};
    for (var j = 1; j <= 4; j++) sessions[d(-j)] = { name: 'تمرین', minutes: 45, finished: true, exercises: [{ id: uid(), name: 'تمرین عمومی', sets: 4, reps: '12', weight: '', done: 4 }] };
    sessions[d(0)] = {
      name: 'بالاتنه و میان‌تنه', minutes: 0, target: 45, finished: false, exercises: [
        { id: uid(), name: 'پرس سینه دمبل', sets: 4, reps: '10', unit: 'تکرار', weight: '30 kg', done: 4 },
        { id: uid(), name: 'زیربغل قایقی سیم‌کش', sets: 3, reps: '12', unit: 'تکرار', weight: '45 kg', done: 2 },
        { id: uid(), name: 'پلانک و کرانچ شکم', sets: 3, reps: '45', unit: 'ثانیه', weight: 'وزن بدن', done: 0 }]
    };
    return {
      v: 2, dark: false, privacy: false,
      profile: { name: 'الیاس', currency: '€' },
      tasks: [
        { id: uid(), title: 'بررسی کدهای هفتگی تیم طراحی', date: d(0), time: '10:00', category: 'work', starred: true, done: false, archived: false, reminder: false, note: 'پروژه داشبورد' },
        { id: uid(), title: 'ارسال گزارش مالی ماهانه به حسابدار', date: d(0), time: '14:30', category: 'finance', starred: false, done: true, archived: false, reminder: false, note: 'امور مالی' },
        { id: uid(), title: 'تمرین هوازی و پیاده‌روی سریع', date: d(0), time: '19:00', category: 'health', starred: false, done: false, archived: false, reminder: true, note: 'سلامت' },
        { id: uid(), title: 'تمدید اشتراک باشگاه', date: d(1), time: '12:00', category: 'personal', starred: false, done: false, archived: false, reminder: false, note: '' }
      ],
      habits: [
        { id: uid(), title: 'نوشیدن آب', icon: 'local_drink', target: 8, step: 1, unit: 'لیوان', log: (function () { var o = {}; o[d(0)] = 6; return o; })() },
        { id: uid(), title: 'مطالعه کتاب', icon: 'menu_book', target: 20, step: 5, unit: 'دقیقه', log: (function () { var o = {}; o[d(0)] = 20; return o; })() },
        { id: uid(), title: 'مدیتیشن', icon: 'self_improvement', target: 1, step: 1, unit: 'بار', log: (function () { var o = {}; o[d(0)] = 1; return o; })() }
      ],
      blocks: [
        { id: uid(), date: d(0), title: 'کار عمیق', start: '09:00', end: '10:30', color: 'terracotta', icon: 'bolt', done: false, notify: false },
        { id: uid(), date: d(0), title: 'جلسه و بازبینی', start: '11:30', end: '12:45', color: 'slate', icon: 'groups', done: false, notify: false },
        { id: uid(), date: d(0), title: 'استراحت و شارژ', start: '16:00', end: '17:00', color: 'sage', icon: 'spa', done: false, notify: true },
        { id: uid(), date: d(1), title: 'برنامه‌ریزی هفته', start: '10:00', end: '11:00', color: 'slate', icon: 'event_note', done: false, notify: false }
      ],
      plannerHideDone: false,
      wallet: { startBalance: 0, budget: 1500, alerts: true, quickSet: 0 },
      tx: tx,
      gym: {
        goals: { kcal: 2400, p: 160, c: 230, f: 65 },
        weekly: { 6: { name: 'بالاتنه و میان‌تنه', items: 'پرس سینه دمبل | 4 | 10 | 30 kg\nزیربغل قایقی سیم‌کش | 3 | 12 | 45 kg\nپلانک و کرانچ شکم | 3 | 45 | وزن بدن' }, 1: { name: 'پایین‌تنه', items: 'اسکوات | 4 | 10 | 60 kg\nلانژ دمبل | 3 | 12 | 14 kg\nپرس پا | 3 | 12 | 100 kg' }, 3: { name: 'کاردیو و شکم', items: 'تردمیل | 1 | 25 | دقیقه\nکرانچ | 3 | 20 | وزن بدن' } },
        sessions: sessions,
        meals: (function () { var o = {}; o[d(0)] = [{ id: uid(), name: 'صبحانه', kcal: 450, p: 25, c: 55, f: 14 }, { id: uid(), name: 'ناهار', kcal: 900, p: 70, c: 95, f: 26 }, { id: uid(), name: 'میان‌وعده', kcal: 500, p: 40, c: 40, f: 15 }]; return o; })(),
        lastScan: { name: 'سینه مرغ گریل + کینوا', kcal: 420, p: 42, c: 38, f: 9, photo: null, added: false },
        weights: weights,
        tab: 'workout', view: 'daily', timerStart: null
      }
    };
  }
  var S = loadState() || seed();
  if (!S.v) S = seed();
  function migrate() {
    S.profile.calendar = S.profile.calendar || 'jalali';
    if (!S.accounts) {
      S.accounts = [{ id: 'main', name: 'حساب بانکی', type: 'bank', opening: S.wallet.startBalance || 0 }, { id: 'cash', name: 'کیف پول نقد', type: 'cash', opening: 0 }];
      var t0 = today(), dm = function (n, day) { var x = addMonthsIso(t0, n); return useJ() ? fromJ(toJ(x).jy, toJ(x).jm, day) : x.slice(0, 8) + pad(day); };
      S.loans = [{ id: uid(), title: 'وام خرید خودرو', lender: 'بانک', amount: 250, count: 24, start: dm(-5, 15), every: 1, accountId: 'main', remind: true, paid: {} }];
      for (var n = 1; n <= 5; n++) S.loans[0].paid[n] = { date: addMonthsIso(S.loans[0].start, n - 1), amount: 250, txId: null, before: true };
      var cur = dayOfMonth(t0);
      S.bills = [
        { id: uid(), kind: 'rent', title: 'اجاره خانه', amount: 640, every: 1, start: dm(0, 1), accountId: 'main', remind: true, paid: {} },
        { id: uid(), kind: 'internet', title: 'اینترنت خانه', amount: 35, every: 1, start: dm(cur + 2 > 28 ? 1 : 0, Math.min(28, cur + 2 > 28 ? 2 : cur + 2)), accountId: 'main', remind: true, paid: {} },
        { id: uid(), kind: 'electricity', title: 'قبض برق و گاز', amount: 95, every: 2, start: dm(0, Math.min(28, cur + 6 > 28 ? 28 : cur + 6)), accountId: 'main', remind: true, paid: {} },
        { id: uid(), kind: 'mobile', title: 'قبض موبایل', amount: 15, every: 1, start: dm(cur + 12 > 28 ? 1 : 0, cur + 12 > 28 ? 5 : cur + 12), accountId: 'cash', remind: true, paid: {} }
      ];
      S.bills[0].paid[S.bills[0].start] = { date: S.bills[0].start, amount: 640, txId: null, before: true };
    }
    S.loans = S.loans || []; S.bills = S.bills || [];
  }
  migrate();
  save();

  /* ---------------- UI kit ---------------- */
  var toastEl, toastTimer;
  function toast(msg, action) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'app-toast'; document.body.appendChild(toastEl); }
    toastEl.innerHTML = '<span></span>';
    toastEl.firstChild.textContent = msg;
    if (action) { var b = document.createElement('button'); b.textContent = action.label; b.onclick = function () { toastEl.classList.remove('show'); action.run(); }; toastEl.appendChild(b); }
    toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, action ? 4000 : 2400);
  }
  function openSheet(build) {
    var ov = document.createElement('div'); ov.className = 'ui-overlay';
    var sh = document.createElement('div'); sh.className = 'ui-sheet'; sh.innerHTML = '<div class="ui-grip"></div>';
    ov.appendChild(sh); document.body.appendChild(ov);
    var close = function () { ov.classList.remove('open'); setTimeout(function () { ov.remove(); }, 200); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    build(sh, close);
    requestAnimationFrame(function () { ov.classList.add('open'); });
    return close;
  }
  /* form({title, sub, fields:[{name,label,type,value,options,placeholder,step,min,row}], submit, extra:[{label,cls,run}], onSubmit}) */
  function form(cfg) {
    return openSheet(function (sh, close) {
      var h = '<h3>' + esc(cfg.title) + '</h3>' + (cfg.sub ? '<p class="ui-sub">' + esc(cfg.sub) + '</p>' : '');
      var f = document.createElement('form'); f.noValidate = true;
      var vals = {};
      var rowWrap = null, rowKey = null;
      cfg.fields.forEach(function (fd) {
        vals[fd.name] = fd.value;
        var wrap;
        if (fd.type === 'switch') {
          wrap = document.createElement('div'); wrap.className = 'ui-switch' + (fd.value ? ' on' : ''); wrap.innerHTML = '<span></span><i></i>';
          wrap.firstChild.textContent = fd.label;
          wrap.onclick = function () { vals[fd.name] = !vals[fd.name]; wrap.classList.toggle('on', vals[fd.name]); };
        } else if (fd.type === 'chips') {
          wrap = document.createElement('div'); wrap.className = 'ui-field'; wrap.innerHTML = '<span></span><div class="ui-chips"></div>';
          wrap.firstChild.textContent = fd.label;
          fd.options.forEach(function (o) {
            var c = document.createElement('button'); c.type = 'button'; c.className = 'ui-chip' + (o.value === fd.value ? ' on' : '');
            c.innerHTML = (o.icon ? '<span class="material-symbols-outlined">' + o.icon + '</span>' : '') + '<b></b>'; c.lastChild.textContent = o.label;
            c.onclick = function () { vals[fd.name] = o.value; $$('.ui-chip', wrap).forEach(function (x) { x.classList.remove('on'); }); c.classList.add('on'); if (fd.onChange) fd.onChange(o.value, f); };
            wrap.lastChild.appendChild(c);
          });
        } else {
          wrap = document.createElement('label'); wrap.className = 'ui-field'; wrap.innerHTML = '<span></span>';
          wrap.firstChild.textContent = fd.label;
          var inp;
          if (fd.type === 'select') { inp = document.createElement('select'); fd.options.forEach(function (o) { var op = document.createElement('option'); op.value = o.value; op.textContent = o.label; if (o.value === fd.value) op.selected = true; inp.appendChild(op); }); }
          else if (fd.type === 'textarea') { inp = document.createElement('textarea'); inp.value = fd.value == null ? '' : fd.value; }
          else { inp = document.createElement('input'); inp.type = fd.type === 'number' ? 'text' : (fd.type || 'text'); if (fd.type === 'number') inp.inputMode = 'decimal'; inp.value = fd.value == null ? '' : fd.value; }
          inp.className = 'ui-input'; inp.name = fd.name; if (fd.placeholder) inp.placeholder = fd.placeholder;
          if (fd.type === 'time' || fd.type === 'date' || fd.type === 'number') inp.style.direction = 'ltr', inp.style.textAlign = 'right';
          wrap.appendChild(inp);
          inp.addEventListener('input', function () { vals[fd.name] = inp.value; });
          inp.addEventListener('change', function () { vals[fd.name] = inp.value; });
        }
        if (fd.row) {
          if (rowKey !== fd.row) { rowWrap = document.createElement('div'); rowWrap.className = fd.row.indexOf('3') === 0 ? 'ui-row3' : 'ui-row2'; rowKey = fd.row; f.appendChild(rowWrap); }
          rowWrap.appendChild(wrap);
        } else { rowKey = null; f.appendChild(wrap); }
      });
      var acts = document.createElement('div'); acts.className = 'ui-actions';
      (cfg.extra || []).forEach(function (x) { var b = document.createElement('button'); b.type = 'button'; b.className = 'ui-btn ' + (x.cls || ''); b.textContent = x.label; b.onclick = function () { close(); x.run(); }; acts.appendChild(b); });
      var sub = document.createElement('button'); sub.type = 'submit'; sub.className = 'ui-btn primary'; sub.textContent = cfg.submit || 'ذخیره'; acts.appendChild(sub);
      f.appendChild(acts);
      f.addEventListener('submit', function (e) { e.preventDefault(); if (cfg.onSubmit(vals, f) !== false) close(); });
      sh.insertAdjacentHTML('beforeend', h); sh.appendChild(f);
      var first = f.querySelector('input.ui-input, textarea.ui-input');
      if (first && cfg.focus !== false) setTimeout(function () { try { first.focus(); } catch (e) { } }, 250);
      if (cfg.after) cfg.after(sh, close);
    });
  }
  function menu(title, items, sub) {
    return openSheet(function (sh, close) {
      sh.insertAdjacentHTML('beforeend', '<h3>' + esc(title) + '</h3>' + (sub ? '<p class="ui-sub">' + esc(sub) + '</p>' : '') + '<div class="ui-menu"></div>');
      var m = sh.lastChild;
      items.filter(Boolean).forEach(function (it) {
        var b = document.createElement('button'); b.type = 'button'; if (it.danger) b.className = 'danger';
        b.innerHTML = '<span class="material-symbols-outlined">' + (it.icon || 'chevron_left') + '</span><span></span>'; b.lastChild.textContent = it.label;
        b.onclick = function () { close(); setTimeout(it.run, 210); };
        m.appendChild(b);
      });
    });
  }
  function confirmBox(title, sub, okLabel, run) {
    return openSheet(function (sh, close) {
      sh.insertAdjacentHTML('beforeend', '<h3>' + esc(title) + '</h3><p class="ui-sub">' + esc(sub) + '</p><div class="ui-actions"><button class="ui-btn">انصراف</button><button class="ui-btn primary">' + esc(okLabel) + '</button></div>');
      var bs = $$('.ui-btn', sh); bs[0].onclick = close; bs[1].onclick = function () { close(); run(); };
    });
  }
  function infoSheet(title, html, buttons) {
    return openSheet(function (sh, close) {
      sh.insertAdjacentHTML('beforeend', '<h3>' + esc(title) + '</h3><div class="ui-body">' + html + '</div>');
      var acts = document.createElement('div'); acts.className = 'ui-actions';
      (buttons || []).forEach(function (x) { var b = document.createElement('button'); b.className = 'ui-btn ' + (x.cls || ''); b.textContent = x.label; b.onclick = function () { close(); setTimeout(x.run, 210); }; acts.appendChild(b); });
      var c = document.createElement('button'); c.className = 'ui-btn'; c.textContent = 'بستن'; c.onclick = close; acts.appendChild(c);
      sh.appendChild(acts);
    });
  }
  function onTap(el, fn) { if (!el) return; el.setAttribute('data-click', ''); el.removeAttribute('onclick'); el.onclick = null; el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(e); }); }
  function longPress(el, fn) {
    var t, fired = false;
    el.addEventListener('pointerdown', function () { fired = false; t = setTimeout(function () { fired = true; fn(); }, 550); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, function () { clearTimeout(t); }); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); clearTimeout(t); fired = true; fn(); });
    return function () { return fired; };
  }
  function byText(sel, text, root) { return $$(sel, root).find(function (e) { return (e.textContent || '').replace(/\s+/g, ' ').trim().indexOf(text) !== -1; }); }
  function go(page) { location.href = page + '.html?page=' + page; }
  function pickFile(accept, capture, cb) {
    var i = document.createElement('input'); i.type = 'file'; i.accept = accept; if (capture) i.setAttribute('capture', 'environment');
    i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (f) cb(f); };
    i.click();
  }
  function shrinkImage(file, max, cb) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }
  /* Claude capabilities live on the top-level artifact page (this page runs inside its frame) */
  function cap(name) {
    try { if (window.claude && window.claude.use) return window.claude.use(name).catch(function () { return null; }); } catch (e) { }
    try { var host = window.parent && window.parent !== window ? window.parent : null; if (host && host.claude && host.claude.use) return host.claude.use(name).catch(function () { return null; }); } catch (e) { }
    return Promise.resolve(null);
  }
  function askVision(file, prompt) {
    return cap('sample').then(function (sample) {
      if (!sample) throw { code: 'unavailable' };
      return (sample.limits ? sample.limits().catch(function () { return null; }) : Promise.resolve(null)).then(function (lim) {
        if (!lim || !lim.images) throw { code: 'images_unavailable' };
        return sample.json(prompt, { images: [file], modelTier: 'default' });
      });
    });
  }

  /* ---------------- shared header: settings / dark / profile ---------------- */
  function applyDark() {
    document.documentElement.classList.toggle('dark', !!S.dark);
    $$('header .material-symbols-outlined').forEach(function (i) { var t = i.textContent.trim(); if (t === 'dark_mode' || t === 'light_mode') i.textContent = S.dark ? 'light_mode' : 'dark_mode'; if (t === 'bedtime' || t === 'wb_sunny') i.textContent = S.dark ? 'wb_sunny' : 'bedtime'; });
  }
  function toggleDark() { S.dark = !S.dark; save(); applyDark(); toast(S.dark ? 'حالت تاریک فعال شد' : 'حالت روشن فعال شد'); }
  function exportData() {
    var data = JSON.stringify(S, null, 2), name = 'daily-order-backup-' + today() + '.json';
    cap('downloads').then(function (dl) {
      if (dl) return dl.save({ filename: name, data: data }).then(function () { toast('فایل پشتیبان آماده شد'); }, function () { toast('ذخیره فایل لغو شد'); });
      try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('فایل پشتیبان دانلود شد'); }
      catch (e) { toast('دانلود در این محیط ممکن نیست'); }
    });
  }
  function importData() {
    pickFile('application/json,.json', false, function (f) {
      var r = new FileReader();
      r.onload = function () { try { var o = JSON.parse(r.result); if (!o || !o.v || !o.tasks) throw 0; S = o; save(); toast('اطلاعات بازیابی شد'); setTimeout(function () { location.reload(); }, 600); } catch (e) { toast('فایل معتبر نیست'); } };
      r.readAsText(f);
    });
  }
  function openSettings() {
    form({
      title: 'تنظیمات', sub: 'اطلاعات فقط روی همین دستگاه و مرورگر ذخیره می‌شوند.',
      fields: [
        { name: 'name', label: 'نام شما', value: S.profile.name },
        { name: 'currency', label: 'واحد پول', type: 'chips', value: S.profile.currency, options: [{ value: '€', label: 'یورو €' }, { value: '$', label: 'دلار $' }, { value: 'تومان', label: 'تومان' }] },
        { name: 'budget', label: 'بودجه ماهانه', type: 'number', value: S.wallet.budget, row: 'a' },
        { name: 'kcal', label: 'هدف کالری روزانه', type: 'number', value: S.gym.goals.kcal, row: 'a' },
        { name: 'calendar', label: 'تقویم (نمایش تاریخ‌ها و سررسید اقساط/قبوض)', type: 'chips', value: S.profile.calendar || 'jalali', options: [{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }] },
        { name: 'dark', label: 'حالت تاریک', type: 'switch', value: S.dark },
        { name: 'notif', label: 'اعلان یادآورها در مرورگر', type: 'switch', value: notifAllowed() }
      ],
      extra: [{ label: 'داده‌ها…', run: dataMenu }],
      onSubmit: function (v) {
        S.profile.name = (v.name || '').trim(); S.profile.currency = v.currency; S.profile.calendar = v.calendar || 'jalali';
        S.wallet.budget = Math.max(0, num(v.budget)) || S.wallet.budget; S.gym.goals.kcal = Math.max(500, num(v.kcal)) || S.gym.goals.kcal;
        var darkChanged = !!v.dark !== !!S.dark; S.dark = !!v.dark; save(); applyDark();
        if (v.notif && !notifAllowed()) askNotif();
        toast('تنظیمات ذخیره شد'); if (!darkChanged) refresh();
      }
    });
  }
  function dataMenu() {
    menu('مدیریت داده‌ها', [
      { icon: 'download', label: 'گرفتن نسخه پشتیبان (JSON)', run: exportData },
      { icon: 'upload', label: 'بازیابی از فایل پشتیبان', run: importData },
      { icon: 'restart_alt', label: 'بازگشت به داده‌های نمونه', run: function () { confirmBox('بازگشت به داده‌های نمونه؟', 'همه اطلاعات فعلی با داده‌های نمونه جایگزین می‌شود.', 'بله، جایگزین کن', function () { var d = S.dark; S = seed(); S.dark = d; save(); location.reload(); }); } },
      { icon: 'delete_forever', label: 'پاک کردن همه اطلاعات', danger: true, run: function () { confirmBox('همه اطلاعات پاک شود؟', 'کارها، عادت‌ها، تراکنش‌ها و سوابق ورزشی حذف می‌شوند و قابل بازگشت نیست.', 'پاک کن', function () { var d = S.dark, p = S.profile; S = seed(); S.tasks = []; S.habits = []; S.blocks = []; S.tx = []; S.gym.sessions = {}; S.gym.meals = {}; S.gym.weights = []; S.gym.lastScan = null; S.dark = d; S.profile = p; S.accounts = [{ id: 'main', name: 'حساب اصلی', type: 'bank', opening: 0 }]; S.loans = []; S.bills = []; save(); location.reload(); }); } }
    ]);
  }
  function notifAllowed() { try { return window.Notification && Notification.permission === 'granted'; } catch (e) { return false; } }
  function askNotif() { try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission().then(function (p) { toast(p === 'granted' ? 'اعلان‌ها فعال شد' : 'مرورگر اجازه اعلان نداد؛ یادآورها داخل برنامه نمایش داده می‌شوند'); }); else if (!notifAllowed()) toast('مرورگر اجازه اعلان نداد؛ یادآورها داخل برنامه نمایش داده می‌شوند'); } catch (e) { } }
  function bindHeader() {
    $$('button[aria-label="تنظیمات"], #settingsBtn').forEach(function (b) { onTap(b, openSettings); });
    $$('button[aria-label="حالت شب"], #themeToggleBtn').forEach(function (b) { onTap(b, toggleDark); });
    var av = $('#userAvatarBtn') || (byText('header .material-symbols-outlined', 'person') || {}).parentElement;
    if (av) onTap(av.closest('.relative') || av, openProfile);
  }
  function openProfile() {
    var t = S.tasks.filter(function (x) { return x.date === today() && !x.archived; });
    var html = '<div class="ui-stat"><div><small>کارهای امروز</small><b>' + fa(t.filter(function (x) { return x.done; }).length) + '/' + fa(t.length) + '</b></div><div><small>موجودی کیف پول</small><b>' + money(balance(), S.privacy) + '</b></div><div><small>روزهای پیاپی ورزش</small><b>' + fa(streak()) + ' روز</b></div><div><small>آخرین وزن</small><b>' + (lastWeight() ? fa(lastWeight().kg) + ' kg' : '—') + '</b></div></div>';
    infoSheet(S.profile.name ? 'سلام ' + S.profile.name : 'نمای کلی امروز', html, [{ label: 'تنظیمات', cls: 'primary', run: openSettings }]);
  }

  /* ---------------- bottom nav ---------------- */
  function buildNav() {
    var items = [['dashboard', 'dashboard', 'پیشخوان'], ['tasks-habits', 'check_circle', 'کارها و عادت‌ها'], ['planner-calendar', 'calendar_today', 'برنامه‌ریزی'], ['gym', 'fitness_center', 'ورزش'], ['wallet-finance', 'account_balance_wallet', 'کیف پول']];
    var n = document.createElement('nav'); n.id = 'app-nav'; n.dir = 'rtl';
    n.innerHTML = '<div class="dock">' + items.map(function (it) { return '<a href="' + it[0] + '.html?page=' + it[0] + '" aria-label="' + it[2] + '" title="' + it[2] + '"' + (it[0] === PAGE ? ' aria-current="page"' : '') + '><span class="material-symbols-outlined">' + it[1] + '</span></a>'; }).join('') + '</div>';
    document.body.appendChild(n);
  }

  /* ---------------- shared domain helpers ---------------- */
  var CAT = { work: { label: 'کار', dot: 'bg-chart-terracotta' }, personal: { label: 'شخصی', dot: 'bg-chart-sage' }, health: { label: 'سلامت', dot: 'bg-primary-container' }, finance: { label: 'مالی', dot: 'bg-secondary-container' } };
  var TXCAT = {
    shopping: { label: 'خرید', icon: 'shopping_cart' }, bills: { label: 'قبوض و کارت', icon: 'credit_card' }, cafe: { label: 'کافه', icon: 'local_cafe' },
    food: { label: 'خوراک', icon: 'restaurant' }, transport: { label: 'حمل‌ونقل', icon: 'directions_car' }, sport: { label: 'ورزش', icon: 'fitness_center' },
    travel: { label: 'سفر', icon: 'flight' }, health: { label: 'سلامت', icon: 'spa' }, other: { label: 'سایر', icon: 'payments' },
    installment: { label: 'قسط و وام', icon: 'event_repeat' }, salary: { label: 'حقوق', icon: 'work' }, gift: { label: 'هدیه', icon: 'redeem' }, transfer: { label: 'انتقال', icon: 'swap_horiz' }
  };
  var EXP_CATS = ['shopping', 'food', 'cafe', 'bills', 'installment', 'transport', 'sport', 'travel', 'health', 'other'];
  var INC_CATS = ['salary', 'gift', 'transfer', 'other'];
  /* Jalali calendar (jalaali algorithm) */
  function jdiv(a, b) { return ~~(a / b); }
  function jmod(a, b) { return a - ~~(a / b) * b; }
  function jalCal(jy) {
    var JBRK = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    var bl = JBRK.length, gy = jy + 621, leapJ = -14, jp = JBRK[0], jm, jump = 0, leap, leapG, march, n, i;
    for (i = 1; i < bl; i += 1) { jm = JBRK[i]; jump = jm - jp; if (jy < jm) break; leapJ = leapJ + jdiv(jump, 33) * 8 + jdiv(jmod(jump, 33), 4); jp = jm; }
    n = jy - jp; leapJ = leapJ + jdiv(n, 33) * 8 + jdiv(jmod(n, 33) + 3, 4);
    if (jmod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = jdiv(gy, 4) - jdiv((jdiv(gy, 100) + 1) * 3, 4) - 150; march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + jdiv(jump + 4, 33) * 33;
    leap = jmod(jmod(n + 1, 33) - 1, 4); if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }
  function g2d(gy, gm, gd) { var d = jdiv((gy + jdiv(gm - 8, 6) + 100100) * 1461, 4) + jdiv(153 * jmod(gm + 9, 12) + 2, 5) + gd - 34840408; return d - jdiv(jdiv(gy + 100100 + jdiv(gm - 8, 6), 100) * 3, 4) + 752; }
  function d2g(jdn) { var j = 4 * jdn + 139361631; j = j + jdiv(jdiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908; var i = jdiv(jmod(j, 1461), 4) * 5 + 308; var gd = jdiv(jmod(i, 153), 5) + 1, gm = jmod(jdiv(i, 153), 12) + 1, gy = jdiv(j, 1461) - 100100 + jdiv(8 - gm, 6); return { gy: gy, gm: gm, gd: gd }; }
  function j2d(jy, jm, jd) { var r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - jdiv(jm, 7) * (jm - 7) + jd - 1; }
  function d2j(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy), k = jdn - g2d(gy, 3, r.march), jm, jd;
    if (k >= 0) { if (k <= 185) { jm = 1 + jdiv(k, 31); jd = jmod(k, 31) + 1; return { jy: jy, jm: jm, jd: jd }; } k -= 186; }
    else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
    jm = 7 + jdiv(k, 30); jd = jmod(k, 30) + 1; return { jy: jy, jm: jm, jd: jd };
  }
  function jMonthLen(jy, jm) { return jm <= 6 ? 31 : jm <= 11 ? 30 : (jalCal(jy).leap === 0 ? 30 : 29); }
  function toJ(isoS) { var p = isoS.split('-'); return d2j(g2d(+p[0], +p[1], +p[2])); }
  function fromJ(jy, jm, jd) { var g = d2g(j2d(jy, jm, jd)); return g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0'); }
  /* ---- calendar-aware months (Jalali by default) ---- */
  function useJ() { return (S.profile.calendar || 'jalali') === 'jalali'; }
  function monthKey(d) { if (useJ()) { var j = toJ(d); return j.jy + '-' + pad(j.jm); } return d.slice(0, 7); }
  function monthStartIso(key) { var p = key.split('-'); return useJ() ? fromJ(+p[0], +p[1], 1) : key + '-01'; }
  function shiftMonthKey(key, n) { var p = key.split('-'), y = +p[0], m = +p[1] - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function prevMonthKey() { return shiftMonthKey(monthKey(today()), -1); }
  function monthLabel(key) { return faDate(parseIso(monthStartIso(key)), { month: 'long', year: 'numeric' }); }
  /* add n months keeping the anchor day (clamped to month length) */
  function addMonthsIso(isoS, n, anchorDay) {
    if (useJ()) { var j = toJ(isoS), m = j.jm - 1 + n, y = j.jy + Math.floor(m / 12); m = ((m % 12) + 12) % 12 + 1; return fromJ(y, m, Math.min(anchorDay || j.jd, jMonthLen(y, m))); }
    var d = parseIso(isoS), y2 = d.getFullYear(), m2 = d.getMonth() + n, ad = anchorDay || d.getDate();
    var last = new Date(y2, m2 + 1, 0).getDate(); return iso(new Date(y2, m2, Math.min(ad, last)));
  }
  function dayOfMonth(isoS) { return useJ() ? toJ(isoS).jd : parseIso(isoS).getDate(); }
  function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 864e5); }

  /* ---- accounts ---- */
  var ACC_TYPES = { bank: { label: 'حساب بانکی', icon: 'account_balance' }, card: { label: 'کارت', icon: 'credit_card' }, cash: { label: 'نقد', icon: 'payments' }, saving: { label: 'پس‌انداز', icon: 'savings' } };
  function accounts() { return S.accounts; }
  function accName(id) { var a = S.accounts.find(function (x) { return x.id === id; }); return a ? a.name : 'حساب اصلی'; }
  function defAcc() { return (S.accounts[0] || { id: 'main' }).id; }
  function accBalance(id) {
    var a = S.accounts.find(function (x) { return x.id === id; }), b = a ? (+a.opening || 0) : 0;
    S.tx.forEach(function (t) {
      var acc = t.accountId || defAcc();
      if (t.type === 'income' && acc === id) b += t.amount;
      else if (t.type === 'expense' && acc === id) b -= t.amount;
      else if (t.type === 'transfer') { if (acc === id) b -= t.amount; if (t.toAccountId === id) b += t.amount; }
    });
    return b;
  }
  function balance() { return S.accounts.reduce(function (s, a) { return s + accBalance(a.id); }, 0); }
  function monthSum(type, mk) { mk = mk || monthKey(today()); return S.tx.filter(function (t) { return t.type === type && monthKey(t.date) === mk; }).reduce(function (s, t) { return s + t.amount; }, 0); }
  function daySpend(date) { return S.tx.filter(function (t) { return t.type === 'expense' && t.date === date; }).reduce(function (s, t) { return s + t.amount; }, 0); }
  function accOptions() { return S.accounts.map(function (a) { return { value: a.id, label: a.name, icon: (ACC_TYPES[a.type] || ACC_TYPES.bank).icon }; }); }

  function txSheet(type, preset, editId) {
    var t = editId ? S.tx.find(function (x) { return x.id === editId; }) : null;
    type = t ? t.type : type;
    if (type === 'transfer') { transferSheet(t); return; }
    var cats = (type === 'income' ? INC_CATS : EXP_CATS).map(function (k) { return { value: k, label: TXCAT[k].label, icon: TXCAT[k].icon }; });
    var linked = t && (t.loanId || t.billId);
    var fields = [
      { name: 'amount', label: 'مبلغ (' + S.profile.currency + ')', type: 'number', value: t ? t.amount : (preset && preset.amount) || '', placeholder: '0' },
      { name: 'category', label: 'دسته', type: 'chips', value: t ? t.category : (preset && preset.category) || cats[0].value, options: cats },
      { name: 'note', label: preset && preset.noteLabel || 'توضیح', value: t ? t.note : (preset && preset.note) || '', placeholder: 'اختیاری' },
      { name: 'date', label: 'تاریخ', type: 'date', value: t ? t.date : (preset && preset.date) || today() }
    ];
    if (S.accounts.length > 1) fields.push({ name: 'acc', label: type === 'income' ? 'واریز به حساب' : 'پرداخت از حساب', type: 'chips', value: t ? (t.accountId || defAcc()) : (preset && preset.accountId) || defAcc(), options: accOptions() });
    form({
      title: t ? 'ویرایش تراکنش' : (preset && preset.title) || (type === 'income' ? 'ثبت دریافتی' : 'ثبت هزینه'),
      sub: linked ? 'این تراکنش به ' + (t.loanId ? 'یک قسط' : 'یک قبض') + ' متصل است؛ حذف آن، پرداخت را هم لغو می‌کند.' : preset && preset.sub,
      fields: fields,
      extra: t ? [{ label: 'حذف', cls: 'danger', run: function () { removeTx(t.id); } }] : [],
      onSubmit: function (v) {
        var a = Math.abs(num(v.amount)); if (!a) { toast('مبلغ را وارد کنید'); return false; }
        var acc = v.acc || (t && t.accountId) || defAcc();
        if (t) { t.amount = a; t.category = v.category; t.note = (v.note || '').trim(); t.date = v.date || t.date; t.accountId = acc; syncLinked(t); }
        else S.tx.push({ id: uid(), type: type, amount: a, category: v.category, note: (v.note || '').trim(), date: v.date || today(), accountId: acc });
        save(); refresh(); toast(t ? 'تراکنش ویرایش شد' : (type === 'income' ? 'دریافتی ثبت شد' : 'هزینه ثبت شد'));
        if (!t && type === 'expense') budgetCheck();
      }
    });
  }
  function transferSheet(t) {
    if (S.accounts.length < 2) { toast('برای انتقال، حداقل دو حساب لازم است'); accountSheet(); return; }
    form({
      title: t ? 'ویرایش انتقال' : 'انتقال بین حساب‌ها', sub: 'انتقال روی مجموع موجودی، درآمد و هزینه اثری ندارد.',
      fields: [
        { name: 'amount', label: 'مبلغ (' + S.profile.currency + ')', type: 'number', value: t ? t.amount : '' },
        { name: 'from', label: 'از حساب', type: 'chips', value: t ? t.accountId : S.accounts[0].id, options: accOptions() },
        { name: 'to', label: 'به حساب', type: 'chips', value: t ? t.toAccountId : S.accounts[1].id, options: accOptions() },
        { name: 'note', label: 'توضیح', value: t ? t.note : '', placeholder: 'اختیاری' },
        { name: 'date', label: 'تاریخ', type: 'date', value: t ? t.date : today() }
      ],
      extra: t ? [{ label: 'حذف', cls: 'danger', run: function () { removeTx(t.id); } }] : [],
      onSubmit: function (v) {
        var a = Math.abs(num(v.amount)); if (!a) { toast('مبلغ را وارد کنید'); return false; }
        if (v.from === v.to) { toast('حساب مبدأ و مقصد یکی است'); return false; }
        var o = t || { id: uid(), type: 'transfer', category: 'transfer' };
        o.amount = a; o.accountId = v.from; o.toAccountId = v.to; o.note = (v.note || '').trim(); o.date = v.date || today();
        if (!t) S.tx.push(o); save(); refresh(); toast('انتقال ثبت شد');
      }
    });
  }
  function removeTx(id) {
    var i = S.tx.findIndex(function (x) { return x.id === id; }); if (i < 0) return;
    var old = S.tx.splice(i, 1)[0]; var unlinked = unlinkTx(old); save(); refresh();
    toast(unlinked ? 'تراکنش حذف و پرداخت لغو شد' : 'تراکنش حذف شد', { label: 'واگرد', run: function () { S.tx.push(old); relinkTx(old, unlinked); save(); refresh(); } });
  }
  function budgetCheck() {
    if (!S.wallet.alerts) return;
    var used = monthSum('expense') / (S.wallet.budget || 1);
    if (used >= 1) setTimeout(function () { toast('هشدار: از بودجه این ماه عبور کردید'); }, 2500);
    else if (used >= 0.8) setTimeout(function () { toast('هشدار: ' + fa(Math.round(used * 100)) + '٪ بودجه ماه مصرف شده'); }, 2500);
  }
  function txLabel(t) { var c = TXCAT[t.category] || TXCAT.other; return t.type === 'transfer' ? 'انتقال: ' + accName(t.accountId) + ' ← ' + accName(t.toAccountId) : c.label; }
  function txRowsHtml(list) {
    if (!list.length) return '<div class="ui-empty">تراکنشی ثبت نشده</div>';
    return '<div class="ui-list">' + list.map(function (t) {
      var c = TXCAT[t.category] || TXCAT.other, cls = t.type === 'income' ? 'ui-pos' : t.type === 'expense' ? 'ui-neg' : '', sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '⇄ ';
      return '<div class="ui-item" data-tx="' + t.id + '"><div class="ic"><span class="material-symbols-outlined">' + (t.type === 'transfer' ? 'swap_horiz' : c.icon) + '</span></div><div class="grow"><div class="t">' + esc(t.note || c.label) + '</div><div class="s">' + esc(txLabel(t)) + ' • ' + faDayMonth(parseIso(t.date)) + (S.accounts.length > 1 && t.type !== 'transfer' ? ' • ' + esc(accName(t.accountId || defAcc())) : '') + '</div></div><div class="amt ' + cls + '">' + sign + money(t.amount, S.privacy) + '</div></div>';
    }).join('') + '</div>';
  }
  function historySheet(filterFn, title) {
    var list = S.tx.filter(filterFn || function () { return true; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var groups = {}, order = [], html = '';
    list.forEach(function (t) { var k = monthKey(t.date); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(t); });
    order.forEach(function (k) { html += '<div class="ui-group">' + monthLabel(k) + '</div>' + txRowsHtml(groups[k]); });
    if (!html) html = '<div class="ui-empty">تراکنشی ثبت نشده</div>';
    var close = infoSheet(title || 'همه تراکنش‌ها', '<p class="ui-sub">برای ویرایش یا حذف، روی تراکنش بزنید.</p>' + html, [{ label: 'تراکنش جدید', cls: 'primary', run: function () { newTxMenu(); } }]);
    $$('.ui-overlay [data-tx]').forEach(function (r) { r.style.cursor = 'pointer'; r.onclick = function () { var id = r.getAttribute('data-tx'); close(); setTimeout(function () { txSheet(null, null, id); }, 210); }; });
  }
  function newTxMenu() {
    menu('ثبت جدید', [
      { icon: 'arrow_upward', label: 'هزینه', run: function () { txSheet('expense'); } },
      { icon: 'arrow_downward', label: 'دریافتی / درآمد', run: function () { txSheet('income'); } },
      { icon: 'swap_horiz', label: 'انتقال بین حساب‌ها', run: function () { transferSheet(); } },
      { icon: 'event_repeat', label: 'قسط / وام جدید', run: function () { loanSheet(); } },
      { icon: 'receipt_long', label: 'قبض یا پرداخت دوره‌ای جدید', run: function () { billSheet(); } },
      { icon: 'account_balance', label: 'حساب یا کارت جدید', run: function () { accountSheet(); } }
    ]);
  }
  function reportSheet() {
    var mk = monthKey(today()), inc = monthSum('income'), exp = monthSum('expense'), prev = monthSum('expense', prevMonthKey());
    var byCat = {}; S.tx.filter(function (t) { return t.type === 'expense' && monthKey(t.date) === mk; }).forEach(function (t) { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var diff = prev ? Math.round((exp - prev) / prev * 100) : null, debt = loansRemaining(), due30 = dueItems(30).filter(function (d) { return !d.paid; }).reduce(function (s, d) { return s + d.amount; }, 0);
    var html = '<p class="ui-sub">' + monthLabel(mk) + '</p><div class="ui-stat"><div><small>درآمد این ماه</small><b class="ui-pos">' + money(inc, S.privacy) + '</b></div><div><small>هزینه این ماه</small><b class="ui-neg">' + money(exp, S.privacy) + '</b></div><div><small>خالص این ماه</small><b>' + money(inc - exp, S.privacy) + '</b></div><div><small>هزینه نسبت به ماه قبل</small><b>' + (diff == null ? '—' : (diff > 0 ? '+' : '') + fa(diff) + '٪') + '</b></div><div><small>بدهی باقی‌مانده اقساط</small><b class="ui-neg">' + money(debt, S.privacy) + '</b></div><div><small>دارایی خالص</small><b>' + money(balance() - debt, S.privacy) + '</b></div><div><small>پرداختنی ۳۰ روز آینده</small><b>' + money(due30, S.privacy) + '</b></div><div><small>بودجه باقی‌مانده</small><b>' + money(Math.max(0, S.wallet.budget - exp), S.privacy) + '</b></div></div>';
    // 6-month cash flow
    var rows = [], mx = 1;
    for (var i = 5; i >= 0; i--) { var k = shiftMonthKey(mk, -i), a = monthSum('income', k), e = monthSum('expense', k); mx = Math.max(mx, a, e); rows.push([k, a, e]); }
    html += '<div class="ui-group">جریان نقدی ۶ ماه اخیر</div><div class="ui-list">' + rows.map(function (r) { return '<div class="ui-item" style="display:block"><div style="display:flex;justify-content:space-between;font-size:12px"><b>' + monthLabel(r[0]) + '</b><span><span class="ui-pos">+' + money(r[1], S.privacy) + '</span> / <span class="ui-neg">−' + money(r[2], S.privacy) + '</span></span></div><div class="ui-bar"><i style="width:' + Math.round(r[1] / mx * 100) + '%;background:#8eaa97"></i></div><div class="ui-bar" style="margin-top:4px"><i style="width:' + Math.round(r[2] / mx * 100) + '%"></i></div></div>'; }).join('') + '</div>';
    html += '<div class="ui-group">هزینه این ماه بر اساس دسته</div>' + (cats.length ? cats.map(function (k) { var c = TXCAT[k] || TXCAT.other; return '<div class="ui-item"><div class="ic"><span class="material-symbols-outlined">' + c.icon + '</span></div><div class="grow"><div class="t">' + c.label + ' <span class="s">' + fa(Math.round(byCat[k] / exp * 100)) + '٪</span></div><div class="ui-bar"><i style="width:' + Math.round(byCat[k] / exp * 100) + '%"></i></div></div><div class="amt">' + money(byCat[k], S.privacy) + '</div></div>'; }).join('') : '<div class="ui-empty">هنوز هزینه‌ای در این ماه ثبت نشده</div>');
    infoSheet('گزارش مالی', html, PAGE === 'wallet-finance' ? [{ label: 'خروجی اکسل (CSV)', run: function () { exportCsv(S.tx, 'all'); } }, { label: 'تنظیم بودجه', run: budgetSheet }] : [{ label: 'کیف پول', cls: 'primary', run: function () { go('wallet-finance'); } }]);
  }
  function budgetSheet() {
    form({ title: 'بودجه ماهانه', sub: 'هزینه این ماه: ' + money(monthSum('expense')), fields: [{ name: 'b', label: 'سقف هزینه ماهانه (' + S.profile.currency + ')', type: 'number', value: S.wallet.budget }, { name: 'alerts', label: 'هشدار نزدیک شدن به سقف بودجه', type: 'switch', value: S.wallet.alerts }], onSubmit: function (v) { var b = num(v.b); if (b <= 0) { toast('مبلغ معتبر وارد کنید'); return false; } S.wallet.budget = b; S.wallet.alerts = !!v.alerts; save(); refresh(); toast('بودجه به‌روزرسانی شد'); } });
  }
  function saveFile(name, data, mime) {
    cap('downloads').then(function (dl) {
      if (dl) return dl.save({ filename: name, data: data }).then(function () { toast('فایل آماده شد'); }, function () { toast('ذخیره فایل لغو شد'); });
      try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('فایل دانلود شد'); }
      catch (e) { toast('دانلود در این محیط ممکن نیست'); }
    });
  }
  function exportCsv(list, tag) {
    var q = function (x) { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var rows = [['تاریخ میلادی', 'تاریخ شمسی', 'نوع', 'دسته', 'توضیح', 'حساب', 'به حساب', 'مبلغ', 'واحد']];
    list.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) {
      var j = toJ(t.date);
      rows.push([t.date, j.jy + '/' + pad(j.jm) + '/' + pad(j.jd), t.type === 'income' ? 'درآمد' : t.type === 'expense' ? 'هزینه' : 'انتقال', (TXCAT[t.category] || TXCAT.other).label, t.note, accName(t.accountId || defAcc()), t.type === 'transfer' ? accName(t.toAccountId) : '', (t.type === 'expense' ? -t.amount : t.amount), S.profile.currency]);
    });
    saveFile('ledger-' + tag + '-' + today() + '.csv', '﻿' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n'), 'text/csv');
  }
  /* =================== Accounting: installments, bills, dues, accounts, ledger =================== */
  var BILL_KINDS = {
    electricity: { label: 'برق', icon: 'bolt' }, gas: { label: 'گاز', icon: 'local_fire_department' }, water: { label: 'آب', icon: 'water_drop' },
    internet: { label: 'اینترنت', icon: 'wifi' }, mobile: { label: 'موبایل', icon: 'smartphone' }, rent: { label: 'اجاره', icon: 'home' },
    insurance: { label: 'بیمه', icon: 'shield' }, subscription: { label: 'اشتراک', icon: 'subscriptions' }, tax: { label: 'مالیات / عوارض', icon: 'gavel' }, other: { label: 'سایر', icon: 'receipt_long' }
  };
  var EVERY = { 1: 'ماهانه', 2: 'دوماهه', 3: 'سه‌ماهه', 6: 'شش‌ماهه', 12: 'سالانه' };
  function relDay(d) { var n = daysBetween(today(), d); return n === 0 ? 'امروز' : n === 1 ? 'فردا' : n === -1 ? 'دیروز' : n > 0 ? fa(n) + ' روز دیگر' : fa(-n) + ' روز گذشته'; }
  function fullDate(d) { return faDate(parseIso(d), { day: 'numeric', month: 'long', year: 'numeric' }); }

  /* loans */
  function loanDue(l, n) { return addMonthsIso(l.start, (n - 1) * (l.every || 1), dayOfMonth(l.start)); }
  function loanPaidCount(l) { return Object.keys(l.paid || {}).length; }
  function loanNextN(l) { for (var n = 1; n <= l.count; n++) if (!l.paid[n]) return n; return null; }
  function loanRemaining(l) { return (l.count - loanPaidCount(l)) * l.amount; }
  function loansRemaining() { return S.loans.reduce(function (s, l) { return s + loanRemaining(l); }, 0); }
  /* bills */
  function billDue(b, k) { return addMonthsIso(b.start, k * (b.every || 1), dayOfMonth(b.start)); }
  function billNext(b) { for (var k = 0; k < 600; k++) { var d = billDue(b, k); if (!b.paid[d]) return { k: k, due: d }; } return null; }
  function billAvg(b) { var v = Object.keys(b.paid).map(function (k) { return b.paid[k].amount; }).filter(function (x) { return x > 0; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : b.amount; }

  /* everything due up to N days ahead (including overdue) */
  function dueItems(days) {
    var lim = iso(addDays(new Date(), days)), out = [];
    S.loans.forEach(function (l) {
      for (var n = 1; n <= l.count; n++) { if (l.paid[n]) continue; var d = loanDue(l, n); if (d > lim) break; out.push({ kind: 'loan', ref: l, n: n, due: d, amount: l.amount, title: l.title, sub: 'قسط ' + fa(n) + ' از ' + fa(l.count) + (l.lender ? ' • ' + l.lender : ''), icon: 'event_repeat' }); }
    });
    S.bills.forEach(function (b) {
      if (b.paused) return; var overdue = 0;
      for (var k = 0; k < 600; k++) { var d = billDue(b, k); if (d > lim) break; if (b.paid[d]) continue; if (d < today() && ++overdue > 6) continue; out.push({ kind: 'bill', ref: b, due: d, amount: Math.round(billAvg(b) * 100) / 100, title: b.title, sub: (BILL_KINDS[b.kind] || BILL_KINDS.other).label + ' • ' + EVERY[b.every || 1], icon: (BILL_KINDS[b.kind] || BILL_KINDS.other).icon }); }
    });
    return out.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
  }
  function paidObligationsThisMonth() { var mk = monthKey(today()); return S.tx.filter(function (t) { return (t.loanId || t.billId) && monthKey(t.date) === mk; }); }

  /* link helpers (tx <-> installment/bill payment) */
  function unlinkTx(t) {
    if (t.loanId) { var l = S.loans.find(function (x) { return x.id === t.loanId; }); if (l && l.paid[t.loanN] && l.paid[t.loanN].txId === t.id) { var e = l.paid[t.loanN]; delete l.paid[t.loanN]; return e; } }
    if (t.billId) { var b = S.bills.find(function (x) { return x.id === t.billId; }); if (b && b.paid[t.billDue] && b.paid[t.billDue].txId === t.id) { var e2 = b.paid[t.billDue]; delete b.paid[t.billDue]; return e2; } }
    return null;
  }
  function relinkTx(t, e) {
    if (!e) return;
    if (t.loanId) { var l = S.loans.find(function (x) { return x.id === t.loanId; }); if (l) l.paid[t.loanN] = e; }
    if (t.billId) { var b = S.bills.find(function (x) { return x.id === t.billId; }); if (b) b.paid[t.billDue] = e; }
  }
  function syncLinked(t) {
    var e = t.loanId ? ((S.loans.find(function (x) { return x.id === t.loanId; }) || {}).paid || {})[t.loanN] : t.billId ? ((S.bills.find(function (x) { return x.id === t.billId; }) || {}).paid || {})[t.billDue] : null;
    if (e) { e.amount = t.amount; e.date = t.date; }
  }

  /* pay an item (installment or bill occurrence) */
  function payItem(it, done) {
    var isLoan = it.kind === 'loan', l = it.ref;
    var fields = [
      { name: 'amount', label: 'مبلغ پرداختی (' + S.profile.currency + ')', type: 'number', value: it.amount },
      { name: 'date', label: 'تاریخ پرداخت', type: 'date', value: today() }
    ];
    if (S.accounts.length > 1) fields.push({ name: 'acc', label: 'پرداخت از حساب', type: 'chips', value: l.accountId || defAcc(), options: accOptions() });
    fields.push({ name: 'record', label: 'ثبت به‌عنوان هزینه در حساب‌ها', type: 'switch', value: true });
    form({
      title: isLoan ? 'پرداخت قسط ' + fa(it.n) + ' — ' + l.title : 'پرداخت ' + l.title,
      sub: 'سررسید: ' + fullDate(it.due) + ' (' + relDay(it.due) + ')',
      fields: fields, submit: 'ثبت پرداخت',
      onSubmit: function (v) {
        var a = Math.abs(num(v.amount)); if (!a) { toast('مبلغ را وارد کنید'); return false; }
        var entry = { date: v.date || today(), amount: a, txId: null };
        if (v.record) {
          var tx = { id: uid(), type: 'expense', amount: a, date: entry.date, accountId: v.acc || l.accountId || defAcc() };
          if (isLoan) { tx.category = 'installment'; tx.note = 'قسط ' + it.n + ' از ' + l.count + ' — ' + l.title; tx.loanId = l.id; tx.loanN = it.n; }
          else { tx.category = l.kind === 'rent' ? 'bills' : 'bills'; tx.note = l.title + ' (' + faDate(parseIso(it.due), { month: 'long' }) + ')'; tx.billId = l.id; tx.billDue = it.due; }
          S.tx.push(tx); entry.txId = tx.id;
        }
        if (isLoan) l.paid[it.n] = entry; else l.paid[it.due] = entry;
        save(); refresh();
        var left = isLoan ? l.count - loanPaidCount(l) : null;
        toast(isLoan ? (left ? 'قسط ثبت شد — ' + fa(left) + ' قسط باقی‌مانده' : '🎉 همه اقساط «' + l.title + '» تسویه شد') : 'پرداخت «' + l.title + '» ثبت شد');
        if (done) done();
      }
    });
  }
  function unpay(kind, ref, key) {
    var e = ref.paid[key]; if (!e) return;
    confirmBox('لغو این پرداخت؟', e.txId ? 'تراکنش هزینه مربوط هم حذف می‌شود.' : 'وضعیت به «پرداخت‌نشده» برمی‌گردد.', 'لغو پرداخت', function () {
      delete ref.paid[key]; if (e.txId) S.tx = S.tx.filter(function (t) { return t.id !== e.txId; }); save(); refresh(); toast('پرداخت لغو شد');
    });
  }

  /* forms */
  function loanSheet(id) {
    var l = id ? S.loans.find(function (x) { return x.id === id; }) : null;
    var f = [
      { name: 'title', label: 'عنوان', value: l ? l.title : '', placeholder: 'مثلاً وام خودرو، اقساط گوشی' },
      { name: 'lender', label: 'وام‌دهنده / فروشنده', value: l ? l.lender : '', placeholder: 'اختیاری' },
      { name: 'amount', label: 'مبلغ هر قسط', type: 'number', value: l ? l.amount : '', row: 'a' },
      { name: 'count', label: 'تعداد اقساط', type: 'number', value: l ? l.count : 12, row: 'a' },
      { name: 'start', label: 'سررسید قسط اول', type: 'date', value: l ? l.start : addMonthsIso(today(), 1) },
      { name: 'every', label: 'فاصله اقساط', type: 'chips', value: String(l ? l.every || 1 : 1), options: [{ value: '1', label: 'ماهانه' }, { value: '2', label: 'دوماهه' }, { value: '3', label: 'سه‌ماهه' }] },
      { name: 'paidBefore', label: 'تعداد اقساطی که قبلاً پرداخت شده', type: 'number', value: l ? '' : 0, placeholder: l ? 'بدون تغییر' : '0' }
    ];
    if (S.accounts.length > 1) f.push({ name: 'acc', label: 'پرداخت معمولاً از حساب', type: 'chips', value: l ? l.accountId || defAcc() : defAcc(), options: accOptions() });
    f.push({ name: 'remind', label: 'یادآوری سررسید (یک روز قبل)', type: 'switch', value: l ? l.remind !== false : true });
    form({
      title: l ? 'ویرایش قسط' : 'ثبت قسط / وام جدید', sub: 'روز سررسید هر ماه بر اساس تقویم ' + (useJ() ? 'شمسی' : 'میلادی') + ' تکرار می‌شود.',
      fields: f, focus: !l,
      extra: l ? [{ label: 'حذف', cls: 'danger', run: function () { deleteLoan(l); } }] : [],
      onSubmit: function (v) {
        var title = (v.title || '').trim(), amount = num(v.amount), count = Math.round(num(v.count));
        if (!title) { toast('عنوان را وارد کنید'); return false; } if (amount <= 0) { toast('مبلغ قسط را وارد کنید'); return false; } if (count < 1 || count > 600) { toast('تعداد اقساط معتبر نیست'); return false; }
        var o = l || { id: uid(), paid: {} };
        o.title = title; o.lender = (v.lender || '').trim(); o.amount = amount; o.count = count; o.start = v.start || today(); o.every = +v.every || 1; o.accountId = v.acc || o.accountId || defAcc(); o.remind = !!v.remind;
        var pb = Math.min(count, Math.round(num(v.paidBefore)));
        if (pb > 0) for (var n = 1; n <= pb; n++) if (!o.paid[n]) o.paid[n] = { date: loanDue(o, n), amount: amount, txId: null, before: true };
        Object.keys(o.paid).forEach(function (k) { if (+k > count) delete o.paid[k]; });
        if (!l) S.loans.push(o); save(); refresh(); toast(l ? 'قسط ویرایش شد' : 'قسط «' + title + '» ثبت شد');
      }
    });
  }
  function deleteLoan(l) {
    var linked = S.tx.filter(function (t) { return t.loanId === l.id; }).length;
    confirmBox('حذف «' + l.title + '»؟', linked ? fa(linked) + ' تراکنش پرداخت‌شده در دفتر باقی می‌ماند.' : 'برنامه اقساط حذف می‌شود.', 'حذف', function () { var i = S.loans.indexOf(l); S.loans.splice(i, 1); S.tx.forEach(function (t) { if (t.loanId === l.id) { delete t.loanId; delete t.loanN; } }); save(); refresh(); toast('حذف شد'); });
  }
  function loanSchedule(l) {
    var html = '<div class="ui-stat"><div><small>پرداخت‌شده</small><b>' + fa(loanPaidCount(l)) + ' از ' + fa(l.count) + '</b></div><div><small>مانده بدهی</small><b class="ui-neg">' + money(loanRemaining(l), S.privacy) + '</b></div><div><small>مبلغ کل</small><b>' + money(l.amount * l.count, S.privacy) + '</b></div><div><small>آخرین سررسید</small><b>' + faDate(parseIso(loanDue(l, l.count)), { month: 'long', year: 'numeric' }) + '</b></div></div><div class="ui-list">';
    for (var n = 1; n <= l.count; n++) {
      var d = loanDue(l, n), p = l.paid[n], over = !p && d < today();
      html += '<div class="ui-item" data-n="' + n + '" style="cursor:pointer"><div class="ic" style="font-weight:800;font-size:13px">' + fa(n) + '</div><div class="grow"><div class="t">' + fullDate(d) + '</div><div class="s ' + (over ? 'ui-neg' : '') + '">' + (p ? 'پرداخت شد' + (p.before ? ' (قبل از ثبت)' : ' • ' + faDayMonth(parseIso(p.date))) : over ? 'معوق — ' + relDay(d) : relDay(d)) + '</div></div><div class="amt ' + (p ? 'ui-pos' : '') + '">' + (p ? (p.settled ? 'تسویه ✓' : '✓ ' + money(p.amount, S.privacy)) : money(l.amount, S.privacy)) + '</div></div>';
    }
    var close = infoSheet(l.title, html + '</div>', [{ label: 'ویرایش', run: function () { loanSheet(l.id); } }]);
    $$('.ui-overlay [data-n]').forEach(function (r) { r.onclick = function () { var n = +r.getAttribute('data-n'); close(); setTimeout(function () { if (l.paid[n]) unpay('loan', l, n); else payItem({ kind: 'loan', ref: l, n: n, due: loanDue(l, n), amount: l.amount }); }, 220); }; });
  }
  function loanMenu(l) {
    var nx = loanNextN(l);
    menu(l.title, [
      nx && { icon: 'payments', label: 'پرداخت قسط ' + fa(nx) + ' (' + fullDate(loanDue(l, nx)) + ')', run: function () { payItem({ kind: 'loan', ref: l, n: nx, due: loanDue(l, nx), amount: l.amount }); } },
      { icon: 'calendar_month', label: 'جدول کامل اقساط', run: function () { loanSchedule(l); } },
      nx && { icon: 'done_all', label: 'تسویه کامل (پرداخت همه اقساط باقی‌مانده)', run: function () { settleLoan(l); } },
      { icon: 'edit', label: 'ویرایش', run: function () { loanSheet(l.id); } },
      { icon: 'delete', label: 'حذف', danger: true, run: function () { deleteLoan(l); } }
    ], (l.lender ? l.lender + ' • ' : '') + 'مانده: ' + money(loanRemaining(l), S.privacy));
  }
  function settleLoan(l) {
    var rem = loanRemaining(l);
    form({ title: 'تسویه کامل ' + l.title, sub: fa(l.count - loanPaidCount(l)) + ' قسط باقی‌مانده به مبلغ ' + money(rem) + '. اگر تخفیف تسویه گرفته‌اید مبلغ را اصلاح کنید.', fields: [{ name: 'amount', label: 'مبلغ پرداختی', type: 'number', value: rem }, { name: 'date', label: 'تاریخ', type: 'date', value: today() }], submit: 'تسویه', onSubmit: function (v) {
      var a = num(v.amount); if (a <= 0) { toast('مبلغ را وارد کنید'); return false; }
      var tx = { id: uid(), type: 'expense', category: 'installment', amount: a, date: v.date || today(), note: 'تسویه کامل — ' + l.title, accountId: l.accountId || defAcc() }; S.tx.push(tx);
      for (var n = 1; n <= l.count; n++) if (!l.paid[n]) l.paid[n] = { date: tx.date, amount: 0, txId: null, settled: tx.id };
      save(); refresh(); toast('🎉 «' + l.title + '» تسویه شد');
    } });
  }
  function billSheet(id) {
    var b = id ? S.bills.find(function (x) { return x.id === id; }) : null;
    var f = [
      { name: 'kind', label: 'نوع', type: 'chips', value: b ? b.kind : 'electricity', options: Object.keys(BILL_KINDS).map(function (k) { return { value: k, label: BILL_KINDS[k].label, icon: BILL_KINDS[k].icon }; }), onChange: function (val, frm) { var t = frm.querySelector('input[name=title]'); var autoT = Object.keys(BILL_KINDS).some(function (k) { return t && t.value === 'قبض ' + BILL_KINDS[k].label; }); if (t && (!t.value || t.dataset.auto || autoT)) { t.value = 'قبض ' + BILL_KINDS[val].label; t.dataset.auto = '1'; t.dispatchEvent(new Event('input')); } } },
      { name: 'title', label: 'عنوان', value: b ? b.title : 'قبض برق' },
      { name: 'amount', label: 'مبلغ تقریبی هر دوره', type: 'number', value: b ? b.amount : '', row: 'a' },
      { name: 'start', label: 'سررسید بعدی', type: 'date', value: b ? b.start : addMonthsIso(today(), 0) , row: 'a' },
      { name: 'every', label: 'دوره پرداخت', type: 'chips', value: String(b ? b.every || 1 : 1), options: Object.keys(EVERY).map(function (k) { return { value: k, label: EVERY[k] }; }) }
    ];
    if (S.accounts.length > 1) f.push({ name: 'acc', label: 'پرداخت معمولاً از حساب', type: 'chips', value: b ? b.accountId || defAcc() : defAcc(), options: accOptions() });
    f.push({ name: 'remind', label: 'یادآوری سررسید (یک روز قبل)', type: 'switch', value: b ? b.remind !== false : true });
    form({
      title: b ? 'ویرایش قبض' : 'قبض یا پرداخت دوره‌ای جدید', sub: 'مثل برق، گاز، اینترنت، اجاره، بیمه یا اشتراک‌ها.', fields: f, focus: false,
      extra: b ? [{ label: 'حذف', cls: 'danger', run: function () { confirmBox('حذف «' + b.title + '»؟', 'تراکنش‌های پرداخت‌شده در دفتر باقی می‌مانند.', 'حذف', function () { S.bills.splice(S.bills.indexOf(b), 1); S.tx.forEach(function (t) { if (t.billId === b.id) { delete t.billId; delete t.billDue; } }); save(); refresh(); toast('حذف شد'); }); } }] : [],
      onSubmit: function (v) {
        var title = (v.title || '').trim(); if (!title) { toast('عنوان را وارد کنید'); return false; }
        var o = b || { id: uid(), paid: {} };
        var startChanged = b && b.start !== v.start;
        o.kind = v.kind; o.title = title; o.amount = num(v.amount); o.every = +v.every || 1; o.start = v.start || today(); o.accountId = v.acc || o.accountId || defAcc(); o.remind = !!v.remind;
        if (startChanged) { var keep = {}; Object.keys(o.paid).forEach(function (k) { if (k >= o.start) keep[k] = o.paid[k]; }); o.paid = keep; }
        if (!b) S.bills.push(o); save(); refresh(); toast(b ? 'قبض ویرایش شد' : '«' + title + '» ثبت شد');
      }
    });
  }
  function billMenu(b) {
    var nx = billNext(b);
    menu(b.title, [
      nx && { icon: 'payments', label: 'پرداخت دوره ' + faDate(parseIso(nx.due), { month: 'long' }) + ' (' + relDay(nx.due) + ')', run: function () { payItem({ kind: 'bill', ref: b, due: nx.due, amount: Math.round(billAvg(b) * 100) / 100 }); } },
      { icon: 'history', label: 'سابقه پرداخت‌ها', run: function () { billHistory(b); } },
      { icon: b.paused ? 'play_circle' : 'pause_circle', label: b.paused ? 'فعال‌سازی دوباره' : 'توقف موقت (مثلاً قطع اشتراک)', run: function () { b.paused = !b.paused; save(); refresh(); } },
      { icon: 'edit', label: 'ویرایش', run: function () { billSheet(b.id); } }
    ], (BILL_KINDS[b.kind] || BILL_KINDS.other).label + ' • ' + EVERY[b.every || 1] + ' • میانگین ' + money(billAvg(b), S.privacy));
  }
  function billHistory(b) {
    var keys = Object.keys(b.paid).sort().reverse();
    var html = keys.length ? '<div class="ui-list">' + keys.map(function (k) { var e = b.paid[k]; return '<div class="ui-item" data-k="' + k + '" style="cursor:pointer"><div class="grow"><div class="t">دوره ' + faDate(parseIso(k), { month: 'long', year: 'numeric' }) + '</div><div class="s">پرداخت: ' + fullDate(e.date) + (e.txId ? '' : ' • بدون ثبت هزینه') + '</div></div><div class="amt">' + money(e.amount, S.privacy) + '</div></div>'; }).join('') + '</div>' : '<div class="ui-empty">هنوز پرداختی ثبت نشده</div>';
    var close = infoSheet('سابقه ' + b.title, '<p class="ui-sub">برای لغو یک پرداخت، روی آن بزنید.</p>' + html);
    $$('.ui-overlay [data-k]').forEach(function (r) { r.onclick = function () { var k = r.getAttribute('data-k'); close(); setTimeout(function () { unpay('bill', b, k); }, 220); }; });
  }
  function accountSheet(id) {
    var a = id ? S.accounts.find(function (x) { return x.id === id; }) : null;
    form({
      title: a ? 'ویرایش حساب' : 'حساب یا کارت جدید',
      fields: [
        { name: 'name', label: 'نام', value: a ? a.name : '', placeholder: 'مثلاً کارت ملت، حساب Erste' },
        { name: 'type', label: 'نوع', type: 'chips', value: a ? a.type : 'bank', options: Object.keys(ACC_TYPES).map(function (k) { return { value: k, label: ACC_TYPES[k].label, icon: ACC_TYPES[k].icon }; }) },
        { name: 'opening', label: 'موجودی اولیه (' + S.profile.currency + ')', type: 'number', value: a ? a.opening : 0 }
      ],
      extra: a && S.accounts.length > 1 ? [{ label: 'حذف', cls: 'danger', run: function () { deleteAccount(a); } }] : [],
      onSubmit: function (v) {
        var name = (v.name || '').trim(); if (!name) { toast('نام حساب را وارد کنید'); return false; }
        var o = a || { id: uid() }; o.name = name; o.type = v.type; o.opening = num(v.opening);
        if (!a) S.accounts.push(o); save(); refresh(); toast(a ? 'حساب ویرایش شد' : 'حساب «' + name + '» اضافه شد');
      }
    });
  }
  function deleteAccount(a) {
    var used = S.tx.some(function (t) { return (t.accountId || defAcc()) === a.id || t.toAccountId === a.id; });
    if (used) { toast('این حساب تراکنش دارد؛ اول تراکنش‌ها را به حساب دیگری منتقل یا حذف کنید'); return; }
    confirmBox('حذف «' + a.name + '»؟', 'این حساب تراکنشی ندارد.', 'حذف', function () { S.accounts.splice(S.accounts.indexOf(a), 1); save(); refresh(); });
  }
  function accountMenu(a) {
    menu(a.name, [
      { icon: 'receipt_long', label: 'تراکنش‌های این حساب', run: function () { historySheet(function (t) { return (t.accountId || defAcc()) === a.id || t.toAccountId === a.id; }, 'تراکنش‌های ' + a.name); } },
      { icon: 'swap_horiz', label: 'انتقال از این حساب', run: function () { transferSheet(); } },
      { icon: 'tune', label: 'اصلاح موجودی (تطبیق با بانک)', run: function () { reconcile(a); } },
      { icon: 'edit', label: 'ویرایش', run: function () { accountSheet(a.id); } }
    ], (ACC_TYPES[a.type] || ACC_TYPES.bank).label + ' • موجودی: ' + money(accBalance(a.id), S.privacy));
  }
  function reconcile(a) {
    var cur = accBalance(a.id);
    form({ title: 'تطبیق موجودی ' + a.name, sub: 'موجودی فعلی در برنامه: ' + money(cur) + '. موجودی واقعی حساب را وارد کنید؛ اختلاف به‌صورت تراکنش «اصلاح موجودی» ثبت می‌شود.', fields: [{ name: 'real', label: 'موجودی واقعی', type: 'number', value: Math.round(cur * 100) / 100 }], submit: 'تطبیق', onSubmit: function (v) {
      var d = Math.round((num(v.real) - cur) * 100) / 100; if (!d) { toast('موجودی از قبل درست است'); return; }
      S.tx.push({ id: uid(), type: d > 0 ? 'income' : 'expense', category: 'other', amount: Math.abs(d), date: today(), note: 'اصلاح موجودی', accountId: a.id }); save(); refresh(); toast('موجودی تطبیق داده شد');
    } });
  }

  /* due reminders (once a day) */
  function dueReminder() {
    if (S.wallet.lastDueNotice === today()) return;
    var items = dueItems(1).filter(function (d) { return d.ref.remind !== false; });
    if (!items.length) return;
    var over = items.filter(function (d) { return d.due < today(); }).length;
    S.wallet.lastDueNotice = today(); save();
    setTimeout(function () { notify(over ? fa(over) + ' پرداخت معوق دارید' + (items.length > over ? ' و ' + fa(items.length - over) + ' سررسید امروز/فردا' : '') : fa(items.length) + ' سررسید قسط/قبض برای امروز یا فردا'); }, 1200);
  }

  /* ---------- wallet accounting hub: icon rows that open/close (one at a time) ---------- */
  function accountingSection(anchor, moved) {
    moved = moved || {};
    var hub = document.createElement('section'); hub.id = 'accounting'; hub.className = 'w-full flex flex-col gap-3';
    anchor.after(hub);
    var open = S.wallet.accOpen || '';   // which row is expanded ('' = none)
    var sub = S.wallet.accSub || {};                                        // expanded sub-items (loans / bills / due groups)
    var led = { month: monthKey(today()), type: 'all', acc: 'all', q: '', limit: 8 };
    var M = function (v) { return money(v, S.privacy); };
    var btn = 'neu-raised-sm rounded-xl px-3 py-1.5 text-[12px] font-bold text-chart-terracotta active:scale-95 transition-all whitespace-nowrap';
    var tile = 'neu-pressed-sm rounded-2xl p-3 flex flex-col gap-0.5';
    var stat = function (label, value, cls) { return '<div class="' + tile + '"><span class="text-[11px] text-text-muted">' + label + '</span><span class="text-[15px] font-bold ' + (cls || 'text-text-primary') + '">' + value + '</span></div>'; };
    var addBtn = function (label, act) { return '<button data-act="' + act + '" class="w-full neu-raised-sm rounded-2xl py-3 flex items-center justify-center gap-2 text-chart-terracotta font-bold text-[14px] active:scale-95 transition-all"><span class="material-symbols-outlined text-[20px]">add_circle</span>' + label + '</button>'; };
    var chev = function (on) { return '<span class="material-symbols-outlined text-[20px] text-text-muted transition-transform duration-200" style="transform:rotate(' + (on ? '-90' : '0') + 'deg)">chevron_left</span>'; };
    var SECTIONS = [
      { key: 'dues', title: 'سررسیدها', icon: 'notifications_active', color: '#DE8353' },
      { key: 'loans', title: 'اقساط و وام‌ها', icon: 'event_repeat', color: '#865228' },
      { key: 'bills', title: 'قبوض و پرداخت‌های دوره‌ای', icon: 'receipt_long', color: '#5d7a8c' },
      { key: 'accounts', title: 'حساب‌ها و کارت‌ها', icon: 'account_balance', color: '#4d7c62' },
      { key: 'ledger', title: 'دفتر تراکنش‌ها', icon: 'menu_book', color: '#6b6f9c' },
      { key: 'chart', title: 'نمودار هزینه‌ها', icon: 'bar_chart', color: '#8EAA97', node: moved.chart },
      { key: 'budget', title: 'بودجه ماهانه', icon: 'speed', color: '#c08a3e', node: moved.budget },
      { key: 'quick', title: 'ثبت سریع هزینه', icon: 'bolt', color: '#DE8353', node: moved.quick }
    ];
    // build the static frame once
    hub.innerHTML = '<div class="flex items-center justify-between px-1"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-[20px] text-chart-terracotta">account_balance</span><span class="font-title-md text-[16px] font-bold text-text-primary">حسابداری</span></div><button data-act="report" class="' + btn + ' text-text-muted flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">monitoring</span>گزارش کامل</button></div>';
    var rows = {};
    SECTIONS.forEach(function (s) {
      var card = document.createElement('div'); card.className = 'neu-raised rounded-3xl overflow-hidden'; card.setAttribute('data-sec', s.key);
      card.innerHTML = '<button data-head class="w-full flex items-center gap-3 p-3.5 text-right"><div class="w-11 h-11 rounded-2xl neu-pressed flex items-center justify-center flex-shrink-0" style="color:' + s.color + '"><span class="material-symbols-outlined text-[22px]">' + s.icon + '</span></div><div class="flex-1 min-w-0"><div class="flex items-center gap-2"><span class="text-[14px] font-bold text-text-primary">' + s.title + '</span><span data-badge></span></div><div data-sum class="text-[12px] text-text-muted truncate"></div></div><span data-chev></span></button><div data-body class="px-3.5 pb-3.5 flex flex-col gap-2.5" style="display:none"></div>';
      hub.appendChild(card);
      var body = card.querySelector('[data-body]');
      if (s.node) { s.node.className = 'w-full flex flex-col gap-3'; s.node.removeAttribute('data-click'); body.appendChild(s.node); }
      card.querySelector('[data-head]').onclick = function () { open = open === s.key ? '' : s.key; S.wallet.accOpen = open; save(); render(); if (open) setTimeout(function () { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.scrollBy(0, -80); }, 30); };
      rows[s.key] = { card: card, body: body, sum: card.querySelector('[data-sum]'), badge: card.querySelector('[data-badge]'), chev: card.querySelector('[data-chev]'), s: s };
    });
    hub.querySelector('[data-act=report]').onclick = reportSheet;
    function badge(n, red) { return n ? '<span class="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ' + (red ? 'bg-chart-terracotta text-white' : 'bg-chart-sage/30 text-text-primary') + '">' + fa(n) + '</span>' : ''; }
    function subToggle(id) { sub[id] = !sub[id]; S.wallet.accSub = sub; save(); render(); }
    function group(id, title, count, total, inner, defOpen, red) {
      var on = sub[id] === undefined ? defOpen : sub[id];
      return '<div class="neu-pressed-sm rounded-2xl overflow-hidden"><button data-sub="' + id + '" data-def="' + (defOpen ? 1 : 0) + '" class="w-full flex items-center justify-between px-3 py-2.5"><span class="flex items-center gap-2 text-[13px] font-bold ' + (red ? 'text-chart-terracotta' : 'text-text-primary') + '">' + title + badge(count, red) + '</span><span class="flex items-center gap-1 text-[12px] font-bold text-text-muted">' + M(total) + chev(on) + '</span></button>' + (on ? '<div class="flex flex-col gap-2 px-2 pb-2">' + inner + '</div>' : '') + '</div>';
    }
    var dueCache = [];
    function dueLine(d) {
      var i = dueCache.push(d) - 1, over = d.due < today();
      return '<div class="flex items-center gap-2.5 p-2.5 rounded-2xl neu-raised-sm"><span class="material-symbols-outlined text-[20px] ' + (over ? 'text-chart-terracotta' : 'text-text-muted') + '">' + d.icon + '</span><div class="flex-1 min-w-0"><div class="text-[13px] font-bold text-text-primary truncate">' + esc(d.title) + '</div><div class="text-[11px] ' + (over ? 'text-chart-terracotta font-bold' : 'text-text-muted') + ' truncate">' + relDay(d.due) + ' • ' + esc(d.sub) + '</div></div><span class="text-[13px] font-bold text-text-primary" dir="ltr">' + M(d.amount) + '</span><button data-pay="' + i + '" class="' + btn + '">پرداخت</button></div>';
    }
    function render() {
      dueCache = [];
      var items = dueItems(60), t0 = today();
      var over = items.filter(function (d) { return d.due < t0; });
      var week = items.filter(function (d) { return d.due >= t0 && daysBetween(t0, d.due) <= 7; });
      var month = items.filter(function (d) { return daysBetween(t0, d.due) > 7 && daysBetween(t0, d.due) <= 30; });
      var later = items.filter(function (d) { return daysBetween(t0, d.due) > 30; });
      var sum = function (l) { return l.reduce(function (s, d) { return s + d.amount; }, 0); };
      var activeBills = S.bills.filter(function (b) { return !b.paused; });
      var billMonthly = activeBills.reduce(function (s, b) { return s + billAvg(b) / (b.every || 1); }, 0);
      var openLoans = S.loans.filter(function (l) { return loanNextN(l); });
      var inc = monthSum('income'), exp = monthSum('expense'), used = S.wallet.budget ? Math.round(exp / S.wallet.budget * 100) : 0;
      // header summaries (always visible)
      var R = rows;
      R.dues.sum.textContent = over.length ? fa(over.length) + ' معوق • ' + fa(week.length) + ' مورد تا ۷ روز آینده' : week.length ? fa(week.length) + ' پرداخت تا ۷ روز آینده • ' + M(sum(week)) : 'هفته آینده سررسیدی ندارید ✓';
      R.dues.badge.innerHTML = badge(over.length || week.length, !!over.length);
      R.loans.sum.textContent = openLoans.length ? fa(openLoans.length) + ' وام فعال • مانده ' + M(loansRemaining()) : 'وام یا قسط فعالی ندارید';
      R.bills.sum.textContent = activeBills.length ? fa(activeBills.length) + ' قبض فعال • حدود ' + M(billMonthly) + ' در ماه' : 'قبضی ثبت نشده';
      R.accounts.sum.textContent = fa(S.accounts.length) + ' حساب • موجودی ' + M(balance());
      R.ledger.sum.textContent = monthLabel(monthKey(t0)) + ': +' + M(inc) + ' / −' + M(exp);
      R.chart.sum.textContent = 'هزینه امروز ' + M(daySpend(t0)) + ' • این ماه ' + M(exp);
      R.budget.sum.textContent = fa(used) + '٪ مصرف شده • باقی ' + M(Math.max(0, S.wallet.budget - exp));
      R.budget.badge.innerHTML = used >= 80 ? badge(used + '٪', true) : '';
      var qs = QUICK_SETS[S.wallet.quickSet] || QUICK_SETS[0]; R.quick.sum.textContent = qs.map(function (k) { return TXCAT[k].label; }).join('، ');
      SECTIONS.forEach(function (s) { var r = R[s.key], on = open === s.key; r.chev.innerHTML = chev(on); r.body.style.display = on ? '' : 'none'; r.card.classList.toggle('ring-1', on); r.card.classList.toggle('ring-chart-terracotta/30', on); });
      // dynamic bodies (only the open one is built)
      var b = '';
      if (open === 'dues') {
        b += '<div class="grid grid-cols-2 gap-2">' + stat('پرداختنی ۳۰ روز', M(sum(week) + sum(month))) + stat('مانده بدهی اقساط', M(loansRemaining()), 'text-chart-terracotta') + '</div>';
        if (over.length) b += group('g-over', 'معوق', over.length, sum(over), over.map(dueLine).join(''), true, true);
        b += group('g-week', 'تا ۷ روز آینده', week.length, sum(week), week.map(dueLine).join('') || '<div class="text-center text-text-muted text-[12px] py-2">موردی نیست</div>', true);
        b += group('g-month', 'تا ۳۰ روز آینده', month.length, sum(month), month.map(dueLine).join('') || '<div class="text-center text-text-muted text-[12px] py-2">موردی نیست</div>', false);
        if (later.length) b += group('g-later', 'بعدتر (تا ۶۰ روز)', later.length, sum(later), later.map(dueLine).join(''), false);
        R.dues.body.innerHTML = b;
      } else if (open === 'loans') {
        b += '<div class="grid grid-cols-2 gap-2">' + stat('مانده کل بدهی', M(loansRemaining()), 'text-chart-terracotta') + stat('قسط‌های این ماه', M(S.loans.reduce(function (s, l) { var n = loanNextN(l); return s + (n && monthKey(loanDue(l, n)) <= monthKey(t0) ? l.amount : 0); }, 0))) + '</div>';
        b += S.loans.map(function (l) {
          var id = 'l-' + l.id, on = !!sub[id], pc = loanPaidCount(l), nx = loanNextN(l), pct = Math.round(pc / l.count * 100), nd = nx && loanDue(l, nx), ov = nd && nd < t0;
          var head = '<button data-sub="' + id + '" class="w-full flex items-center gap-2.5 px-3 py-2.5 text-right"><div class="relative w-9 h-9 flex-shrink-0"><svg viewBox="0 0 36 36" class="w-9 h-9 -rotate-90"><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" class="text-text-muted/20"></circle><circle cx="18" cy="18" r="15" fill="none" stroke="#8EAA97" stroke-width="4" stroke-linecap="round" stroke-dasharray="94.2" stroke-dashoffset="' + (94.2 - pct / 100 * 94.2) + '"></circle></svg><span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-text-primary">' + fa(pct) + '٪</span></div><div class="flex-1 min-w-0"><div class="text-[13px] font-bold text-text-primary truncate">' + esc(l.title) + '</div><div class="text-[11px] truncate ' + (ov ? 'text-chart-terracotta font-bold' : 'text-text-muted') + '">' + (nx ? 'قسط ' + fa(nx) + ' • ' + relDay(nd) : 'تسویه شد ✓') + '</div></div><span class="text-[12px] font-bold text-text-primary" dir="ltr">' + M(loanRemaining(l)) + '</span>' + chev(on) + '</button>';
          var det = on ? '<div class="flex flex-col gap-2 px-3 pb-3"><div class="grid grid-cols-2 gap-2">' + stat('هر قسط', M(l.amount)) + stat('پرداخت‌شده', fa(pc) + ' از ' + fa(l.count)) + stat('قسط بعدی', nx ? faDayMonth(parseIso(nd)) : '—', ov ? 'text-chart-terracotta' : '') + stat('وام‌دهنده', esc(l.lender || '—')) + '</div><div class="grid grid-cols-3 gap-2">' + (nx ? '<button data-payloan="' + l.id + '" class="' + btn + ' py-2.5">پرداخت قسط</button>' : '<span></span>') + '<button data-loansch="' + l.id + '" class="' + btn + ' py-2.5 text-text-primary">جدول اقساط</button><button data-loanmenu="' + l.id + '" class="' + btn + ' py-2.5 text-text-muted">بیشتر…</button></div></div>' : '';
          return '<div class="neu-pressed-sm rounded-2xl overflow-hidden">' + head + det + '</div>';
        }).join('') || '<div class="text-center text-text-muted text-[13px] py-2">هنوز قسطی ثبت نشده</div>';
        R.loans.body.innerHTML = b + addBtn('ثبت قسط / وام جدید', 'loan');
      } else if (open === 'bills') {
        b += S.bills.map(function (bl) {
          var id = 'b-' + bl.id, on = !!sub[id], k = BILL_KINDS[bl.kind] || BILL_KINDS.other, nx = billNext(bl), ov = nx && nx.due < t0 && !bl.paused;
          var keys = Object.keys(bl.paid).sort().reverse().slice(0, 4);
          var head = '<button data-sub="' + id + '" class="w-full flex items-center gap-2.5 px-3 py-2.5 text-right' + (bl.paused ? ' opacity-50' : '') + '"><span class="material-symbols-outlined text-[20px] ' + (ov ? 'text-chart-terracotta' : 'text-text-muted') + '">' + k.icon + '</span><div class="flex-1 min-w-0"><div class="text-[13px] font-bold text-text-primary truncate">' + esc(bl.title) + '</div><div class="text-[11px] truncate ' + (ov ? 'text-chart-terracotta font-bold' : 'text-text-muted') + '">' + (bl.paused ? 'متوقف' : (ov ? 'معوق • ' : '') + relDay(nx.due)) + ' • ' + EVERY[bl.every || 1] + '</div></div><span class="text-[12px] font-bold text-text-primary" dir="ltr">' + M(billAvg(bl)) + '</span>' + chev(on) + '</button>';
          var det = on ? '<div class="flex flex-col gap-2 px-3 pb-3">' + (keys.length ? '<div class="text-[11px] font-bold text-text-muted">آخرین پرداخت‌ها</div>' + keys.map(function (kk) { var e = bl.paid[kk]; return '<div class="flex justify-between text-[12px] text-text-primary"><span>' + faDate(parseIso(kk), { month: 'long', year: 'numeric' }) + '</span><b dir="ltr">' + M(e.amount) + '</b></div>'; }).join('') : '<div class="text-[12px] text-text-muted">هنوز پرداختی ثبت نشده</div>') + '<div class="grid grid-cols-3 gap-2 mt-1">' + (bl.paused ? '<span></span>' : '<button data-paybill="' + bl.id + '" class="' + btn + ' py-2.5">پرداخت</button>') + '<button data-billhist="' + bl.id + '" class="' + btn + ' py-2.5 text-text-primary">سابقه</button><button data-billmenu="' + bl.id + '" class="' + btn + ' py-2.5 text-text-muted">بیشتر…</button></div></div>' : '';
          return '<div class="neu-pressed-sm rounded-2xl overflow-hidden">' + head + det + '</div>';
        }).join('') || '<div class="text-center text-text-muted text-[13px] py-2">هنوز قبضی ثبت نشده</div>';
        R.bills.body.innerHTML = '<div class="grid grid-cols-2 gap-2">' + stat('میانگین ماهانه', M(billMonthly)) + stat('پرداخت‌شده این ماه', M(paidObligationsThisMonth().filter(function (t) { return t.billId; }).reduce(function (s, t) { return s + t.amount; }, 0)), 'text-chart-sage') + '</div>' + b + addBtn('قبض یا پرداخت دوره‌ای جدید', 'bill');
      } else if (open === 'accounts') {
        var debt = loansRemaining();
        b += '<div class="grid grid-cols-2 gap-2">' + stat('مجموع موجودی', M(balance())) + stat('دارایی خالص', M(balance() - debt), balance() - debt >= 0 ? 'text-chart-sage' : 'text-chart-terracotta') + '</div>';
        b += S.accounts.map(function (a) { var t = ACC_TYPES[a.type] || ACC_TYPES.bank, bal = accBalance(a.id); return '<button data-accid="' + a.id + '" class="w-full flex items-center gap-2.5 p-3 rounded-2xl neu-pressed-sm text-right"><span class="material-symbols-outlined text-[20px] text-text-muted">' + t.icon + '</span><div class="flex-1 min-w-0"><div class="text-[13px] font-bold text-text-primary truncate">' + esc(a.name) + '</div><div class="text-[11px] text-text-muted">' + t.label + '</div></div><span class="text-[14px] font-bold ' + (bal < 0 ? 'text-chart-terracotta' : 'text-text-primary') + '" dir="ltr">' + M(bal) + '</span><span class="material-symbols-outlined text-[18px] text-text-muted">more_vert</span></button>'; }).join('');
        b += '<div class="grid grid-cols-2 gap-2"><button data-act="transfer" class="neu-raised-sm rounded-2xl py-3 flex items-center justify-center gap-1.5 text-text-primary font-bold text-[13px]"><span class="material-symbols-outlined text-[18px]">swap_horiz</span>انتقال</button><button data-act="account" class="neu-raised-sm rounded-2xl py-3 flex items-center justify-center gap-1.5 text-chart-terracotta font-bold text-[13px]"><span class="material-symbols-outlined text-[18px]">add_circle</span>حساب جدید</button></div>';
        R.accounts.body.innerHTML = b;
      } else if (open === 'ledger') {
        var list = S.tx.filter(function (t) {
          if (monthKey(t.date) !== led.month) return false;
          if (led.type !== 'all' && t.type !== led.type) return false;
          if (led.acc !== 'all' && (t.accountId || defAcc()) !== led.acc && t.toAccountId !== led.acc) return false;
          if (led.q && ((t.note || '') + ' ' + txLabel(t)).indexOf(led.q) < 0) return false;
          return true;
        }).sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : 0; });
        var li = list.filter(function (t) { return t.type === 'income'; }).reduce(function (s, t) { return s + t.amount; }, 0), le = list.filter(function (t) { return t.type === 'expense'; }).reduce(function (s, t) { return s + t.amount; }, 0);
        b += '<div class="flex items-center justify-between"><button data-mon="-1" class="w-9 h-9 rounded-full neu-raised-sm flex items-center justify-center text-text-muted"><span class="material-symbols-outlined">chevron_right</span></button><span class="text-[14px] font-bold text-text-primary">' + monthLabel(led.month) + '</span><button data-mon="1" class="w-9 h-9 rounded-full neu-raised-sm flex items-center justify-center text-text-muted"><span class="material-symbols-outlined">chevron_left</span></button></div>';
        b += '<div class="grid grid-cols-3 gap-2">' + stat('درآمد', M(li), 'text-chart-sage') + stat('هزینه', M(le), 'text-chart-terracotta') + stat('خالص', M(li - le)) + '</div>';
        var fOn = !!sub['ledger-f'] || led.type !== 'all' || led.acc !== 'all' || !!led.q;
        b += '<div class="neu-pressed-sm rounded-2xl overflow-hidden"><button data-sub="ledger-f" class="w-full flex items-center justify-between px-3 py-2.5"><span class="flex items-center gap-1.5 text-[13px] font-bold text-text-primary"><span class="material-symbols-outlined text-[18px]">filter_list</span>فیلتر و جستجو' + (led.type !== 'all' || led.acc !== 'all' || led.q ? ' <span class="text-chart-terracotta">(فعال)</span>' : '') + '</span>' + chev(fOn) + '</button>' + (fOn ? '<div class="flex flex-col gap-2 px-3 pb-3"><div class="flex gap-1.5 flex-wrap">' + [['all', 'همه'], ['expense', 'هزینه'], ['income', 'درآمد'], ['transfer', 'انتقال']].map(function (x) { return '<button data-ltype="' + x[0] + '" class="px-3 py-1.5 rounded-full text-[12px] font-bold ' + (led.type === x[0] ? 'neu-pressed text-chart-terracotta' : 'neu-raised-sm text-text-muted') + '">' + x[1] + '</button>'; }).join('') + (S.accounts.length > 1 ? '<select data-lacc class="px-2 py-1.5 rounded-full text-[12px] font-bold neu-raised-sm text-text-muted border-0 outline-none" style="background:transparent"><option value="all">همه حساب‌ها</option>' + S.accounts.map(function (a) { return '<option value="' + a.id + '"' + (led.acc === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>' : '') + '</div><input data-lq placeholder="جستجو در توضیحات…" class="w-full neu-raised-sm rounded-2xl px-4 py-2.5 text-[13px] outline-none border-0 text-text-primary" style="background:transparent" value="' + esc(led.q) + '"></div>' : '') + '</div>';
        b += list.slice(0, led.limit).map(function (t) {
          var c = TXCAT[t.category] || TXCAT.other, sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '⇄ ', col = t.type === 'income' ? 'text-chart-sage' : t.type === 'expense' ? 'text-chart-terracotta' : 'text-text-muted';
          return '<button data-ltx="' + t.id + '" class="w-full flex items-center gap-2.5 p-2.5 rounded-2xl neu-pressed-sm text-right"><span class="material-symbols-outlined text-[18px] text-text-muted">' + (t.type === 'transfer' ? 'swap_horiz' : c.icon) + '</span><div class="flex-1 min-w-0"><div class="text-[13px] font-bold text-text-primary truncate">' + esc(t.note || c.label) + '</div><div class="text-[11px] text-text-muted truncate">' + esc(txLabel(t)) + ' • ' + faDayMonth(parseIso(t.date)) + '</div></div><span class="text-[13px] font-bold ' + col + '" dir="ltr">' + sign + M(t.amount) + '</span></button>';
        }).join('') || '<div class="text-center text-text-muted text-[13px] py-3">تراکنشی با این فیلتر نیست</div>';
        if (list.length > led.limit) b += '<button data-more class="w-full text-center text-[13px] font-bold text-chart-terracotta py-2">نمایش ' + fa(Math.min(10, list.length - led.limit)) + ' مورد دیگر (از ' + fa(list.length - led.limit) + ')</button>';
        b += '<div class="grid grid-cols-2 gap-2"><button data-act="new" class="neu-raised-sm rounded-2xl py-3 flex items-center justify-center gap-1.5 text-chart-terracotta font-bold text-[13px]"><span class="material-symbols-outlined text-[18px]">add_circle</span>ثبت جدید</button><button data-act="csv" class="neu-raised-sm rounded-2xl py-3 flex items-center justify-center gap-1.5 text-text-primary font-bold text-[13px]"><span class="material-symbols-outlined text-[18px]">download</span>خروجی اکسل</button></div>';
        R.ledger.body.innerHTML = b; hub._ledgerList = list;
      }
      wire();
    }
    function wire() {
      var findL = function (id) { return S.loans.find(function (x) { return x.id === id; }); }, findB = function (id) { return S.bills.find(function (x) { return x.id === id; }); };
      var on = function (sel, fn) { $$(sel, hub).forEach(function (el) { el.onclick = function (e) { e.stopPropagation(); fn(el, e); }; }); };
      on('[data-sub]', function (el) { var id = el.getAttribute('data-sub'); if (sub[id] === undefined && el.hasAttribute('data-def')) sub[id] = el.getAttribute('data-def') === '1'; subToggle(id); });
      on('[data-pay]', function (el) { payItem(dueCache[+el.getAttribute('data-pay')]); });
      on('[data-payloan]', function (el) { var l = findL(el.getAttribute('data-payloan')), n = loanNextN(l); payItem({ kind: 'loan', ref: l, n: n, due: loanDue(l, n), amount: l.amount }); });
      on('[data-loansch]', function (el) { loanSchedule(findL(el.getAttribute('data-loansch'))); });
      on('[data-loanmenu]', function (el) { loanMenu(findL(el.getAttribute('data-loanmenu'))); });
      on('[data-paybill]', function (el) { var bl = findB(el.getAttribute('data-paybill')), nx = billNext(bl); payItem({ kind: 'bill', ref: bl, due: nx.due, amount: Math.round(billAvg(bl) * 100) / 100 }); });
      on('[data-billhist]', function (el) { billHistory(findB(el.getAttribute('data-billhist'))); });
      on('[data-billmenu]', function (el) { billMenu(findB(el.getAttribute('data-billmenu'))); });
      on('[data-accid]', function (el) { accountMenu(S.accounts.find(function (x) { return x.id === el.getAttribute('data-accid'); })); });
      on('[data-ltx]', function (el) { txSheet(null, null, el.getAttribute('data-ltx')); });
      on('[data-mon]', function (el) { led.month = shiftMonthKey(led.month, +el.getAttribute('data-mon')); led.limit = 8; render(); });
      on('[data-ltype]', function (el) { led.type = el.getAttribute('data-ltype'); render(); });
      on('[data-more]', function () { led.limit += 10; render(); });
      var accSel = $('[data-lacc]', hub); if (accSel) { accSel.onclick = function (e) { e.stopPropagation(); }; accSel.onchange = function () { led.acc = accSel.value; render(); }; }
      var q = $('[data-lq]', hub); if (q) { q.onclick = function (e) { e.stopPropagation(); }; q.oninput = function () { led.q = q.value.trim(); clearTimeout(q._t); q._t = setTimeout(function () { var pos = q.selectionStart; render(); var nq = $('[data-lq]', hub); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) { } } }, 400); }; }
      on('[data-body] [data-act]', function (el) {
        var a = el.getAttribute('data-act');
        if (a === 'loan') loanSheet(); else if (a === 'bill') billSheet(); else if (a === 'account') accountSheet(); else if (a === 'transfer') transferSheet(); else if (a === 'new') newTxMenu();
        else if (a === 'csv') exportCsv(hub._ledgerList || [], led.month);
      });
    }
    return render;
  }

  /* tasks */
  var PRIO = { high: { label: 'بالا', color: '#DE8353', rank: 0, icon: 'keyboard_double_arrow_up' }, med: { label: 'متوسط', color: '#c08a3e', rank: 1, icon: 'drag_handle' }, low: { label: 'پایین', color: '#8EAA97', rank: 2, icon: 'keyboard_double_arrow_down' } };
  var REPEAT = { none: 'بدون تکرار', daily: 'هر روز', weekly: 'هر هفته', monthly: 'هر ماه' };
  function nextRepeatDate(t) { var d = t.date || today(); return t.repeat === 'daily' ? iso(addDays(parseIso(d), 1)) : t.repeat === 'weekly' ? iso(addDays(parseIso(d), 7)) : t.repeat === 'monthly' ? addMonthsIso(d, 1) : null; }
  function taskSheet(id, presetDate, presetTitle) {
    var t = id ? S.tasks.find(function (x) { return x.id === id; }) : null;
    form({
      title: t ? 'ویرایش کار' : 'کار جدید',
      fields: [
        { name: 'title', label: 'عنوان', value: t ? t.title : (presetTitle || ''), placeholder: 'مثلاً تماس با حسابدار' },
        { name: 'date', label: 'تاریخ', type: 'date', value: t ? t.date : (presetDate || today()), row: 'a' },
        { name: 'time', label: 'ساعت', type: 'time', value: t ? t.time : '', row: 'a' },
        { name: 'priority', label: 'اولویت', type: 'chips', value: t ? t.priority || 'med' : 'med', options: Object.keys(PRIO).map(function (k) { return { value: k, label: PRIO[k].label, icon: PRIO[k].icon }; }) },
        { name: 'category', label: 'دسته / پروژه', type: 'chips', value: t ? t.category : 'work', options: Object.keys(CAT).map(function (k) { return { value: k, label: CAT[k].label }; }) },
        { name: 'repeat', label: 'تکرار', type: 'chips', value: t ? t.repeat || 'none' : 'none', options: Object.keys(REPEAT).map(function (k) { return { value: k, label: REPEAT[k] }; }) },
        { name: 'subs', label: 'زیرکارها (هر خط یک مورد)', type: 'textarea', value: t && t.subtasks ? t.subtasks.map(function (s) { return s.title; }).join('\n') : '', placeholder: 'اختیاری' },
        { name: 'note', label: 'یادداشت', value: t ? t.note : '', placeholder: 'اختیاری' },
        { name: 'starred', label: 'مهم ⭐', type: 'switch', value: t ? t.starred : false },
        { name: 'reminder', label: 'یادآوری در زمان تعیین‌شده', type: 'switch', value: t ? t.reminder : false }
      ],
      focus: !t,
      extra: t ? [{ label: 'حذف', cls: 'danger', run: function () { removeTask(t.id); } }] : [],
      onSubmit: function (v) {
        var title = (v.title || '').trim(); if (!title) { toast('عنوان را وارد کنید'); return false; }
        if (v.reminder && !v.time) { toast('برای یادآوری، ساعت را مشخص کنید'); return false; }
        var o = t || { id: uid(), done: false, archived: false, createdAt: today() };
        var old = {}; (o.subtasks || []).forEach(function (s) { old[s.title] = s; });
        o.title = title; o.date = v.date || today(); o.time = v.time || ''; o.category = v.category; o.priority = v.priority || 'med'; o.repeat = v.repeat || 'none';
        o.subtasks = String(v.subs || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { return old[x] || { id: uid(), title: x, done: false }; });
        o.note = (v.note || '').trim(); o.starred = !!v.starred; o.reminder = !!v.reminder; o.notified = false;
        if (!t) S.tasks.push(o);
        save(); refresh(); toast(t ? 'کار ویرایش شد' : 'کار اضافه شد');
        if (o.reminder) askNotif();
      }
    });
  }
  function removeTask(id) {
    var i = S.tasks.findIndex(function (x) { return x.id === id; }); if (i < 0) return;
    var old = S.tasks.splice(i, 1)[0]; save(); refresh();
    toast('کار حذف شد', { label: 'واگرد', run: function () { S.tasks.splice(i, 0, old); save(); refresh(); } });
  }
  function toggleTask(id) {
    var t = S.tasks.find(function (x) { return x.id === id; }); if (!t) return;
    t.done = !t.done; t.doneAt = t.done ? today() : null;
    var spawned = null;
    if (t.done && t.repeat && t.repeat !== 'none' && !t.spawnedNext) {
      spawned = JSON.parse(JSON.stringify(t)); spawned.id = uid(); spawned.done = false; spawned.doneAt = null; spawned.notified = false; spawned.spawnedNext = false; spawned.date = nextRepeatDate(t);
      (spawned.subtasks || []).forEach(function (s) { s.done = false; s.id = uid(); });
      S.tasks.push(spawned); t.spawnedNext = spawned.id;
    }
    save(); refresh();
    if (t.done) toast('آفرین! «' + t.title + '» انجام شد' + (spawned ? ' — تکرار بعدی: ' + faDayMonth(parseIso(spawned.date)) : ''));
  }
  function sortTasks(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var pa = (PRIO[a.priority] || PRIO.med).rank, pb = (PRIO[b.priority] || PRIO.med).rank; if (pa !== pb) return pa - pb;
    return (a.time || '99') < (b.time || '99') ? -1 : 1;
  }

  /* gym helpers */
  function session(date, create) {
    date = date || today();
    var s = S.gym.sessions[date];
    if (!s && create) { var p = S.gym.weekly[parseIso(date).getDay()]; s = S.gym.sessions[date] = { name: p ? p.name : 'جلسه تمرین', minutes: 0, target: 45, finished: false, exercises: [] }; }
    return s;
  }
  function setsOf(s) { var tot = 0, done = 0; (s ? s.exercises : []).forEach(function (e) { tot += +e.sets || 0; done += Math.min(+e.done || 0, +e.sets || 0); }); return { tot: tot, done: done }; }
  function streak() {
    var n = 0, d = new Date(); var active = function (k) { var s = S.gym.sessions[k]; return s && (s.finished || setsOf(s).done > 0); };
    if (!active(iso(d))) d = addDays(d, -1);
    while (active(iso(d))) { n++; d = addDays(d, -1); }
    return n;
  }
  function sessionMinutes(s) { if (!s) return 0; var m = s.minutes || 0; if (S.gym.timerStart && s === S.gym.sessions[today()]) m += (Date.now() - S.gym.timerStart) / 60000; return Math.round(m); }
  function mealsToday() { return S.gym.meals[today()] || []; }
  function sumMeals(list) { return list.reduce(function (o, m) { o.kcal += +m.kcal || 0; o.p += +m.p || 0; o.c += +m.c || 0; o.f += +m.f || 0; return o; }, { kcal: 0, p: 0, c: 0, f: 0 }); }
  function lastWeight() { var w = S.gym.weights.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }); return w[w.length - 1]; }
  function weightOn(date) { var w = S.gym.weights.filter(function (x) { return x.date <= date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); return w.length ? w[w.length - 1].kg : null; }

  /* ---------------- reminders (while the app is open) ---------------- */
  function notify(msg) { toast('⏰ ' + msg); try { if (notifAllowed()) new Notification('Daily Order', { body: msg }); } catch (e) { } }
  function checkReminders() {
    try { dueReminder(); } catch (e) { }
    var d = today(), m = hmToMin(nowHM()), changed = false;
    S.tasks.forEach(function (t) { if (t.reminder && !t.done && !t.notified && t.date === d && t.time && hmToMin(t.time) <= m && m - hmToMin(t.time) < 30) { t.notified = true; changed = true; notify('یادآوری: ' + t.title); } });
    S.blocks.forEach(function (b) { if (b.notify && !b.done && !b.notified && b.date === d && hmToMin(b.start) <= m && m - hmToMin(b.start) < 30) { b.notified = true; changed = true; notify('شروع بلوک: ' + b.title + ' (' + b.start + ')'); } });
    if (changed) save();
  }

  /* ---------------- page modules ---------------- */
  var renderers = [];
  function refresh() { renderers.forEach(function (r) { try { r(); } catch (e) { console.error(e); } }); }
  var P = {};

  /* ===== Dashboard ===== */
  P.dashboard = function () {
    var dateSpan = byText('main span', 'امروز،'); var clock = $('#liveClock');
    onTap($('#calendarBtn'), function () { go('planner-calendar'); });
    var clockIcon = byText('main .material-symbols-outlined', 'schedule'); if (clockIcon) onTap(clockIcon.parentElement, function () { go('planner-calendar'); });
    // tasks card
    var tCard = byText('h2', 'وظایف نزدیک').closest('.clay-outset');
    var zen = $('#zenIcon').closest('.flex.flex-col.items-center');
    var list = document.createElement('div'); list.className = 'flex flex-col gap-2 my-3'; zen.parentElement.insertBefore(list, zen);
    var filterBtn = $('#taskFilterBtn'); var modes = ['همه', 'امروز', 'مهم']; var mode = 0;
    onTap(filterBtn, function () { mode = (mode + 1) % 3; render(); toast('نمایش: ' + modes[mode]); });
    onTap(zen, function () { go('tasks-habits'); });
    var pill = byText('span', '۳ / ۳', tCard); var pillBox = pill && pill.closest('.w-full'); if (pillBox) onTap(pillBox, function () { go('tasks-habits'); });
    // finance card
    var fCard = byText('h2', 'وضعیت مالی').closest('.clay-outset');
    var bars = $$('[onclick^="highlightBar"]', fCard); var spendEl = $('#activeSpendDisplay');
    var budgetEl = byText('span', 'بودجه باقی', fCard).nextElementSibling;
    var spendLabel = byText('span', 'هزینه امروز', fCard);
    onTap($('#reportBtn'), reportSheet);
    onTap(budgetEl.parentElement, budgetSheet);
    bars.forEach(function (b, i) { onTap(b, function () { var d = iso(addDays(new Date(), i - 6)); spendEl.textContent = money(daySpend(d), S.privacy); spendLabel.textContent = i === 6 ? 'هزینه امروز' : 'هزینه ' + faDayMonth(parseIso(d)); }); });
    // gym card
    var gCard = byText('h2', 'وضعیت باشگاه').closest('.clay-outset');
    var streakEl = byText('span', 'روز پیاپی', gCard); var ringTxt = byText('span', '75%', gCard);
    var minEl = byText('span', 'زمان تمرین', gCard).nextElementSibling.firstElementChild; var setEl = byText('span', 'ست‌های روز', gCard).nextElementSibling.firstElementChild;
    var sBtn = $('button[aria-label="ثبت تمرین امروز"]', gCard); var sName = byText('span', 'جلسه فعال', sBtn); var sAct = byText('span', 'ثبت پایان', sBtn); var sDot = sBtn.querySelector('.rounded-full');
    var ringWell = ringTxt.closest('.w-20');
    onTap(ringWell, function () { go('gym'); }); onTap(streakEl.parentElement, function () { go('gym'); });
    onTap(sBtn, function () {
      var s = session(today());
      if (!s || !s.exercises.length) { go('gym'); return; }
      if (s.finished) { s.finished = false; save(); refresh(); toast('جلسه دوباره باز شد'); return; }
      confirmBox('پایان جلسه امروز؟', 'ست‌های انجام‌شده: ' + fa(setsOf(s).done) + ' از ' + fa(setsOf(s).tot), 'ثبت پایان', function () { finishSession(); });
    });
    function render() {
      var now = new Date();
      if (dateSpan) dateSpan.textContent = 'امروز، ' + faDayMonth(now);
      // tasks
      var all = S.tasks.filter(function (t) { return !t.archived; });
      var todays = all.filter(function (t) { return t.date === today(); });
      var pool = mode === 1 ? todays : mode === 2 ? all.filter(function (t) { return t.starred; }) : all.filter(function (t) { return t.date >= today() || !t.done; });
      var open = pool.filter(function (t) { return !t.done; }).sort(sortTasks).slice(0, 3);
      filterBtn.textContent = modes[mode];
      list.innerHTML = '';
      open.forEach(function (t) {
        var r = document.createElement('div'); r.className = 'flex items-center gap-2 bg-surface-subtle rounded-2xl px-2.5 py-2 shadow-[inset_1px_1px_3px_rgba(180,172,160,0.35),inset_-1px_-1px_3px_#ffffff]';
        r.innerHTML = '<button class="w-6 h-6 flex-none rounded-full bg-surface-bright clay-outset flex items-center justify-center text-text-muted" aria-label="انجام شد"><span class="material-symbols-outlined text-[14px] opacity-30">check</span></button><div class="flex flex-col min-w-0"><span class="font-label-md text-[12px] text-text-primary truncate"></span><span class="font-label-sm text-[10px] text-text-muted"></span></div>';
        r.querySelector('span.truncate').textContent = t.title;
        r.querySelector('.text-\\[10px\\]').textContent = (t.date === today() ? 'امروز' : faDayMonth(parseIso(t.date))) + (t.time ? ' • ' + fa(t.time) : '');
        onTap(r.firstChild, function () { toggleTask(t.id); });
        onTap(r.lastChild, function () { taskSheet(t.id); });
        list.appendChild(r);
      });
      zen.style.display = open.length ? 'none' : '';
      var zp = zen.querySelectorAll('p');
      if (!open.length) { zp[0].textContent = pool.length ? 'همه‌چیز مرتب است!' : 'کاری ثبت نشده'; zp[1].textContent = pool.length ? 'کارهای این بخش تکمیل شده‌اند.' : 'برای افزودن کار، اینجا را بزنید.'; }
      var dn = todays.filter(function (t) { return t.done; }).length;
      if (pill) pill.textContent = fa(dn) + '/' + fa(todays.length);
      // finance
      var vals = []; for (var i = 6; i >= 0; i--) vals.push(daySpend(iso(addDays(now, -i))));
      var max = Math.max.apply(null, vals.concat([1]));
      bars.forEach(function (b, i) {
        var bar = b.firstElementChild, lab = b.lastElementChild, d = addDays(now, i - 6);
        bar.style.height = Math.max(6, Math.round(vals[i] / max * 90)) + '%';
        bar.className = 'w-full max-w-[10px] rounded-full transition-all duration-300 ' + (i === 6 ? 'bg-chart-terracotta' : 'bg-chart-sage/60');
        lab.textContent = WD_SHORT[d.getDay()]; lab.className = 'font-label-sm text-[9px] mt-1.5 ' + (i === 6 ? 'text-chart-terracotta font-bold' : 'text-text-muted');
        b.title = faDayMonth(d) + ': ' + money(vals[i]);
      });
      spendLabel.textContent = 'هزینه امروز';
      spendEl.textContent = money(vals[6], S.privacy);
      var left = S.wallet.budget - monthSum('expense');
      budgetEl.textContent = money(Math.max(0, left), S.privacy); budgetEl.className = budgetEl.className.replace(/text-chart-\w+/, left < 0 ? 'text-chart-terracotta' : 'text-chart-sage');
      // gym
      var s = session(today()), st = setsOf(s), pct = st.tot ? Math.round(st.done / st.tot * 100) : 0;
      streakEl.textContent = fa(streak()) + ' روز پیاپی';
      ringTxt.textContent = fa(pct) + '%';
      minEl.textContent = fa(sessionMinutes(s));
      setEl.textContent = fa(st.done) + '/' + fa(st.tot);
      if (!s || !s.exercises.length) { sName.textContent = 'امروز جلسه‌ای ثبت نشده'; sAct.textContent = 'شروع'; sDot.className = sDot.className.replace(/bg-chart-\w+/, 'bg-chart-terracotta'); }
      else if (s.finished) { sName.textContent = 'جلسه انجام شد: ' + s.name; sAct.textContent = 'بازگشایی'; sDot.className = sDot.className.replace(/bg-chart-\w+/, 'bg-chart-sage').replace('animate-pulse', ''); }
      else { sName.textContent = 'جلسه فعال: ' + s.name; sAct.textContent = 'ثبت پایان'; }
    }
    renderers.push(render); render();
    setInterval(function () { if (clock) clock.textContent = nowHM(); }, 1000); if (clock) clock.textContent = nowHM();
  };
  function finishSession() {
    var s = session(today()); if (!s) return;
    if (S.gym.timerStart) { s.minutes = (s.minutes || 0) + (Date.now() - S.gym.timerStart) / 60000; S.gym.timerStart = null; }
    s.finished = true; save(); refresh(); toast('جلسه امروز ثبت شد. خسته نباشید! 💪');
  }

  /* ===== Tasks & Habits (icon accordion hub + weekly review) ===== */
  P['tasks-habits'] = function () {
    var tplHabit = $('#habit-water').cloneNode(true);
    var oldTabs = $('#tab-container'), habitWrap = $('#habit-water').parentElement.parentElement, taskWrap = $('#task-list').parentElement;
    var fabRow = $('#add-task-fab').parentElement;
    [oldTabs, habitWrap, taskWrap].forEach(function (n) { if (n) n.remove(); });
    var sync = byText('span', 'همگام‌سازی'); if (sync) sync.textContent = 'ذخیره خودکار روی این دستگاه فعال است';
    var badgeEl = byText('span', 'عالی'), summaryTxt = byText('span', 'انجام شده');
    onTap($('#add-task-fab'), function () { menu('افزودن', [{ icon: 'task_alt', label: 'کار جدید', run: function () { taskSheet(); } }, { icon: 'all_inclusive', label: 'عادت جدید', run: function () { habitSheet(); } }, { icon: 'edit_note', label: 'مرور هفتگی', run: function () { open = 'review'; S.ui.tasksOpen = open; save(); render(); scrollTo_('review'); } }]); });

    S.ui = S.ui || {}; S.weekly = S.weekly || {};
    var open = S.ui.tasksOpen === undefined ? 'today' : S.ui.tasksOpen, sub = S.ui.tasksSub || {}, expanded = {}, reviewWeek = iso(weekStart(new Date()));
    var hub = document.createElement('div'); hub.className = 'w-full flex flex-col gap-3'; hub.id = 'tasks-hub';
    fabRow.parentElement.insertBefore(hub, fabRow);
    var card = 'bg-surface-bright clay-outset rounded-3xl overflow-hidden';
    var inset = 'bg-surface-subtle rounded-2xl shadow-[inset_2px_2px_5px_rgba(180,172,160,0.45),inset_-2px_-2px_5px_#ffffff]';
    var raised = 'bg-surface-bright rounded-xl shadow-[-2px_-2px_5px_#ffffff,2px_2px_6px_rgba(180,172,160,0.5)] active:scale-95 transition-all';
    var chev = function (on) { return '<span class="material-symbols-outlined text-[20px] text-text-muted transition-transform duration-200" style="transform:rotate(' + (on ? '-90' : '0') + 'deg)">chevron_left</span>'; };
    var badge = function (n, red) { return n ? '<span class="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ' + (red ? 'bg-chart-terracotta text-white' : 'bg-chart-sage/30 text-text-primary') + '">' + fa(n) + '</span>' : ''; };
    var stat = function (label, value, cls) { return '<div class="' + inset + ' p-3 flex flex-col gap-0.5"><span class="text-[11px] text-text-muted">' + label + '</span><span class="text-[15px] font-bold ' + (cls || 'text-text-primary') + '">' + value + '</span></div>'; };
    var SECTIONS = [
      { key: 'today', title: 'امروز', icon: 'today', color: '#DE8353' },
      { key: 'upcoming', title: 'هفت روز آینده', icon: 'date_range', color: '#5d7a8c' },
      { key: 'projects', title: 'دسته‌ها و پروژه‌ها', icon: 'folder_open', color: '#865228' },
      { key: 'habits', title: 'عادت‌ها', icon: 'all_inclusive', color: '#4d7c62' },
      { key: 'review', title: 'یادداشت و مرور هفتگی', icon: 'edit_note', color: '#6b6f9c' },
      { key: 'done', title: 'انجام‌شده و آرشیو', icon: 'inventory_2', color: '#8a8478' }
    ];
    // quick add bar
    var qa = document.createElement('form'); qa.className = 'w-full flex items-center gap-2 ' + inset + ' p-1.5 pr-4';
    qa.innerHTML = '<span class="material-symbols-outlined text-[20px] text-text-muted">add_task</span><input data-qa class="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] text-text-primary py-2" placeholder="افزودن سریع کار برای امروز…"><button type="button" data-qa-more class="' + raised + ' w-9 h-9 flex items-center justify-center text-text-muted" aria-label="جزئیات"><span class="material-symbols-outlined text-[18px]">tune</span></button><button type="submit" class="w-9 h-9 rounded-xl bg-chart-terracotta text-white flex items-center justify-center" aria-label="افزودن"><span class="material-symbols-outlined text-[20px]">arrow_upward</span></button>';
    hub.appendChild(qa);
    var qaIn = qa.querySelector('[data-qa]');
    qa.addEventListener('submit', function (e) {
      e.preventDefault(); var title = qaIn.value.trim(); if (!title) { taskSheet(); return; }
      var pr = /!!|فوری/.test(title) ? 'high' : 'med'; title = title.replace(/!!/g, '').trim();
      S.tasks.push({ id: uid(), title: title, date: today(), time: '', category: 'work', priority: pr, repeat: 'none', subtasks: [], starred: false, done: false, archived: false, reminder: false, note: '', createdAt: today() });
      qaIn.value = ''; save(); refresh(); toast('«' + title + '» به امروز اضافه شد');
    });
    qa.querySelector('[data-qa-more]').onclick = function () { var v = qaIn.value.trim(); qaIn.value = ''; taskSheet(null, null, v); };
    var rows = {};
    SECTIONS.forEach(function (s) {
      var c = document.createElement('div'); c.className = card; c.setAttribute('data-sec', s.key);
      c.innerHTML = '<button data-head class="w-full flex items-center gap-3 p-3.5 text-right"><div class="w-11 h-11 rounded-2xl ' + inset + ' flex items-center justify-center flex-shrink-0" style="color:' + s.color + '"><span class="material-symbols-outlined text-[22px]">' + s.icon + '</span></div><div class="flex-1 min-w-0"><div class="flex items-center gap-2"><span class="text-[14px] font-bold text-text-primary">' + s.title + '</span><span data-badge></span></div><div data-sum class="text-[12px] text-text-muted truncate"></div></div><span data-chev></span></button><div data-body class="px-3.5 pb-3.5 flex flex-col gap-2.5" style="display:none"></div>';
      hub.appendChild(c);
      c.querySelector('[data-head]').onclick = function () { open = open === s.key ? '' : s.key; S.ui.tasksOpen = open; save(); render(); if (open) scrollTo_(s.key); };
      rows[s.key] = { card: c, body: c.querySelector('[data-body]'), sum: c.querySelector('[data-sum]'), badge: c.querySelector('[data-badge]'), chev: c.querySelector('[data-chev]') };
    });
    function scrollTo_(k) { setTimeout(function () { var c = rows[k].card; var y = c.getBoundingClientRect().top + window.scrollY - 80; window.scrollTo({ top: y, behavior: 'smooth' }); }, 30); }
    function subOn(id, def) { return sub[id] === undefined ? def : sub[id]; }
    function group(id, title, count, inner, def, red, extra) {
      var on = subOn(id, def);
      return '<div class="' + inset + ' overflow-hidden"><button data-sub="' + id + '" data-def="' + (def ? 1 : 0) + '" class="w-full flex items-center justify-between px-3 py-2.5"><span class="flex items-center gap-2 text-[13px] font-bold ' + (red ? 'text-chart-terracotta' : 'text-text-primary') + '">' + title + badge(count, red) + '</span><span class="flex items-center gap-1 text-[11px] text-text-muted">' + (extra || '') + chev(on) + '</span></button>' + (on ? '<div class="flex flex-col gap-2 px-2 pb-2">' + inner + '</div>' : '') + '</div>';
    }
    function taskRow(t, opts) {
      opts = opts || {};
      var p = PRIO[t.priority] || PRIO.med, c = CAT[t.category] || CAT.work, subs = t.subtasks || [], sd = subs.filter(function (x) { return x.done; }).length, ex = !!expanded[t.id], over = !t.done && t.date < today();
      var meta = [];
      if (opts.showDate || t.date !== today()) meta.push((over ? '<b class="text-chart-terracotta">' : '') + relDay(t.date) + (over ? '</b>' : ''));
      if (t.time) meta.push(fa(t.time));
      meta.push('<span class="inline-block w-1.5 h-1.5 rounded-full align-middle ' + c.dot + '"></span> ' + c.label);
      if (subs.length) meta.push('<span class="material-symbols-outlined text-[12px] align-middle">checklist</span>' + fa(sd) + '/' + fa(subs.length));
      if (t.repeat && t.repeat !== 'none') meta.push('<span class="material-symbols-outlined text-[12px] align-middle">repeat</span>');
      if (t.reminder) meta.push('<span class="material-symbols-outlined text-[12px] align-middle">notifications_active</span>');
      var h = '<div class="bg-surface-bright rounded-2xl shadow-[-2px_-2px_6px_#ffffff,3px_3px_8px_rgba(180,172,160,0.45)] overflow-hidden' + (t.done ? ' opacity-60' : '') + '" data-task="' + t.id + '">' +
        '<div class="flex items-center gap-2.5 p-2.5"><button data-check="' + t.id + '" aria-label="انجام شد" class="w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center ' + (t.done ? 'bg-chart-sage text-white' : 'bg-surface-subtle shadow-[inset_2px_2px_4px_rgba(180,172,160,0.5),inset_-2px_-2px_4px_#ffffff]') + '" style="' + (t.done ? '' : 'box-shadow:inset 0 0 0 2px ' + p.color + ';') + '"><span class="material-symbols-outlined text-[16px]' + (t.done ? '' : ' opacity-0') + '">check</span></button>' +
        '<button data-expand="' + t.id + '" class="flex-1 min-w-0 text-right"><div class="text-[14px] font-bold text-text-primary truncate' + (t.done ? ' line-through' : '') + '">' + (t.starred ? '⭐ ' : '') + esc(t.title) + '</div><div class="text-[11px] text-text-muted truncate">' + meta.join(' • ') + '</div></button>' +
        '<span class="w-1.5 h-8 rounded-full flex-shrink-0" style="background:' + p.color + '" title="اولویت ' + p.label + '"></span></div>';
      if (ex) {
        h += '<div class="px-3 pb-3 flex flex-col gap-2">';
        if (subs.length) h += '<div class="flex flex-col gap-1">' + subs.map(function (s) { return '<button data-subtask="' + t.id + ':' + s.id + '" class="flex items-center gap-2 text-right text-[13px] ' + (s.done ? 'text-text-muted line-through' : 'text-text-primary') + '"><span class="material-symbols-outlined text-[18px] ' + (s.done ? 'text-chart-sage' : 'text-text-muted') + '">' + (s.done ? 'check_box' : 'check_box_outline_blank') + '</span>' + esc(s.title) + '</button>'; }).join('') + '</div>';
        if (t.note) h += '<div class="text-[12px] text-text-muted leading-6">' + esc(t.note) + '</div>';
        h += '<div class="text-[11px] text-text-muted">اولویت ' + p.label + ' • ' + REPEAT[t.repeat || 'none'] + ' • ' + faDate(parseIso(t.date), { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>';
        h += '<div class="grid grid-cols-4 gap-1.5">' + [['edit', 'edit', 'ویرایش'], ['star', 'star', t.starred ? 'برداشتن ستاره' : 'مهم'], ['tomorrow', 'event_repeat', 'فردا'], ['more', 'more_horiz', 'بیشتر']].map(function (a) { return '<button data-tact="' + a[0] + ':' + t.id + '" class="' + raised + ' py-2 flex flex-col items-center gap-0.5 text-[10px] font-bold text-text-muted"><span class="material-symbols-outlined text-[18px]">' + a[1] + '</span>' + a[2] + '</button>'; }).join('') + '</div></div>';
      }
      return h + '</div>';
    }
    var empty = function (txt) { return '<div class="text-center text-text-muted text-[12px] py-3">' + txt + '</div>'; };
    function habitDone(h, k) { return ((h.log && h.log[k]) || 0) >= h.target; }
    function habitStreak(h) { var n = 0, d = new Date(); if (!habitDone(h, iso(d))) d = addDays(d, -1); while (habitDone(h, iso(d)) && n < 999) { n++; d = addDays(d, -1); } return n; }
    function weekStats(ws) {
      var days = []; for (var i = 0; i < 7; i++) days.push(iso(addDays(parseIso(ws), i)));
      var inWeek = function (d) { return d >= days[0] && d <= days[6]; };
      var due = S.tasks.filter(function (t) { return inWeek(t.date); }), done = S.tasks.filter(function (t) { return t.done && inWeek(t.doneAt || t.date); });
      var hTot = 0, hOk = 0; S.habits.forEach(function (h) { days.forEach(function (k) { if (k <= today()) { hTot++; if (habitDone(h, k)) hOk++; } }); });
      var gym = days.filter(function (k) { var s = S.gym.sessions[k]; return s && (s.finished || setsOf(s).done > 0); }).length;
      var spend = days.reduce(function (s, k) { return s + daySpend(k); }, 0);
      return { days: days, due: due.length, done: done.length, habit: hTot ? Math.round(hOk / hTot * 100) : 0, gym: gym, spend: spend };
    }
    function render() {
      var t0 = today(), all = S.tasks.filter(function (t) { return !t.archived; });
      var todays = all.filter(function (t) { return t.date === t0; }), overdue = all.filter(function (t) { return !t.done && t.date < t0; });
      var doneToday = todays.filter(function (t) { return t.done; }).length, pct = todays.length ? Math.round(doneToday / todays.length * 100) : 0;
      // top summary widget
      $('#summary-percent').textContent = fa(pct) + '%'; $('#summary-ring').style.strokeDashoffset = 119.38 - pct / 100 * 119.38; $('#progress-bar-fill').style.width = Math.max(pct, 8) + '%';
      if (summaryTxt) summaryTxt.textContent = fa(doneToday) + ' از ' + fa(todays.length) + ' انجام شده' + (overdue.length ? ' • ' + fa(overdue.length) + ' معوق' : '');
      if (badgeEl) badgeEl.textContent = !todays.length ? 'آزاد' : pct === 100 ? 'عالی' : pct >= 50 ? 'خوب' : 'شروع کن';
      var up = all.filter(function (t) { return !t.done && t.date > t0 && daysBetween(t0, t.date) <= 7; });
      var hDone = S.habits.filter(function (h) { return habitDone(h, t0); }).length, best = S.habits.reduce(function (m, h) { return Math.max(m, habitStreak(h)); }, 0);
      var ws = iso(weekStart(new Date())), rv = S.weekly[ws];
      var weekDone = weekStats(ws).done;
      var R = rows;
      R.today.sum.textContent = (overdue.length ? fa(overdue.length) + ' معوق • ' : '') + fa(doneToday) + ' از ' + fa(todays.length) + ' کار امروز انجام شده';
      R.today.badge.innerHTML = badge(overdue.length || todays.length - doneToday, !!overdue.length);
      R.upcoming.sum.textContent = up.length ? fa(up.length) + ' کار در ۷ روز آینده' : 'برنامه‌ای برای روزهای آینده ثبت نشده';
      R.projects.sum.textContent = Object.keys(CAT).map(function (k) { var n = all.filter(function (t) { return !t.done && t.category === k; }).length; return n ? CAT[k].label + ' ' + fa(n) : ''; }).filter(Boolean).join(' • ') || 'کار بازی ندارید';
      R.habits.sum.textContent = fa(hDone) + ' از ' + fa(S.habits.length) + ' امروز' + (best ? ' • بهترین زنجیره ' + fa(best) + ' روز' : '');
      R.habits.badge.innerHTML = badge(S.habits.length - hDone, false);
      R.review.sum.textContent = rv && (rv.wins || rv.challenges || rv.next || rv.notes) ? 'هفته جاری نوشته شده • ' + fa(Object.keys(S.weekly).length) + ' مرور ثبت‌شده' : 'مرور این هفته هنوز نوشته نشده';
      R.review.badge.innerHTML = !(rv && (rv.wins || rv.next)) && new Date().getDay() === 5 ? badge('!', true) : '';
      R.done.sum.textContent = fa(weekDone) + ' کار این هفته انجام شد • ' + fa(S.tasks.filter(function (t) { return t.archived; }).length) + ' در آرشیو';
      SECTIONS.forEach(function (s) { var r = R[s.key], on = open === s.key; r.chev.innerHTML = chev(on); r.body.style.display = on ? '' : 'none'; });
      var b = '';
      if (open === 'today') {
        var tOpen = todays.filter(function (t) { return !t.done; }).sort(sortTasks), tDone = todays.filter(function (t) { return t.done; });
        if (overdue.length) b += group('t-over', 'معوق', overdue.length, overdue.sort(sortTasks).map(function (t) { return taskRow(t, { showDate: true }); }).join('') + '<button data-act="over-today" class="text-[12px] font-bold text-chart-terracotta py-1">انتقال همه به امروز</button>', true, true);
        ['high', 'med', 'low'].forEach(function (pk) { var l = tOpen.filter(function (t) { return (t.priority || 'med') === pk; }); if (l.length) b += group('t-' + pk, '<span class="w-2 h-2 rounded-full" style="background:' + PRIO[pk].color + '"></span>اولویت ' + PRIO[pk].label, l.length, l.map(function (t) { return taskRow(t); }).join(''), true); });
        if (!tOpen.length && !overdue.length) b += empty(todays.length ? 'همه کارهای امروز انجام شده 🎉' : 'برای امروز کاری ندارید. از نوار بالا اضافه کنید.');
        if (tDone.length) b += group('t-done', 'انجام‌شده امروز', tDone.length, tDone.map(function (t) { return taskRow(t); }).join(''), false);
        R.today.body.innerHTML = b;
      } else if (open === 'upcoming') {
        for (var i = 1; i <= 7; i++) { var d = iso(addDays(new Date(), i)), l = all.filter(function (t) { return t.date === d; }).sort(sortTasks); b += group('u-' + i, (i === 1 ? 'فردا' : faDate(parseIso(d), { weekday: 'long' })) + ' <span class="text-[11px] text-text-muted font-normal">' + faDayMonth(parseIso(d)) + '</span>', l.filter(function (t) { return !t.done; }).length, (l.map(function (t) { return taskRow(t); }).join('') || empty('کاری ثبت نشده')) + '<button data-addon="' + d + '" class="text-[12px] font-bold text-chart-terracotta py-1">+ افزودن کار برای این روز</button>', i <= 2 && l.length > 0); }
        var later = all.filter(function (t) { return !t.done && daysBetween(t0, t.date) > 7; }).sort(sortTasks);
        if (later.length) b += group('u-later', 'بعدتر', later.length, later.map(function (t) { return taskRow(t, { showDate: true }); }).join(''), false);
        R.upcoming.body.innerHTML = b;
      } else if (open === 'projects') {
        b += Object.keys(CAT).map(function (k) {
          var l = all.filter(function (t) { return t.category === k; }), op = l.filter(function (t) { return !t.done; }).sort(sortTasks), dn = l.length - op.length;
          var bar = '<span class="inline-flex w-14 h-1.5 rounded-full bg-text-muted/20 overflow-hidden"><i style="width:' + (l.length ? Math.round(dn / l.length * 100) : 0) + '%;background:#8EAA97"></i></span>';
          return group('p-' + k, '<span class="w-2.5 h-2.5 rounded-full ' + CAT[k].dot + '"></span>' + CAT[k].label, op.length, (op.map(function (t) { return taskRow(t, { showDate: true }); }).join('') || empty('کار بازی در این دسته نیست')), false, false, bar + ' ' + fa(dn) + '/' + fa(l.length));
        }).join('');
        var starred = all.filter(function (t) { return t.starred && !t.done; });
        if (starred.length) b = group('p-star', '⭐ مهم‌ها', starred.length, starred.sort(sortTasks).map(function (t) { return taskRow(t, { showDate: true }); }).join(''), true) + b;
        R.projects.body.innerHTML = b;
      } else if (open === 'habits') {
        R.habits.body.innerHTML = '<div class="grid grid-cols-3 gap-2" data-hgrid></div><div class="' + inset + ' p-3 flex flex-col gap-2" data-hweek></div><button data-act="habit" class="w-full ' + raised + ' py-3 flex items-center justify-center gap-2 text-chart-terracotta font-bold text-[14px]"><span class="material-symbols-outlined text-[20px]">add_circle</span>عادت جدید</button><div class="text-[11px] text-text-muted text-center">لمس کارت: افزودن • نگه‌داشتن: گزینه‌ها</div>';
        var grid = $('[data-hgrid]', R.habits.body);
        S.habits.forEach(function (h) {
          var c = tplHabit.cloneNode(true); c.removeAttribute('id');
          var v = (h.log && h.log[t0]) || 0, ok = v >= h.target;
          c.querySelector('.material-symbols-outlined').textContent = h.icon || 'repeat';
          c.querySelector('.font-label-md').textContent = h.title;
          var bd = c.querySelector('.habit-badge'); bd.innerHTML = '<span class="counter"></span><span class="material-symbols-outlined text-[12px]">' + (ok ? 'done_all' : 'add') + '</span>'; bd.firstChild.textContent = fa(v) + '/' + fa(h.target);
          if (ok) c.classList.add('ring-2', 'ring-chart-sage/40');
          var wasLong = longPress(c, function () { habitMenu(h); });
          c.addEventListener('click', function () { if (wasLong()) return; h.log = h.log || {}; var nv = (h.log[t0] || 0) + (h.step || 1); h.log[t0] = nv; save(); refresh(); toast(h.title + ': ' + fa(nv) + '/' + fa(h.target) + (nv >= h.target ? ' ✓' : ''), { label: 'واگرد', run: function () { h.log[t0] = Math.max(0, (h.log[t0] || 0) - (h.step || 1)); save(); refresh(); } }); });
          c.style.cursor = 'pointer';
          grid.appendChild(c);
        });
        if (!S.habits.length) grid.outerHTML = empty('هنوز عادتی تعریف نشده');
        var wk = $('[data-hweek]', R.habits.body), wsD = weekStart(new Date());
        wk.innerHTML = '<div class="flex items-center justify-between text-[12px] font-bold text-text-primary"><span>این هفته</span><span class="flex gap-1.5 text-text-muted font-normal">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) { return '<span class="w-5 text-center">' + WD_SHORT[addDays(wsD, i).getDay()] + '</span>'; }).join('') + '</span></div>' +
          S.habits.map(function (h) { return '<div class="flex items-center justify-between"><span class="text-[12px] text-text-primary truncate">' + esc(h.title) + (habitStreak(h) > 1 ? ' <span class="text-chart-terracotta text-[11px]">🔥' + fa(habitStreak(h)) + '</span>' : '') + '</span><span class="flex gap-1.5">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) { var k = iso(addDays(wsD, i)), ok = habitDone(h, k), fut = k > t0, part = !ok && (h.log && h.log[k]); return '<span class="w-5 h-5 rounded-md ' + (ok ? 'bg-chart-sage' : part ? 'bg-chart-sage/40' : fut ? 'bg-transparent border border-dashed border-text-muted/30' : 'bg-text-muted/15') + (k === t0 ? ' ring-2 ring-chart-terracotta/50' : '') + '"></span>'; }).join('') + '</span></div>'; }).join('');
      } else if (open === 'review') {
        R.review.body.innerHTML = reviewHtml();
        wireReview();
      } else if (open === 'done') {
        var wsk = iso(weekStart(new Date()));
        var doneList = S.tasks.filter(function (t) { return t.done && !t.archived; }).sort(function (a, c) { return (a.doneAt || a.date) < (c.doneAt || c.date) ? 1 : -1; });
        var thisW = doneList.filter(function (t) { return (t.doneAt || t.date) >= wsk; }), older = doneList.filter(function (t) { return (t.doneAt || t.date) < wsk; });
        var arch = S.tasks.filter(function (t) { return t.archived; });
        b += group('d-week', 'انجام‌شده این هفته', thisW.length, thisW.map(function (t) { return taskRow(t, { showDate: true }); }).join('') || empty('هنوز موردی نیست'), true);
        if (older.length) b += group('d-old', 'انجام‌شده قبلی', older.length, older.slice(0, 30).map(function (t) { return taskRow(t, { showDate: true }); }).join(''), false);
        b += group('d-arch', 'آرشیو', arch.length, arch.map(function (t) { return taskRow(t, { showDate: true }); }).join('') || empty('آرشیو خالی است'), false);
        if (doneList.length) b += '<button data-act="archive-done" class="w-full ' + raised + ' py-2.5 text-[13px] font-bold text-text-muted flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-[18px]">inventory_2</span>انتقال همه انجام‌شده‌ها به آرشیو</button>';
        R.done.body.innerHTML = b;
      }
      wire();
    }
    /* ---- weekly review ---- */
    var REVIEW_FIELDS = [['wins', 'دستاوردها و کارهای خوب این هفته', 'emoji_events', 'چه چیزهایی خوب پیش رفت؟'], ['challenges', 'چالش‌ها و درس‌ها', 'psychology', 'چه چیزی سخت بود و چه یاد گرفتم؟'], ['next', 'اولویت‌های هفته بعد', 'flag', 'هر خط یک اولویت — می‌توانید آن‌ها را به کار تبدیل کنید'], ['notes', 'یادداشت آزاد', 'sticky_note_2', 'هر چیزی که می‌خواهید بنویسید…']];
    var MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
    function reviewHtml() {
      var ws = reviewWeek, we = iso(addDays(parseIso(ws), 6)), r = S.weekly[ws] || {}, st = weekStats(ws), cur = ws === iso(weekStart(new Date()));
      var h = '<div class="flex items-center justify-between"><button data-wk="-1" class="w-9 h-9 rounded-full ' + raised + ' flex items-center justify-center text-text-muted" aria-label="هفته قبل"><span class="material-symbols-outlined">chevron_right</span></button><div class="text-center"><div class="text-[14px] font-bold text-text-primary">' + (cur ? 'این هفته' : 'هفته') + '</div><div class="text-[11px] text-text-muted">' + faDayMonth(parseIso(ws)) + ' تا ' + faDayMonth(parseIso(we)) + '</div></div><button data-wk="1" class="w-9 h-9 rounded-full ' + raised + ' flex items-center justify-center text-text-muted' + (cur ? ' opacity-30 pointer-events-none' : '') + '" aria-label="هفته بعد"><span class="material-symbols-outlined">chevron_left</span></button></div>';
      h += '<div class="grid grid-cols-2 gap-2">' + stat('کارهای انجام‌شده', fa(st.done) + ' از ' + fa(st.due)) + stat('تکمیل عادت‌ها', fa(st.habit) + '٪', st.habit >= 70 ? 'text-chart-sage' : '') + stat('جلسات ورزش', fa(st.gym) + ' روز') + stat('هزینه هفته', money(st.spend, S.privacy), 'text-chart-terracotta') + '</div>';
      h += '<div class="' + inset + ' p-3 flex items-center justify-between"><span class="text-[12px] font-bold text-text-primary">حال کلی هفته</span><span class="flex gap-1">' + MOODS.map(function (m, i) { return '<button data-mood="' + (i + 1) + '" class="w-9 h-9 rounded-xl text-[20px] ' + (r.mood === i + 1 ? 'bg-chart-terracotta/20 ring-2 ring-chart-terracotta/50' : 'opacity-60') + '">' + m + '</button>'; }).join('') + '</span></div>';
      REVIEW_FIELDS.forEach(function (f) {
        var val = r[f[0]] || '', id = 'rv-' + f[0], on = subOn(id, !val || f[0] === 'wins');
        h += '<div class="' + inset + ' overflow-hidden"><button data-sub="' + id + '" data-def="' + (on ? 1 : 0) + '" class="w-full flex items-center justify-between px-3 py-2.5"><span class="flex items-center gap-2 text-[13px] font-bold text-text-primary"><span class="material-symbols-outlined text-[18px] text-text-muted">' + f[2] + '</span>' + f[1] + '</span><span class="flex items-center gap-1 text-[11px] text-text-muted">' + (val ? fa(val.split('\n').filter(Boolean).length) + ' خط' : 'خالی') + chev(on) + '</span></button>' + (on ? '<div class="px-3 pb-3 flex flex-col gap-2"><textarea data-rv="' + f[0] + '" rows="4" class="w-full rounded-xl bg-surface-bright border-0 outline-none p-3 text-[13px] leading-7 text-text-primary resize-y" placeholder="' + f[3] + '">' + esc(val) + '</textarea>' + (f[0] === 'next' ? '<button data-act="next-to-tasks" class="' + raised + ' py-2 text-[12px] font-bold text-chart-terracotta flex items-center justify-center gap-1"><span class="material-symbols-outlined text-[16px]">add_task</span>تبدیل به کار برای شروع هفته بعد</button>' : '') + '</div>' : '') + '</div>';
      });
      h += '<div class="flex items-center justify-between text-[11px] text-text-muted px-1"><span data-saved>' + (r.updatedAt ? 'آخرین ذخیره: ' + faDayMonth(parseIso(r.updatedAt)) : 'ذخیره خودکار هنگام نوشتن') + '</span><button data-act="all-reviews" class="font-bold text-chart-terracotta">همه مرورها (' + fa(Object.keys(S.weekly).filter(function (k) { var x = S.weekly[k]; return x && (x.wins || x.challenges || x.next || x.notes); }).length) + ')</button></div>';
      return h;
    }
    function wireReview() {
      var body = rows.review.body, ws = reviewWeek;
      $$('[data-rv]', body).forEach(function (ta) {
        ta.oninput = function () {
          var r = S.weekly[ws] = S.weekly[ws] || {}; r[ta.getAttribute('data-rv')] = ta.value; r.updatedAt = today();
          clearTimeout(ta._t); ta._t = setTimeout(function () { save(); var s = $('[data-saved]', body); if (s) s.textContent = 'ذخیره شد ✓'; rows.review.sum.textContent = 'هفته جاری نوشته شده • ' + fa(Object.keys(S.weekly).length) + ' مرور ثبت‌شده'; }, 500);
        };
        ta.onclick = function (e) { e.stopPropagation(); };
      });
    }
    function allReviews() {
      var keys = Object.keys(S.weekly).filter(function (k) { var x = S.weekly[k]; return x && (x.wins || x.challenges || x.next || x.notes); }).sort().reverse();
      var html = keys.length ? '<div class="ui-list">' + keys.map(function (k) { var x = S.weekly[k]; return '<div class="ui-item" data-wkey="' + k + '" style="cursor:pointer;display:block"><div style="display:flex;justify-content:space-between"><b>' + faDayMonth(parseIso(k)) + ' تا ' + faDayMonth(addDays(parseIso(k), 6)) + '</b><span>' + (x.mood ? MOODS[x.mood - 1] : '') + '</span></div><div class="s" style="white-space:pre-line;max-height:3.6em;overflow:hidden">' + esc(x.wins || x.notes || x.next || '') + '</div></div>'; }).join('') + '</div>' : '<div class="ui-empty">هنوز مروری نوشته نشده</div>';
      var close = infoSheet('همه مرورهای هفتگی', html);
      $$('.ui-overlay [data-wkey]').forEach(function (r) { r.onclick = function () { reviewWeek = r.getAttribute('data-wkey'); close(); open = 'review'; S.ui.tasksOpen = open; save(); render(); scrollTo_('review'); }; });
    }
    function wire() {
      var on = function (sel, fn) { $$(sel, hub).forEach(function (el) { el.onclick = function (e) { e.stopPropagation(); fn(el, e); }; }); };
      var T = function (id) { return S.tasks.find(function (x) { return x.id === id; }); };
      on('[data-sub]', function (el) { var id = el.getAttribute('data-sub'); if (sub[id] === undefined) sub[id] = el.getAttribute('data-def') === '1'; sub[id] = !sub[id]; S.ui.tasksSub = sub; save(); render(); });
      on('[data-check]', function (el) { toggleTask(el.getAttribute('data-check')); });
      on('[data-expand]', function (el) { var id = el.getAttribute('data-expand'); expanded[id] = !expanded[id]; render(); });
      on('[data-subtask]', function (el) { var p = el.getAttribute('data-subtask').split(':'), t = T(p[0]), s = t && t.subtasks.find(function (x) { return x.id === p[1]; }); if (!s) return; s.done = !s.done; save(); if (t.subtasks.every(function (x) { return x.done; }) && !t.done) toast('همه زیرکارها انجام شد — کار اصلی را هم تیک بزنید', { label: 'تیک بزن', run: function () { toggleTask(t.id); } }); refresh(); });
      on('[data-tact]', function (el) {
        var p = el.getAttribute('data-tact').split(':'), t = T(p[1]); if (!t) return;
        if (p[0] === 'edit') taskSheet(t.id);
        else if (p[0] === 'star') { t.starred = !t.starred; save(); refresh(); }
        else if (p[0] === 'tomorrow') { t.date = iso(addDays(parseIso(t.date > today() ? t.date : today()), 1)); t.notified = false; save(); refresh(); toast('به ' + faDayMonth(parseIso(t.date)) + ' منتقل شد'); }
        else if (p[0] === 'more') taskMenu(t);
      });
      on('[data-addon]', function (el) { taskSheet(null, el.getAttribute('data-addon')); });
      on('[data-mood]', function (el) { var r = S.weekly[reviewWeek] = S.weekly[reviewWeek] || {}; var m = +el.getAttribute('data-mood'); r.mood = r.mood === m ? 0 : m; r.updatedAt = today(); save(); render(); });
      on('[data-wk]', function (el) { reviewWeek = iso(addDays(parseIso(reviewWeek), 7 * +el.getAttribute('data-wk'))); render(); });
      on('[data-act]', function (el) {
        var a = el.getAttribute('data-act');
        if (a === 'habit') habitSheet();
        else if (a === 'over-today') { S.tasks.forEach(function (t) { if (!t.done && !t.archived && t.date < today()) { t.date = today(); t.notified = false; } }); save(); refresh(); toast('کارهای معوق به امروز منتقل شدند'); }
        else if (a === 'archive-done') { var n = 0; S.tasks.forEach(function (t) { if (t.done && !t.archived) { t.archived = true; n++; } }); save(); refresh(); toast(fa(n) + ' کار به آرشیو رفت'); }
        else if (a === 'all-reviews') allReviews();
        else if (a === 'next-to-tasks') {
          var r = S.weekly[reviewWeek] || {}, lines = String(r.next || '').split('\n').map(function (x) { return x.replace(/^[-•*\d.)\s]+/, '').trim(); }).filter(Boolean);
          if (!lines.length) { toast('اول اولویت‌ها را بنویسید (هر خط یکی)'); return; }
          var d = iso(addDays(parseIso(reviewWeek), 7)); if (d < today()) d = today();
          var existing = S.tasks.map(function (t) { return t.title + '|' + t.date; }), added = 0;
          lines.forEach(function (l) { if (existing.indexOf(l + '|' + d) >= 0) return; S.tasks.push({ id: uid(), title: l, date: d, time: '', category: 'work', priority: 'high', repeat: 'none', subtasks: [], starred: true, done: false, archived: false, reminder: false, note: 'از مرور هفتگی', createdAt: today() }); added++; });
          save(); refresh(); toast(added ? fa(added) + ' کار با اولویت بالا برای ' + faDayMonth(parseIso(d)) + ' ساخته شد' : 'این اولویت‌ها قبلاً به کار تبدیل شده‌اند');
        }
      });
    }
    function taskMenu(t) {
      var items = t.archived ? [
        { icon: 'unarchive', label: 'بازگرداندن از آرشیو', run: function () { t.archived = false; save(); refresh(); toast('به فهرست برگشت'); } },
        { icon: 'delete', label: 'حذف', danger: true, run: function () { removeTask(t.id); } }
      ] : [
        { icon: 'edit', label: 'ویرایش کامل', run: function () { taskSheet(t.id); } },
        { icon: 'flag', label: 'تغییر اولویت (الان: ' + (PRIO[t.priority] || PRIO.med).label + ')', run: function () { var ks = ['high', 'med', 'low']; t.priority = ks[(ks.indexOf(t.priority || 'med') + 1) % 3]; save(); refresh(); toast('اولویت: ' + PRIO[t.priority].label); } },
        { icon: t.reminder ? 'notifications_off' : 'notifications_active', label: t.reminder ? 'خاموش کردن یادآور' : 'روشن کردن یادآور', run: function () { if (!t.time) { toast('اول برای این کار ساعت تعیین کنید'); taskSheet(t.id); return; } t.reminder = !t.reminder; t.notified = false; save(); refresh(); if (t.reminder) askNotif(); } },
        { icon: 'content_copy', label: 'تکثیر', run: function () { var c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.done = false; c.spawnedNext = false; (c.subtasks || []).forEach(function (s) { s.id = uid(); s.done = false; }); S.tasks.push(c); save(); refresh(); toast('کپی ساخته شد'); } },
        { icon: 'event_note', label: 'افزودن به برنامه‌ریز (بلوک زمانی)', run: function () { var st = t.time || '09:00', m = Math.min(hmToMin(st) + 60, 23 * 60 + 59); S.blocks.push({ id: uid(), date: t.date, title: t.title, start: st, end: pad(Math.floor(m / 60)) + ':' + pad(m % 60), color: 'terracotta', icon: 'bolt', done: false, notify: false }); save(); toast('به برنامه‌ریز اضافه شد'); } },
        { icon: 'inventory_2', label: 'آرشیو', run: function () { t.archived = true; save(); refresh(); toast('به آرشیو رفت', { label: 'واگرد', run: function () { t.archived = false; save(); refresh(); } }); } },
        { icon: 'delete', label: 'حذف', danger: true, run: function () { removeTask(t.id); } }
      ];
      menu(t.title, items, faDate(parseIso(t.date), { weekday: 'long', day: 'numeric', month: 'long' }) + (t.time ? ' • ' + fa(t.time) : ''));
    }
    function habitMenu(h) {
      var t0 = today();
      menu(h.title, [
        { icon: 'add', label: 'افزودن ' + fa(h.step || 1) + ' ' + (h.unit || ''), run: function () { h.log[t0] = (h.log[t0] || 0) + (h.step || 1); save(); refresh(); } },
        { icon: 'remove', label: 'کم کردن ' + fa(h.step || 1), run: function () { h.log[t0] = Math.max(0, (h.log[t0] || 0) - (h.step || 1)); save(); refresh(); } },
        { icon: 'restart_alt', label: 'صفر کردن امروز', run: function () { h.log[t0] = 0; save(); refresh(); } },
        { icon: 'edit', label: 'ویرایش عادت', run: function () { habitSheet(h.id); } },
        { icon: 'delete', label: 'حذف عادت', danger: true, run: function () { var i = S.habits.indexOf(h); S.habits.splice(i, 1); save(); refresh(); toast('عادت حذف شد', { label: 'واگرد', run: function () { S.habits.splice(i, 0, h); save(); refresh(); } }); } }
      ], 'امروز: ' + fa((h.log && h.log[t0]) || 0) + ' از ' + fa(h.target) + ' ' + (h.unit || '') + ' • زنجیره ' + fa(habitStreak(h)) + ' روز');
    }
    // weekly review nudge on Friday (end of the Persian week)
    if (new Date().getDay() === 5 && S.ui.reviewNudge !== today()) { S.ui.reviewNudge = today(); save(); setTimeout(function () { toast('آخر هفته است — وقت مرور هفتگی', { label: 'باز کن', run: function () { open = 'review'; S.ui.tasksOpen = open; save(); render(); scrollTo_('review'); } }); }, 1500); }
    renderers.push(render); render();
  };
  var HABIT_ICONS = ['local_drink', 'menu_book', 'self_improvement', 'directions_walk', 'bedtime', 'nutrition', 'fitness_center', 'edit_note', 'medication', 'language'];
  function habitSheet(id) {
    var h = id ? S.habits.find(function (x) { return x.id === id; }) : null;
    form({
      title: h ? 'ویرایش عادت' : 'عادت جدید',
      fields: [
        { name: 'title', label: 'نام عادت', value: h ? h.title : '', placeholder: 'مثلاً پیاده‌روی' },
        { name: 'icon', label: 'آیکون', type: 'chips', value: h ? h.icon : HABIT_ICONS[3], options: HABIT_ICONS.map(function (i) { return { value: i, label: '', icon: i }; }) },
        { name: 'target', label: 'هدف روزانه', type: 'number', value: h ? h.target : 1, row: '3a' },
        { name: 'step', label: 'هر لمس', type: 'number', value: h ? h.step : 1, row: '3a' },
        { name: 'unit', label: 'واحد', value: h ? h.unit : 'بار', row: '3a' }
      ],
      onSubmit: function (v) {
        var title = (v.title || '').trim(); if (!title) { toast('نام عادت را وارد کنید'); return false; }
        var o = h || { id: uid(), log: {} };
        o.title = title; o.icon = v.icon; o.target = Math.max(1, num(v.target)); o.step = Math.max(1, num(v.step)); o.unit = (v.unit || '').trim();
        if (!h) S.habits.push(o); save(); refresh(); toast(h ? 'عادت ویرایش شد' : 'عادت اضافه شد');
      }
    });
  }

  /* ===== Planner ===== */
  var BLOCK_COLORS = { terracotta: { bg: 'bg-chart-terracotta', dot: 'bg-chart-terracotta', label: 'تمرکز' }, slate: { bg: 'bg-primary-container', dot: 'bg-primary-container', label: 'جلسه' }, sage: { bg: 'bg-chart-sage', dot: 'bg-chart-sage', label: 'سلامت' }, sand: { bg: 'bg-secondary-container', dot: 'bg-secondary-container', label: 'شخصی' } };
  var BLOCK_ICONS = { terracotta: 'bolt', slate: 'groups', sage: 'spa', sand: 'person' };
  P['planner-calendar'] = function () {
    var sel = today();
    var daysEl = $('#calendarDays'); var dayBtns = $$('.day-btn', daysEl);
    var activeCls = dayBtns.find(function (b) { return b.classList.contains('active-day'); }).className;
    var idleCls = dayBtns.find(function (b) { return !b.classList.contains('active-day'); }).className.replace(/\bactive-day\b/, '');
    var toggle = $('#viewToggleBtn'), knob = $('#toggleKnob');
    var calIcon = toggle.previousElementSibling;
    var clock = $('#clockDisplay');
    var cards = $$('.task-card'); var cardWrap = cards[0].parentElement; var tplCard = cards[0].cloneNode(true);
    var knobTl = $('#timelineKnob'); var track = knobTl.parentElement; var stamps = track.previousElementSibling;
    var weekOffset = 0;
    // week navigation: prev/next arrows around calendar row
    var navRow = document.createElement('div'); navRow.className = 'flex items-center justify-between mb-2 px-1';
    navRow.innerHTML = '<button class="w-8 h-8 rounded-full bg-surface-container-low clay-outset flex items-center justify-center text-text-muted" aria-label="هفته قبل"><span class="material-symbols-outlined text-[18px]">chevron_right</span></button><span class="font-title-md text-[14px] text-text-primary font-bold"></span><button class="w-8 h-8 rounded-full bg-surface-container-low clay-outset flex items-center justify-center text-text-muted" aria-label="هفته بعد"><span class="material-symbols-outlined text-[18px]">chevron_left</span></button>';
    daysEl.parentElement.insertBefore(navRow, daysEl);
    onTap(navRow.firstChild, function () { weekOffset--; sel = iso(addDays(weekStart(new Date()), weekOffset * 7)); render(); });
    onTap(navRow.lastChild, function () { weekOffset++; sel = iso(addDays(weekStart(new Date()), weekOffset * 7)); render(); });
    onTap(navRow.children[1], function () { weekOffset = 0; sel = today(); render(); toast('برگشت به امروز'); });
    onTap(calIcon, function () {
      form({ title: 'رفتن به تاریخ', fields: [{ name: 'd', label: 'تاریخ', type: 'date', value: sel }], submit: 'برو', onSubmit: function (v) { if (!v.d) return false; sel = v.d; weekOffset = Math.round((weekStart(parseIso(sel)) - weekStart(new Date())) / (7 * 864e5)); render(); } });
    });
    onTap(toggle, function () { S.plannerHideDone = !S.plannerHideDone; save(); render(); toast(S.plannerHideDone ? 'بلوک‌های انجام‌شده پنهان شدند' : 'همه بلوک‌ها نمایش داده می‌شوند'); });
    onTap($('#addBlockBtn'), function () { blockSheet(null, sel); });
    var addLabel = byText('#addBlockBtn span', 'New Time Block'); if (addLabel) addLabel.textContent = 'بلوک زمانی جدید';
    onTap(track, function (e) {
      var r = track.getBoundingClientRect(); var ratio = (r.right - e.clientX) / r.width; // RTL? timeline is LTR visually
      ratio = (e.clientX - r.left) / r.width;
      var min = Math.round((6 * 60 + ratio * 18 * 60) / 15) * 15; var hh = pad(Math.floor(min / 60)), mm = pad(min % 60);
      blockSheet(null, sel, hh + ':' + mm);
    });
    function cardFor(b) {
      var c = tplCard.cloneNode(true); var col = BLOCK_COLORS[b.color] || BLOCK_COLORS.terracotta;
      var chk = c.querySelector('.task-check');
      if (b.done) { chk.classList.remove('bg-surface', 'text-text-muted'); chk.classList.add('bg-chart-sage', 'text-on-secondary'); chk.className = chk.className.replace(/shadow-\[[^\]]*\]/, 'shadow-[inset_2px_2px_5px_rgba(0,0,0,0.18),inset_-2px_-2px_4px_#ffffff]'); c.classList.add('opacity-70'); }
      else { var ic = chk.querySelector('.check-icon'); if (ic) ic.classList.add('opacity-30'); }
      var title = c.querySelector('.font-title-md'); title.textContent = b.title; if (b.done) title.classList.add('line-through');
      title.nextElementSibling.className = 'w-2 h-2 rounded-full ' + col.dot;
      c.querySelector('.font-label-md').textContent = fa(b.start) + ' تا ' + fa(b.end);
      var right = c.lastElementChild; right.innerHTML = '';
      var icn = document.createElement('div'); icn.className = 'w-7 h-7 rounded-full bg-surface-subtle flex items-center justify-center text-text-muted';
      icn.innerHTML = '<span class="material-symbols-outlined text-[16px]">' + (b.notify ? 'notifications_active' : (b.icon || BLOCK_ICONS[b.color] || 'event')) + '</span>';
      if (b.notify) icn.classList.add('text-chart-terracotta');
      var ed = document.createElement('button'); ed.className = 'w-9 h-9 rounded-full bg-surface-container-low clay-outset flex items-center justify-center text-text-muted active:scale-95 transition-all'; ed.setAttribute('aria-label', 'گزینه‌ها'); ed.innerHTML = '<span class="material-symbols-outlined text-[18px]">edit</span>';
      right.appendChild(icn); right.appendChild(ed);
      onTap(chk, function () { b.done = !b.done; save(); render(); if (b.done) toast('«' + b.title + '» انجام شد'); });
      onTap(icn, function () { b.notify = !b.notify; b.notified = false; save(); render(); toast(b.notify ? 'یادآور شروع بلوک فعال شد' : 'یادآور خاموش شد'); if (b.notify) askNotif(); });
      onTap(ed, function () { blockMenu(b); });
      onTap(c.querySelector('.flex.flex-col'), function () { blockSheet(b.id); });
      return c;
    }
    function blockMenu(b) {
      menu(b.title, [
        { icon: 'edit', label: 'ویرایش', run: function () { blockSheet(b.id); } },
        { icon: b.notify ? 'notifications_off' : 'notifications_active', label: b.notify ? 'خاموش کردن یادآور' : 'یادآوری هنگام شروع', run: function () { b.notify = !b.notify; b.notified = false; save(); render(); if (b.notify) askNotif(); } },
        { icon: 'content_copy', label: 'کپی برای روز بعد', run: function () { var c = JSON.parse(JSON.stringify(b)); c.id = uid(); c.done = false; c.notified = false; c.date = iso(addDays(parseIso(b.date), 1)); S.blocks.push(c); save(); render(); toast('برای ' + faDayMonth(parseIso(c.date)) + ' کپی شد'); } },
        { icon: 'add_task', label: 'افزودن به فهرست کارها', run: function () { S.tasks.push({ id: uid(), title: b.title, date: b.date, time: b.start, category: 'work', starred: false, done: b.done, archived: false, reminder: false, note: 'از برنامه‌ریز' }); save(); toast('به کارها اضافه شد'); } },
        { icon: 'delete', label: 'حذف', danger: true, run: function () { var i = S.blocks.indexOf(b); S.blocks.splice(i, 1); save(); render(); toast('بلوک حذف شد', { label: 'واگرد', run: function () { S.blocks.splice(i, 0, b); save(); render(); } }); } }
      ], faDayMonth(parseIso(b.date)) + ' • ' + fa(b.start) + ' تا ' + fa(b.end));
    }
    function render() {
      var ws = addDays(weekStart(new Date()), weekOffset * 7);
      navRow.children[1].textContent = weekOffset === 0 ? 'این هفته' : faDayMonth(ws) + ' تا ' + faDayMonth(addDays(ws, 6));
      dayBtns.forEach(function (btn, i) {
        var d = addDays(ws, i), k = iso(d), on = k === sel, has = S.blocks.some(function (b) { return b.date === k; });
        btn.className = on ? activeCls : idleCls;
        var sp = btn.children; sp[0].textContent = WD_SHORT[d.getDay()]; sp[1].textContent = faDayNum(d);
        sp[2].className = 'w-1.5 h-1.5 rounded-full ' + (has ? (on ? 'bg-chart-terracotta' : 'bg-chart-sage') : 'bg-transparent');
        if (k === today() && !on) sp[1].classList.add('text-chart-terracotta');
        btn.onclick = function () { sel = k; render(); };
      });
      if (S.plannerHideDone) { knob.classList.add('translate-x-6'); toggle.classList.add('bg-chart-sage/30'); } else { knob.classList.remove('translate-x-6'); toggle.classList.remove('bg-chart-sage/30'); }
      // timeline 06:00–24:00
      var blocks = S.blocks.filter(function (b) { return b.date === sel; }).sort(function (a, b) { return hmToMin(a.start) - hmToMin(b.start); });
      $$(':scope > :not(#timelineKnob)', track).forEach(function (n) { n.remove(); });
      track.style.position = 'relative'; track.style.direction = 'ltr';
      blocks.forEach(function (b) {
        var s = Math.max(0, hmToMin(b.start) - 360), e = Math.min(1080, Math.max(s + 10, hmToMin(b.end) - 360)); var col = BLOCK_COLORS[b.color] || BLOCK_COLORS.terracotta;
        var seg = document.createElement('div'); seg.className = 'absolute top-1 bottom-1 rounded-full flex items-center justify-center text-white overflow-hidden ' + col.bg + (b.done ? ' opacity-50' : '');
        seg.style.left = (s / 1080 * 100) + '%'; seg.style.width = ((e - s) / 1080 * 100) + '%';
        seg.innerHTML = '<span class="material-symbols-outlined text-[14px]">' + (b.icon || BLOCK_ICONS[b.color]) + '</span>'; seg.title = b.title + ' ' + b.start + '–' + b.end;
        seg.addEventListener('click', function (ev) { ev.stopPropagation(); blockMenu(b); });
        track.insertBefore(seg, knobTl);
      });
      var nm = hmToMin(nowHM()) - 360;
      knobTl.style.display = sel === today() && nm >= 0 && nm <= 1080 ? '' : 'none';
      knobTl.style.left = 'calc(' + (nm / 1080 * 100) + '% - 6px)'; knobTl.style.right = 'auto';
      if (stamps) { var st = stamps.children; ['06:00', '12:00', '18:00', '24:00'].forEach(function (x, i) { if (st[i]) st[i].textContent = fa(x); }); stamps.style.direction = 'ltr'; }
      // cards
      cardWrap.innerHTML = '';
      var vis = blocks.filter(function (b) { return !(S.plannerHideDone && b.done); });
      vis.forEach(function (b) { cardWrap.appendChild(cardFor(b)); });
      if (!vis.length) cardWrap.innerHTML = '<div class="w-full text-center text-text-muted font-body-md py-6 rounded-xl bg-surface-subtle">' + (blocks.length ? 'همه بلوک‌های این روز انجام شده‌اند' : 'برای ' + (sel === today() ? 'امروز' : faDayMonth(parseIso(sel))) + ' بلوکی ثبت نشده') + '</div>';
    }
    renderers.push(render); render();
    setInterval(function () { clock.textContent = nowHM(); }, 15000); clock.textContent = nowHM();
  };
  function blockSheet(id, date, start) {
    var b = id ? S.blocks.find(function (x) { return x.id === id; }) : null;
    var st = b ? b.start : start || (function () { var m = Math.ceil((hmToMin(nowHM()) + 1) / 30) * 30; m = Math.min(m, 22 * 60); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); })();
    var en_ = b ? b.end : (function () { var m = Math.min(hmToMin(st) + 60, 23 * 60 + 59); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); })();
    form({
      title: b ? 'ویرایش بلوک زمانی' : 'بلوک زمانی جدید',
      fields: [
        { name: 'title', label: 'عنوان', value: b ? b.title : '', placeholder: 'مثلاً کار روی پروژه' },
        { name: 'date', label: 'تاریخ', type: 'date', value: b ? b.date : date || today() },
        { name: 'start', label: 'شروع', type: 'time', value: st, row: 'a' },
        { name: 'end', label: 'پایان', type: 'time', value: en_, row: 'a' },
        { name: 'color', label: 'نوع', type: 'chips', value: b ? b.color : 'terracotta', options: Object.keys(BLOCK_COLORS).map(function (k) { return { value: k, label: BLOCK_COLORS[k].label, icon: BLOCK_ICONS[k] }; }) },
        { name: 'notify', label: 'یادآوری هنگام شروع', type: 'switch', value: b ? b.notify : false }
      ],
      extra: b ? [{ label: 'حذف', cls: 'danger', run: function () { var i = S.blocks.indexOf(b); S.blocks.splice(i, 1); save(); refresh(); toast('بلوک حذف شد'); } }] : [],
      onSubmit: function (v) {
        var title = (v.title || '').trim(); if (!title) { toast('عنوان را وارد کنید'); return false; }
        if (!v.start || !v.end || hmToMin(v.end) <= hmToMin(v.start)) { toast('زمان پایان باید بعد از شروع باشد'); return false; }
        var clash = S.blocks.find(function (x) { return x !== b && x.date === v.date && hmToMin(v.start) < hmToMin(x.end) && hmToMin(v.end) > hmToMin(x.start); });
        var o = b || { id: uid(), done: false };
        o.title = title; o.date = v.date || today(); o.start = v.start; o.end = v.end; o.color = v.color; o.icon = BLOCK_ICONS[v.color]; o.notify = !!v.notify; o.notified = false;
        if (!b) S.blocks.push(o); save(); refresh();
        toast(clash ? 'ذخیره شد — با «' + clash.title + '» هم‌پوشانی دارد' : (b ? 'بلوک ویرایش شد' : 'بلوک اضافه شد'));
        if (o.notify) askNotif();
      }
    });
  }

  /* ===== Wallet ===== */
  var QUICK_SETS = [['shopping', 'bills', 'cafe'], ['food', 'transport', 'sport'], ['travel', 'health', 'other']];
  P['wallet-finance'] = function () {
    var hero = $('#heroBalanceText'), cur = hero.nextElementSibling, priv = $('#privacyToggleBtn');
    onTap(priv, function () { S.privacy = !S.privacy; save(); refresh(); toast(S.privacy ? 'مبالغ پنهان شد' : 'مبالغ نمایش داده شد'); });
    onTap($('#walletVaultBtn'), function () { historySheet(null, 'همه تراکنش‌ها'); });
    onTap($('#calPillBtn'), function () { historySheet(function (t) { return t.date === today(); }, 'تراکنش‌های امروز'); });
    onTap($('#clockPillBtn'), function () { go('planner-calendar'); });
    onTap($('#trendBadgeBtn'), reportSheet);
    onTap($('#actionSend'), function () { txSheet('expense', { title: 'ارسال / پرداخت', category: 'other', noteLabel: 'به چه کسی / بابت چه', sub: 'مبلغ از موجودی کم می‌شود.' }); });
    onTap($('#actionReceive'), function () { txSheet('income', { title: 'دریافت پول', category: 'transfer', noteLabel: 'از چه کسی / بابت چه' }); });
    onTap($('#actionAdd'), newTxMenu);
    onTap($('#actionScan'), scanReceipt);
    var mt = $('#masterStatusToggle'), mk = $('#toggleKnob');
    if (mt) { onTap(mt, function () { S.wallet.alerts = !S.wallet.alerts; save(); refresh(); toast(S.wallet.alerts ? 'هشدار بودجه روشن شد' : 'هشدار بودجه خاموش شد'); }); mt.title = 'هشدار بودجه'; }
    // income / expense pods
    var pods = $$('section .grid.grid-cols-2 > .neu-pressed');
    var podVals = pods.map(function (p, i) {
      var box = p.lastElementChild; box.innerHTML = '<span class="text-[10px] text-text-muted font-label-sm"></span><span class="font-title-md text-[15px] font-bold"></span>';
      box.firstChild.textContent = i === 0 ? 'درآمد این ماه' : 'هزینه این ماه'; box.lastChild.classList.add(i === 0 ? 'text-chart-sage' : 'text-chart-terracotta');
      onTap(p, function () { historySheet(function (t) { return t.type === (i === 0 ? 'income' : 'expense') && monthKey(t.date) === monthKey(today()); }, i === 0 ? 'درآمدهای این ماه' : 'هزینه‌های این ماه'); });
      return box.lastChild;
    });
    // chart
    var range = '7d', tabs = $$('.chart-tab'); var tabOn = (tabs.find(function (t) { return t.classList.contains('neu-raised-sm'); }) || tabs[0]).className, tabOff = (tabs.find(function (t) { return !t.classList.contains('neu-raised-sm'); }) || tabs[1]).className;
    tabs.forEach(function (t) { onTap(t, function () { range = t.getAttribute('data-range'); render(); toast(range === '7d' ? 'هزینه ۷ روز اخیر' : 'هزینه ۳۰ روز اخیر (هر ستون ۵ روز)'); }); });
    var barsBox = $('#chartBarsContainer'), colTpl = $('.chart-bar-col', barsBox).cloneNode(true), tip = $('#chartTooltip');
    var tipTimer;
    // budget slider
    var sTrack = $('#sliderTrack'), sProg = $('#sliderProgress'), sThumb = $('#sliderThumb'), sPill = $('#sliderValuePill');
    var sliderSection = sTrack.closest('section'); onTap(sliderSection, budgetSheet);
    var sLabel = document.createElement('span'); sLabel.className = 'font-label-md text-[12px] text-text-muted mr-2'; sPill.parentElement.firstElementChild.appendChild(sLabel);
    // quick category cards
    var qWrap = $('#liveIconCards'), qCards = $$('.live-card', qWrap);
    onTap($('#shuffleCardsBtn'), function () { S.wallet.quickSet = (S.wallet.quickSet + 1) % QUICK_SETS.length; save(); render(); toast('دسته‌های سریع عوض شد'); });
    var qHead = $('#shuffleCardsBtn').parentElement.firstElementChild; var qTitle = document.createElement('span'); qTitle.className = 'font-title-md text-[14px] text-text-primary mr-1'; qTitle.textContent = 'ثبت سریع هزینه'; qHead.appendChild(qTitle);
    // recent transactions section
    var recent = document.createElement('section'); recent.className = 'w-full neu-raised rounded-3xl p-4 flex flex-col gap-2';
    recent.innerHTML = '<div class="flex items-center justify-between mb-1"><span class="font-title-md text-[15px] font-bold text-text-primary">تراکنش‌های اخیر</span><button class="font-label-md text-[12px] text-chart-terracotta font-bold">همه</button></div><div class="flex flex-col gap-2" data-recent></div>';
    onTap(recent.querySelector('button'), function () { historySheet(null, 'همه تراکنش‌ها'); });
    function render() {
      var bal = balance();
      hero.textContent = S.privacy ? '••••••' : Math.abs(bal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (bal < 0 && !S.privacy) hero.textContent = '-' + hero.textContent;
      cur.textContent = S.profile.currency === 'تومان' ? 'ت' : S.profile.currency;
      priv.querySelector('.material-symbols-outlined').textContent = S.privacy ? 'visibility_off' : 'visibility';
      podVals[0].textContent = money(monthSum('income'), S.privacy); podVals[1].textContent = money(monthSum('expense'), S.privacy);
      var exp = monthSum('expense'), prev = monthSum('expense', prevMonthKey()), tb = $('#trendBadgeBtn');
      var diff = prev ? Math.round((exp - prev) / prev * 100) : null;
      tb.innerHTML = '<span class="material-symbols-outlined text-[16px]">' + (diff != null && diff > 0 ? 'trending_up' : 'trending_down') + '</span><span class="text-[12px] font-bold mr-1">' + (diff == null ? 'گزارش' : fa(Math.abs(diff)) + '٪') + '</span>';
      tb.title = 'هزینه نسبت به ماه قبل';
      if (mt) { mt.dataset.checked = S.wallet.alerts; mk.style.transform = S.wallet.alerts ? 'translateX(0)' : 'translateX(-26px)'; mk.classList.toggle('bg-[#8EAA97]', S.wallet.alerts); mk.classList.toggle('bg-gray-400', !S.wallet.alerts); }
      // chart
      tabs.forEach(function (t) { t.className = t.getAttribute('data-range') === range ? tabOn : tabOff; });
      var cols = [], now = new Date();
      if (range === '7d') for (var i = 6; i >= 0; i--) { var d = addDays(now, -i); cols.push({ v: daySpend(iso(d)), label: faDayMonth(d), short: WD_SHORT[d.getDay()] }); }
      else for (var g = 5; g >= 0; g--) { var v = 0; for (var k = 0; k < 5; k++) v += daySpend(iso(addDays(now, -(g * 5 + k)))); cols.push({ v: v, label: faDayMonth(addDays(now, -(g * 5 + 4))) + ' تا ' + faDayMonth(addDays(now, -g * 5)) }); }
      var max = Math.max.apply(null, cols.map(function (c) { return c.v; }).concat([1]));
      barsBox.innerHTML = '';
      cols.forEach(function (c, i) {
        var col = colTpl.cloneNode(true), bar = col.querySelector('.bar-anim'), dot = col.querySelector('span');
        var last = i === cols.length - 1;
        bar.style.height = Math.max(6, Math.round(c.v / max * 92)) + '%';
        bar.className = bar.className.replace(/bg-chart-terracotta|bg-\[#8EAA97\]\/80|shadow-\[0_2px_10px_rgba\(222,131,83,0\.5\)\]/g, '') + (last ? ' bg-chart-terracotta' : ' bg-[#8EAA97]/80');
        dot.className = last ? 'w-2 h-2 rounded-full bg-chart-terracotta' : 'w-1.5 h-1.5 rounded-full bg-[#8EAA97]/40';
        col.style.cursor = 'pointer';
        col.onclick = function () { tip.textContent = c.label + ': ' + money(c.v, S.privacy); tip.style.opacity = '1'; clearTimeout(tipTimer); tipTimer = setTimeout(function () { tip.style.opacity = '0'; }, 2200); $$('.bar-anim', barsBox).forEach(function (x) { x.style.opacity = '.45'; }); bar.style.opacity = '1'; setTimeout(function () { $$('.bar-anim', barsBox).forEach(function (x) { x.style.opacity = ''; }); }, 2200); };
        barsBox.appendChild(col);
      });
      tip.style.opacity = '0'; tip.style.whiteSpace = 'nowrap';
      // budget
      var used = S.wallet.budget ? exp / S.wallet.budget * 100 : 0, w = Math.max(3, Math.min(100, used));
      sProg.style.width = w + '%'; sThumb.style.left = 'calc(' + (100 - w) + '% - 12px)';
      sPill.textContent = fa(Math.round(used)) + '%'; sPill.style.color = used >= 100 ? '#c2410c' : '';
      sLabel.textContent = 'بودجه ماه: ' + money(exp, S.privacy) + ' از ' + money(S.wallet.budget, S.privacy);
      // quick cards
      var set = QUICK_SETS[S.wallet.quickSet] || QUICK_SETS[0];
      var mkey = monthKey(today());
      qCards.forEach(function (card, i) {
        var key = set[i], c = TXCAT[key], spent = S.tx.filter(function (t) { return t.type === 'expense' && t.category === key && monthKey(t.date) === mkey; }).reduce(function (s, t) { return s + t.amount; }, 0);
        card.querySelector('.material-symbols-outlined').textContent = c.icon;
        var line = card.lastElementChild; line.innerHTML = '<div style="height:100%;border-radius:9px;background:#DE8353;width:' + (exp ? Math.round(spent / exp * 100) : 0) + '%"></div>';
        var lbl = card.querySelector('[data-lbl]'); if (!lbl) { lbl = document.createElement('span'); lbl.setAttribute('data-lbl', ''); lbl.className = 'font-label-sm text-[10px] text-text-muted mt-1'; card.appendChild(lbl); }
        lbl.textContent = c.label + ' • ' + money(spent, S.privacy);
        card.style.cursor = 'pointer';
        card.onclick = function () { txSheet('expense', { category: key, title: 'هزینه ' + c.label }); };
      });
      // recent
      var rec = S.tx.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).slice(0, 5);
      var box = recent.querySelector('[data-recent]'); box.innerHTML = '';
      if (!rec.length) box.innerHTML = '<div class="text-center text-text-muted text-[13px] py-3">تراکنشی ثبت نشده — از دکمه + شروع کنید</div>';
      rec.forEach(function (t) {
        var c = TXCAT[t.category] || TXCAT.other, r = document.createElement('div');
        r.className = 'flex items-center gap-3 p-2.5 rounded-2xl neu-pressed-sm cursor-pointer';
        r.innerHTML = '<div class="w-9 h-9 rounded-xl neu-raised-sm flex items-center justify-center text-text-muted"><span class="material-symbols-outlined text-[18px]">' + c.icon + '</span></div><div class="flex-1 min-w-0"><div class="text-[13px] font-bold text-text-primary truncate"></div><div class="text-[11px] text-text-muted"></div></div><div class="text-[13px] font-bold" dir="ltr"></div>';
        r.children[1].firstChild.textContent = t.note || c.label; r.children[1].lastChild.textContent = c.label + ' • ' + faDayMonth(parseIso(t.date));
        r.lastChild.textContent = (t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : '−') + money(t.amount, S.privacy); r.lastChild.className += t.type === 'income' ? ' text-chart-sage' : t.type === 'transfer' ? ' text-text-muted' : ' text-chart-terracotta';
        if (t.type === 'transfer') r.children[1].lastChild.textContent = txLabel(t) + ' • ' + faDayMonth(parseIso(t.date));
        r.onclick = function () { txSheet(null, null, t.id); };
        box.appendChild(r);
      });
    }
    renderers.push(render); render();
    var accR = accountingSection($('#actionSend').closest('section'), { chart: $('#chartBarsContainer').closest('section'), budget: $('#sliderTrack').closest('section'), quick: $('#liveIconCards').closest('section') }); renderers.push(accR); accR();
    var clock = $('#liveClock'); setInterval(function () { clock.textContent = nowHM(); }, 10000); clock.textContent = nowHM();
  };
  function scanReceipt() {
    pickFile('image/*', true, function (file) {
      var close = infoSheet('اسکن رسید', '<p class="ui-sub"><span class="material-symbols-outlined spin" style="font-size:16px;vertical-align:middle">progress_activity</span> در حال خواندن رسید…</p>');
      askVision(file, 'This is a photo of a purchase receipt or invoice (possibly Persian/Farsi). Extract the total amount paid. Reply with only JSON: {"amount": number, "merchant": string, "category": one of ["shopping","food","cafe","bills","transport","sport","travel","health","other"], "date": "YYYY-MM-DD" or null}. Write merchant in the receipt language.')
        .then(function (r) {
          close();
          setTimeout(function () { txSheet('expense', { title: 'تأیید رسید اسکن‌شده', sub: 'مقادیر را بررسی و در صورت نیاز اصلاح کنید.', amount: r && r.amount || '', category: r && EXP_CATS.indexOf(r.category) >= 0 ? r.category : 'shopping', note: r && r.merchant || '' }); }, 220);
        })
        .catch(function (e) {
          close();
          setTimeout(function () { txSheet('expense', { title: 'ثبت رسید', sub: e && e.code === 'not_granted' ? 'اجازه استفاده از هوش مصنوعی داده نشد؛ مبلغ را دستی وارد کنید.' : 'خواندن خودکار رسید در دسترس نبود؛ مبلغ را دستی وارد کنید.', category: 'shopping' }); }, 220);
        });
    });
  }

  /* ===== Gym ===== */
  P.gym = function () {
    var G = S.gym;
    var title = byText('span', 'برنامه و باشگاه'); var subtitle = title && title.nextElementSibling;
    var streakEl = byText('span', 'روز پیاپی');
    var topTabs = $$('button', byText('div.flex.items-center.gap-2', 'برنامه تمرینی')); topTabs = topTabs.filter(function (b) { return /برنامه تمرینی|کالری و تغذیه|پایش وزن|آنالیز/.test(b.textContent); });
    // icon-only top tabs (label kept as tooltip / screen-reader text)
    var iconOnly = function (c) { return c.replace(/\bpx-3\.5\b/, 'px-0').replace(/\bpy-2\b/, 'py-3') + ' flex-1 justify-center'; };
    topTabs.forEach(function (b) {
      var ic = b.querySelector('.material-symbols-outlined'), label = b.textContent.replace(ic ? ic.textContent : '', '').trim();
      b.setAttribute('aria-label', label); b.title = label;
      $$(':scope > span', b).forEach(function (sp) { if (sp !== ic) sp.remove(); });
      if (ic) { ic.classList.remove('text-[16px]'); ic.classList.add('text-[24px]'); }
    });
    var tabRow = topTabs[0].parentElement; tabRow.classList.remove('overflow-x-auto'); tabRow.classList.add('justify-between');
    var topOn = iconOnly(topTabs[0].className), topOff = iconOnly(topTabs[1].className);
    var dailyBtn = $('#tab-daily'), weeklyBtn = $('#tab-weekly'); var segOn = weeklyBtn.className, segOff = dailyBtn.className; var seg = dailyBtn.parentElement;
    var sessCard = $('#gym-session-card'); var listEl = $('#gym-exercises-list'); var addBtn = byText('button', 'افزودن حرکت جدید', sessCard);
    var sessTitle = sessCard.querySelector('h2'); var timerIcon = $$('span.material-symbols-outlined', sessCard).find(function (x) { return x.textContent.trim() === 'timer'; }); var timerPill = timerIcon && timerIcon.parentElement;
    var progLabel = $('#gym-progress-label'), progBar = $('#gym-progress-bar');
    var calCard = byText('span', 'کالری مصرفی روزانه').closest('.rounded-3xl');
    var scanCard = byText('h3', 'اسکن هوشمند').closest('.rounded-3xl');
    var wCard = byText('h3', 'ثبت وزن').closest('.rounded-3xl');
    // weekly plan card (built)
    var weekCard = document.createElement('div'); weekCard.className = sessCard.className; weekCard.style.display = 'none'; sessCard.after(weekCard);
    // finish button inside session card
    var finBtn = addBtn.cloneNode(true); finBtn.className = finBtn.className.replace('text-chart-terracotta', 'text-chart-sage').replace('mt-4', 'mt-3'); finBtn.querySelector('.material-symbols-outlined').textContent = 'flag'; addBtn.after(finBtn);
    var loadBtn = addBtn.cloneNode(true); loadBtn.className = loadBtn.className.replace('text-chart-terracotta', 'text-text-muted').replace('mt-4', 'mt-3'); loadBtn.querySelector('.material-symbols-outlined').textContent = 'event_repeat'; finBtn.after(loadBtn);
    // analysis card (built)
    var anCard = document.createElement('div'); anCard.className = wCard.className; wCard.after(anCard);
    var tab = G.tab || 'workout';
    topTabs.forEach(function (b, i) { var key = ['workout', 'calorie', 'weight', 'analysis'][i]; onTap(b, function () { tab = key; G.tab = key; save(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); });
    onTap(dailyBtn, function () { G.view = 'daily'; save(); render(); });
    onTap(weeklyBtn, function () { G.view = 'weekly'; save(); render(); });
    onTap(addBtn, function () { exerciseSheet(); });
    onTap(finBtn, function () { var s = session(today()); if (!s || !s.exercises.length) { toast('اول حرکتی اضافه کنید'); return; } if (s.finished) { s.finished = false; save(); refresh(); toast('جلسه دوباره باز شد'); return; } var st = setsOf(s); confirmBox('پایان جلسه امروز؟', 'ست‌های انجام‌شده: ' + fa(st.done) + ' از ' + fa(st.tot) + ' • زمان: ' + fa(sessionMinutes(s)) + ' دقیقه', 'ثبت پایان', finishSession); });
    onTap(loadBtn, function () { loadFromPlan(); });
    onTap(sessTitle, function () { var s = session(today(), true); form({ title: 'نام جلسه امروز', fields: [{ name: 'n', label: 'نام', value: s.name }, { name: 't', label: 'زمان هدف (دقیقه)', type: 'number', value: s.target || 45 }], onSubmit: function (v) { s.name = (v.n || '').trim() || s.name; s.target = Math.max(5, num(v.t)) || 45; save(); refresh(); } }); });
    if (timerPill) onTap(timerPill, function () {
      var s = session(today(), true);
      if (S.gym.timerStart) { s.minutes = (s.minutes || 0) + (Date.now() - S.gym.timerStart) / 60000; S.gym.timerStart = null; toast('زمان‌سنج متوقف شد: ' + fa(Math.round(s.minutes)) + ' دقیقه'); }
      else { S.gym.timerStart = Date.now(); s.finished = false; toast('زمان‌سنج تمرین شروع شد'); }
      save(); refresh();
    });
    // calories
    onTap(byText('button', 'ثبت دستی', calCard), function () { mealSheet(); });
    var goalTxt = byText('span', 'هدف ثابت', calCard); onTap(goalTxt, goalsSheet);
    var consumedEl = $('#calorie-consumed'); var goalOf = consumedEl.nextElementSibling; var leftEl = consumedEl.parentElement.nextElementSibling;
    var gauge = consumedEl.parentElement.parentElement.nextElementSibling.firstElementChild;
    var macroBoxes = $$('.grid.grid-cols-3 > div', calCard);
    var mealList = document.createElement('div'); mealList.className = 'flex flex-col gap-2'; calCard.appendChild(mealList);
    macroBoxes.forEach(function (b) { onTap(b, goalsSheet); });
    // scanner
    var drop = scanCard.querySelector('[onclick^="simulatePhotoScan"]') || byText('div', 'انتخاب یا گرفتن عکس', scanCard);
    var aiCard = $('#ai-scan-card'), aiImg = aiCard.querySelector('img'), aiName = byText('span', 'سینه مرغ', aiCard), aiKcal = aiCard.querySelector('.text-left .font-headline-md') || aiCard.querySelector('.text-left span'), aiMac = $$('strong', aiCard), aiBtn = $('#add-scanned-btn'), aiTag = byText('span', 'تشخیص هوشمند', aiCard);
    onTap(drop, scanFood); onTap(aiBtn, function () { var r = G.lastScan; if (!r || r.added) { scanFood(); return; } addMeal({ name: r.name, kcal: r.kcal, p: r.p, c: r.c, f: r.f }); r.added = true; save(); refresh(); toast(fa(r.kcal) + ' کالری به امروز اضافه شد'); });
    onTap(aiName.parentElement.parentElement, function () { var r = G.lastScan; if (!r) return; form({ title: 'اصلاح نتیجه اسکن', fields: [{ name: 'name', label: 'غذا', value: r.name }, { name: 'kcal', label: 'کالری', type: 'number', value: r.kcal, row: '3a' }, { name: 'p', label: 'پروتئین g', type: 'number', value: r.p, row: '3b' }, { name: 'c', label: 'کربو g', type: 'number', value: r.c, row: '3b' }, { name: 'f', label: 'چربی g', type: 'number', value: r.f, row: '3b' }], onSubmit: function (v) { r.name = v.name || r.name; r.kcal = num(v.kcal); r.p = num(v.p); r.c = num(v.c); r.f = num(v.f); save(); refresh(); } }); });
    // weight
    onTap(byText('button', 'ثبت جدید', wCard), weightSheet);
    var steppers = $$('button', wCard).filter(function (b) { var t = b.textContent.trim(); return t === 'remove' || t === 'add'; });
    steppers.forEach(function (b) { var delta = b.textContent.trim() === 'add' ? 0.1 : -0.1; onTap(b, function () { var lw = lastWeight(); var base = lw ? lw.kg : 75; var ex = G.weights.find(function (w) { return w.date === today(); }); if (!ex) { ex = { date: today(), kg: base }; G.weights.push(ex); } ex.kg = Math.round((ex.kg + delta) * 10) / 10; save(); refresh(); }); });
    var curW = $('#current-weight-val');
    var trendBoxes = $$('.grid.grid-cols-2 > div', wCard);
    var spark = byText('span', 'روند ۷ روز گذشته', wCard).closest('.rounded-2xl'); var sparkBars = $$('.flex-1', spark); var sparkStatus = byText('span', 'پایدار', spark);
    onTap(curW.parentElement.parentElement, weightHistory); onTap(spark, weightHistory);

    function exRow(e, idx) {
      var s = session(today()); var full = e.done >= e.sets, started = e.done > 0 && !full;
      var row = document.createElement('div');
      row.className = started ? 'w-full p-4 rounded-2xl bg-surface-container-lowest shadow-[-5px_-5px_12px_#ffffff,5px_5px_12px_#d5cfc1] flex flex-col gap-3' : 'w-full p-3.5 rounded-2xl bg-surface-container-low shadow-[-4px_-4px_10px_#ffffff,4px_4px_10px_#dcd5c9] flex flex-col gap-2.5';
      var btnCls = full ? 'w-8 h-8 rounded-xl bg-chart-sage text-on-primary flex items-center justify-center shadow-[-2px_-2px_6px_#ffffff,2px_2px_6px_#c8c0b2] transition-transform active:scale-90 flex-shrink-0' : 'w-8 h-8 rounded-xl bg-surface-subtle shadow-[inset_2px_2px_4px_#d8d1c3,inset_-2px_-2px_4px_#ffffff] ' + (started ? 'text-chart-terracotta' : 'text-text-muted') + ' flex items-center justify-center transition-transform active:scale-90 flex-shrink-0';
      var status = full ? '<span class="px-2 py-0.5 rounded-lg bg-surface-subtle text-chart-sage font-label-sm text-label-sm font-bold shadow-[inset_1px_1px_3px_#ded7ca,inset_-1px_-1px_3px_#ffffff]">تکمیل</span>' : started ? '<span class="px-2 py-0.5 rounded-lg bg-secondary-container/40 text-secondary font-label-sm text-label-sm font-bold">درحال انجام</span>' : '<span class="px-2 py-0.5 rounded-lg bg-surface-subtle text-text-muted font-label-sm text-label-sm">' + (idx === firstPending() ? 'بعدی' : 'در صف') + '</span>';
      row.innerHTML = '<div class="flex items-center justify-between gap-3"><div class="flex items-center gap-3 min-w-0"><button class="' + btnCls + '" aria-label="انجام همه ست‌ها"><span class="material-symbols-outlined text-[18px]' + (started ? ' opacity-60' : '') + '">' + (full ? 'done' : started ? 'fitness_center' : 'hourglass_empty') + '</span></button><div class="flex flex-col min-w-0" data-edit><span class="font-title-md text-title-md ' + (full ? 'text-text-muted line-through' : 'text-text-primary') + ' truncate"></span><span class="font-label-sm text-label-sm text-text-muted"></span></div></div><div class="flex items-center gap-1.5 flex-shrink-0">' + status + '<button class="w-7 h-7 rounded-lg text-text-muted flex items-center justify-center" aria-label="گزینه‌ها"><span class="material-symbols-outlined text-[18px]">more_vert</span></button></div></div><div class="flex items-center gap-2 flex-wrap" data-sets><span class="font-label-sm text-label-sm text-text-muted ml-1">ست‌ها:</span></div>';
      var info = row.querySelector('[data-edit]'); info.firstChild.textContent = e.name; info.lastChild.textContent = fa(e.sets) + ' ست × ' + fa(e.reps) + ' ' + (e.unit || 'تکرار') + (e.weight ? ' • ' + e.weight : '');
      var setsBox = row.querySelector('[data-sets]');
      for (var i = 0; i < e.sets; i++) (function (i) {
        var on = i < e.done, chip = document.createElement('button');
        chip.className = on ? 'px-3 py-1 rounded-xl bg-chart-sage text-on-primary font-label-md text-label-md font-bold shadow-[-2px_-2px_5px_#ffffff,2px_2px_5px_#d0c8b9] transition-transform active:scale-95' : 'px-3 py-1 rounded-xl bg-surface-subtle text-chart-terracotta font-label-md text-label-md font-bold shadow-[inset_2px_2px_4px_#d6cebf,inset_-2px_-2px_4px_#ffffff] transition-transform active:scale-95';
        chip.textContent = 'ست ' + fa(i + 1) + (on ? ' ✓' : '');
        onTap(chip, function () { e.done = i < e.done ? i : i + 1; startIfIdle(); save(); refresh(); if (e.done >= e.sets) toast('«' + e.name + '» کامل شد'); });
        setsBox.appendChild(chip);
      })(i);
      onTap(row.querySelector('button[aria-label="انجام همه ست‌ها"]'), function () { e.done = full ? 0 : e.sets; startIfIdle(); save(); refresh(); });
      onTap(row.querySelector('button[aria-label="گزینه‌ها"]'), function () { exMenu(e); });
      onTap(info, function () { exerciseSheet(e.id); });
      return row;
      function firstPending() { var l = s.exercises; for (var k = 0; k < l.length; k++) if (l[k].done < l[k].sets) return k; return -1; }
    }
    function startIfIdle() { var s = session(today()); if (s && !S.gym.timerStart && !s.minutes && !s.finished) { S.gym.timerStart = Date.now(); toast('زمان‌سنج تمرین خودکار شروع شد'); } }
    function exMenu(e) {
      var s = session(today()), i = s.exercises.indexOf(e);
      menu(e.name, [
        { icon: 'edit', label: 'ویرایش', run: function () { exerciseSheet(e.id); } },
        { icon: 'restart_alt', label: 'صفر کردن ست‌ها', run: function () { e.done = 0; save(); refresh(); } },
        i > 0 && { icon: 'arrow_upward', label: 'انتقال به بالا', run: function () { s.exercises.splice(i, 1); s.exercises.splice(i - 1, 0, e); save(); refresh(); } },
        i < s.exercises.length - 1 && { icon: 'arrow_downward', label: 'انتقال به پایین', run: function () { s.exercises.splice(i, 1); s.exercises.splice(i + 1, 0, e); save(); refresh(); } },
        { icon: 'delete', label: 'حذف حرکت', danger: true, run: function () { s.exercises.splice(i, 1); save(); refresh(); toast('حرکت حذف شد', { label: 'واگرد', run: function () { s.exercises.splice(i, 0, e); save(); refresh(); } }); } }
      ]);
    }
    function loadFromPlan() {
      var p = G.weekly[new Date().getDay()];
      if (!p || !p.items || !parsePlan(p.items).length) { toast('برای امروز (' + WD_LONG[new Date().getDay()] + ') برنامه هفتگی تعریف نشده'); G.view = 'weekly'; save(); render(); return; }
      var s = session(today(), true), items = parsePlan(p.items), go_ = function () { s.name = p.name || s.name; s.exercises = items.map(function (x) { x.id = uid(); x.done = 0; return x; }); s.finished = false; save(); refresh(); toast('برنامه «' + s.name + '» بارگذاری شد'); };
      if (s.exercises.length) confirmBox('جایگزینی حرکات امروز؟', 'حرکات فعلی با برنامه هفتگی «' + (p.name || '') + '» جایگزین می‌شوند.', 'جایگزین کن', go_); else go_();
    }
    function renderWeekly() {
      var ws = weekStart(new Date()); var html = '<div class="flex items-center justify-between mb-3"><span class="font-headline-md text-headline-md text-text-primary">برنامه هفتگی</span><span class="font-label-sm text-label-sm text-text-muted">برای ویرایش روی هر روز بزنید</span></div><div class="flex flex-col gap-2.5">';
      for (var i = 0; i < 7; i++) {
        var d = addDays(ws, i), wd = d.getDay(), p = G.weekly[wd], items = p ? parsePlan(p.items) : [], isT = iso(d) === today();
        html += '<div data-wd="' + wd + '" class="w-full p-3.5 rounded-2xl ' + (isT ? 'bg-surface-container-lowest shadow-[-5px_-5px_12px_#ffffff,5px_5px_12px_#d5cfc1]' : 'bg-surface-container-low shadow-[-4px_-4px_10px_#ffffff,4px_4px_10px_#dcd5c9]') + ' flex items-center justify-between gap-3 cursor-pointer"><div class="flex items-center gap-3 min-w-0"><div class="w-10 h-10 rounded-xl bg-surface-subtle flex items-center justify-center font-bold ' + (isT ? 'text-chart-terracotta' : 'text-text-muted') + '">' + WD_SHORT[wd] + '</div><div class="flex flex-col min-w-0"><span class="font-title-md text-title-md text-text-primary truncate">' + esc(p && p.name ? p.name : 'استراحت') + '</span><span class="font-label-sm text-label-sm text-text-muted">' + WD_LONG[wd] + (items.length ? ' • ' + fa(items.length) + ' حرکت' : '') + (isT ? ' • امروز' : '') + '</span></div></div><span class="material-symbols-outlined text-text-muted text-[18px]">chevron_left</span></div>';
      }
      weekCard.innerHTML = html + '</div>';
      $$('[data-wd]', weekCard).forEach(function (r) { r.onclick = function () { planSheet(+r.getAttribute('data-wd')); }; });
    }
    function planSheet(wd) {
      var p = G.weekly[wd] || { name: '', items: '' };
      form({
        title: 'برنامه ' + WD_LONG[wd], sub: 'هر حرکت در یک خط: نام | تعداد ست | تکرار | وزن', focus: false,
        fields: [{ name: 'name', label: 'نام جلسه', value: p.name, placeholder: 'مثلاً پایین‌تنه (خالی = استراحت)' }, { name: 'items', label: 'حرکات', type: 'textarea', value: p.items, placeholder: 'اسکوات | 4 | 10 | 60 kg' }],
        extra: G.weekly[wd] ? [{ label: 'روز استراحت', cls: 'danger', run: function () { delete G.weekly[wd]; save(); refresh(); } }] : [],
        onSubmit: function (v) { if (!(v.name || '').trim() && !(v.items || '').trim()) delete G.weekly[wd]; else G.weekly[wd] = { name: (v.name || '').trim() || 'تمرین', items: v.items || '' }; save(); refresh(); toast('برنامه ذخیره شد'); }
      });
    }
    function scanFood() {
      pickFile('image/*', true, function (file) {
        shrinkImage(file, 160, function (thumb) {
          G.lastScan = { name: 'در حال تحلیل…', kcal: 0, p: 0, c: 0, f: 0, photo: thumb, added: true, pending: true }; save(); refresh();
          aiTag.innerHTML = '<span class="material-symbols-outlined text-[12px] spin">progress_activity</span> در حال تحلیل با هوش مصنوعی…';
          askVision(file, 'You are a nutrition assistant. Look at this photo of a meal and estimate the total for the visible portion. Reply with only JSON: {"name": string (dish name in Persian/Farsi), "kcal": number, "protein": number (grams), "carbs": number (grams), "fat": number (grams)}. If the image is not food, reply {"name": "غذا تشخیص داده نشد", "kcal": 0, "protein": 0, "carbs": 0, "fat": 0}.')
            .then(function (r) {
              G.lastScan = { name: String(r.name || 'غذا'), kcal: Math.round(num(r.kcal)), p: Math.round(num(r.protein)), c: Math.round(num(r.carbs)), f: Math.round(num(r.fat)), photo: thumb, added: false };
              save(); refresh(); toast('تخمین آماده شد — برای ثبت، دکمه پایین کارت را بزنید');
            })
            .catch(function (e) {
              G.lastScan = { name: 'غذای عکس‌گرفته‌شده', kcal: 0, p: 0, c: 0, f: 0, photo: thumb, added: true }; save(); refresh();
              toast(e && e.code === 'not_granted' ? 'اجازه تحلیل داده نشد؛ مقادیر را دستی وارد کنید' : 'تحلیل خودکار در دسترس نبود؛ مقادیر را دستی وارد کنید');
              mealSheet({ name: '' });
            });
        });
      });
    }
    function render() {
      var s = session(today()), st = setsOf(s);
      var wd = new Date().getDay(), plan = G.weekly[wd];
      if (subtitle) subtitle.textContent = WD_LONG[wd] + ' • ' + (plan ? plan.name : 'روز استراحت');
      if (streakEl) streakEl.textContent = fa(streak()) + ' روز پیاپی';
      topTabs.forEach(function (b, i) { b.className = ['workout', 'calorie', 'weight', 'analysis'][i] === tab ? topOn : topOff; });
      var showW = tab === 'workout';
      seg.style.display = showW ? '' : 'none';
      dailyBtn.className = G.view === 'daily' ? segOn : segOff; weeklyBtn.className = G.view === 'weekly' ? segOn : segOff;
      sessCard.style.display = showW && G.view === 'daily' ? '' : 'none';
      weekCard.style.display = showW && G.view === 'weekly' ? '' : 'none';
      calCard.style.display = tab === 'calorie' ? '' : 'none'; scanCard.style.display = tab === 'calorie' ? '' : 'none';
      wCard.style.display = tab === 'weight' ? '' : 'none'; anCard.style.display = tab === 'analysis' ? '' : 'none';
      // session
      sessTitle.textContent = s ? s.name : (plan ? plan.name : 'جلسه امروز');
      if (timerPill) { var running = !!S.gym.timerStart; timerPill.lastElementChild.textContent = fa(sessionMinutes(s)) + (s && s.target ? '/' + fa(s.target) : '') + ' دقیقه'; timerPill.firstElementChild.textContent = running ? 'pause_circle' : 'timer'; timerPill.classList.toggle('text-chart-terracotta', running); timerPill.style.cursor = 'pointer'; timerPill.title = running ? 'توقف زمان‌سنج' : 'شروع زمان‌سنج'; }
      progLabel.textContent = fa(st.done) + '/' + fa(st.tot) + ' ست'; progBar.style.width = (st.tot ? st.done / st.tot * 100 : 0) + '%';
      listEl.innerHTML = '';
      (s ? s.exercises : []).forEach(function (e, i) { listEl.appendChild(exRow(e, i)); });
      if (!s || !s.exercises.length) listEl.innerHTML = '<div class="w-full p-4 rounded-2xl bg-surface-subtle text-center text-text-muted font-body-md">هنوز حرکتی برای امروز ثبت نشده' + (plan ? '<br><span class="text-[12px]">می‌توانید برنامه «' + esc(plan.name) + '» را بارگذاری کنید.</span>' : '') + '</div>';
      finBtn.style.display = s && s.exercises.length ? '' : 'none';
      finBtn.lastElementChild.textContent = s && s.finished ? 'جلسه ثبت شد ✓ (بازگشایی)' : 'ثبت پایان جلسه';
      loadBtn.style.display = plan ? '' : 'none'; loadBtn.lastElementChild.textContent = 'بارگذاری از برنامه هفتگی';
      if (G.view === 'weekly') renderWeekly();
      // calories
      var goals = G.goals, tot = sumMeals(mealsToday());
      consumedEl.textContent = fa(tot.kcal.toLocaleString('en-US')); goalOf.textContent = '/ ' + fa(goals.kcal.toLocaleString('en-US')) + ' kcal';
      var left = goals.kcal - tot.kcal; leftEl.textContent = left >= 0 ? fa(left.toLocaleString('en-US')) + ' kcal مانده' : fa((-left).toLocaleString('en-US')) + ' kcal بیشتر از هدف';
      gauge.style.width = Math.min(100, tot.kcal / goals.kcal * 100) + '%';
      goalTxt.textContent = 'هدف روزانه: ' + fa(goals.kcal.toLocaleString('en-US')) + ' kcal (تغییر)';
      [['p', 'پروتئین'], ['c', 'کربوهیدرات'], ['f', 'چربی']].forEach(function (m, i) { var b = macroBoxes[i]; if (!b) return; var sp = b.children; sp[1].textContent = fa(Math.round(tot[m[0]])) + 'g'; sp[2].textContent = 'هدف ' + fa(goals[m[0]]) + 'g'; });
      mealList.innerHTML = '<div class="flex items-center justify-between px-1 mt-1"><span class="font-title-md text-[14px] text-text-primary">وعده‌های امروز</span><span class="font-label-sm text-label-sm text-text-muted">' + fa(mealsToday().length) + ' وعده</span></div>';
      mealsToday().forEach(function (m) {
        var r = document.createElement('div'); r.className = 'w-full px-3 py-2.5 rounded-2xl bg-surface-subtle shadow-[inset_1px_1px_3px_#ded7ca,inset_-1px_-1px_3px_#ffffff] flex items-center justify-between gap-2 cursor-pointer';
        r.innerHTML = '<div class="flex flex-col min-w-0"><span class="font-label-md text-[13px] text-text-primary font-bold truncate"></span><span class="font-label-sm text-[10px] text-text-muted"></span></div><span class="font-title-md text-[14px] text-chart-terracotta font-bold whitespace-nowrap"></span>';
        r.firstChild.firstChild.textContent = m.name; r.firstChild.lastChild.textContent = 'P ' + fa(m.p || 0) + 'g • C ' + fa(m.c || 0) + 'g • F ' + fa(m.f || 0) + 'g'; r.lastChild.textContent = fa(m.kcal) + ' kcal';
        r.onclick = function () { mealSheet(m); };
        mealList.appendChild(r);
      });
      if (!mealsToday().length) mealList.insertAdjacentHTML('beforeend', '<div class="text-center text-text-muted font-label-md py-2">هنوز وعده‌ای ثبت نشده</div>');
      // scanner card
      var r = G.lastScan;
      aiCard.style.display = r ? '' : 'none';
      if (r) {
        if (r.photo) aiImg.src = r.photo;
        aiName.textContent = r.name; aiKcal.textContent = fa(r.kcal);
        if (aiMac[0]) { aiMac[0].textContent = fa(r.p) + 'g'; aiMac[1].textContent = fa(r.c) + 'g'; aiMac[2].textContent = fa(r.f) + 'g'; }
        if (!r.pending) aiTag.innerHTML = '<span class="material-symbols-outlined text-[12px]">auto_awesome</span> ' + (r.added ? 'ثبت شده • برای اسکن جدید بزنید' : 'تشخیص هوشمند • برای اصلاح بزنید');
        aiBtn.lastElementChild.textContent = r.added ? 'اسکن عکس جدید' : 'ثبت در کالری مصرفی امروز';
        aiBtn.firstElementChild.textContent = r.added ? 'photo_camera' : 'add_task';
      }
      // weight
      var lw = lastWeight(); curW.textContent = lw ? fa(lw.kg.toFixed(1)) : '—';
      var t0 = today(), w7 = weightOn(iso(addDays(new Date(), -7))), w30 = weightOn(iso(addDays(new Date(), -30)));
      [[trendBoxes[0], w7, 'تغییر این هفته'], [trendBoxes[1], w30, 'تغییر ۳۰ روز گذشته']].forEach(function (x) {
        if (!x[0]) return; var d = lw && x[1] != null ? Math.round((lw.kg - x[1]) * 10) / 10 : null;
        x[0].children[0].textContent = x[2];
        var row = x[0].children[1]; row.firstElementChild.textContent = d == null ? 'remove' : d <= 0 ? 'trending_down' : 'trending_up';
        row.lastElementChild.textContent = d == null ? '—' : (d > 0 ? '+' : '') + fa(d.toFixed(1)) + ' kg';
      });
      var vals = []; for (var i = 6; i >= 0; i--) vals.push(weightOn(iso(addDays(new Date(), -i))));
      var known = vals.filter(function (v) { return v != null; }), mn = Math.min.apply(null, known.concat([999])), mx = Math.max.apply(null, known.concat([0]));
      sparkBars.forEach(function (b, i) {
        var v = vals[i], bar = b.firstElementChild, lab = b.lastElementChild, d = addDays(new Date(), i - 6);
        bar.style.height = v == null ? '4%' : (mx === mn ? 70 : 45 + (v - mn) / (mx - mn) * 45) + '%';
        bar.title = v == null ? '' : fa(v) + ' kg'; lab.textContent = WD_SHORT[d.getDay()];
      });
      if (sparkStatus && known.length > 1) { var ch = known[known.length - 1] - known[0]; sparkStatus.textContent = Math.abs(ch) < 0.3 ? 'پایدار و منظم' : ch < 0 ? 'روند کاهشی' : 'روند افزایشی'; }
      renderAnalysis();
    }
    function renderAnalysis() {
      var days = [], tSets = 0, sess = 0, kc = 0, kn = 0;
      for (var i = 6; i >= 0; i--) { var k = iso(addDays(new Date(), -i)), s = G.sessions[k], st = setsOf(s); days.push({ d: addDays(new Date(), -i), v: st.done }); tSets += st.done; if (s && (s.finished || st.done)) sess++; var m = G.meals[k]; if (m && m.length) { kc += sumMeals(m).kcal; kn++; } }
      var mx = Math.max.apply(null, days.map(function (x) { return x.v; }).concat([1]));
      var lw = lastWeight(), w30 = weightOn(iso(addDays(new Date(), -30))), wd = lw && w30 != null ? Math.round((lw.kg - w30) * 10) / 10 : null;
      var box = 'p-3 rounded-2xl bg-surface-container-low shadow-[inset_1px_1px_3px_#ded7ca,inset_-1px_-1px_3px_#ffffff] flex flex-col gap-1';
      anCard.innerHTML = '<div class="flex items-center gap-2 mb-4"><div class="w-8 h-8 rounded-xl bg-surface-subtle flex items-center justify-center text-chart-terracotta"><span class="material-symbols-outlined text-[18px]">insights</span></div><h3 class="font-headline-md text-headline-md text-text-primary">آنالیز ۷ روز اخیر</h3></div>' +
        '<div class="grid grid-cols-2 gap-3 mb-4">' +
        '<div class="' + box + '"><span class="font-label-sm text-label-sm text-text-muted">جلسات تمرین</span><span class="font-title-md text-title-md text-text-primary">' + fa(sess) + ' از ۷ روز</span></div>' +
        '<div class="' + box + '"><span class="font-label-sm text-label-sm text-text-muted">ست‌های انجام‌شده</span><span class="font-title-md text-title-md text-text-primary">' + fa(tSets) + ' ست</span></div>' +
        '<div class="' + box + '"><span class="font-label-sm text-label-sm text-text-muted">میانگین کالری روزانه</span><span class="font-title-md text-title-md text-text-primary">' + (kn ? fa(Math.round(kc / kn).toLocaleString('en-US')) : '—') + ' <small class="text-text-muted">/ ' + fa(G.goals.kcal) + '</small></span></div>' +
        '<div class="' + box + '"><span class="font-label-sm text-label-sm text-text-muted">تغییر وزن ۳۰ روز</span><span class="font-title-md text-title-md ' + (wd != null && wd <= 0 ? 'text-chart-sage' : 'text-chart-terracotta') + '">' + (wd == null ? '—' : (wd > 0 ? '+' : '') + fa(wd.toFixed(1)) + ' kg') + '</span></div></div>' +
        '<div class="w-full p-3.5 rounded-2xl bg-surface-subtle shadow-[inset_2px_2px_6px_#d8d1c3,inset_-2px_-2px_6px_#ffffff]"><div class="font-label-md text-label-md text-text-muted mb-3">ست‌های انجام‌شده در هر روز</div><div class="flex items-end justify-between gap-2 h-24">' +
        days.map(function (x, i) { return '<div class="flex-1 flex flex-col items-center justify-end h-full gap-1.5"><span class="text-[10px] text-text-muted">' + (x.v ? fa(x.v) : '') + '</span><div class="w-full max-w-[18px] rounded-full ' + (i === 6 ? 'bg-chart-terracotta' : 'bg-chart-sage/70') + '" style="height:' + Math.max(4, Math.round(x.v / mx * 70)) + '%"></div><span class="font-label-sm text-label-sm text-text-muted">' + WD_SHORT[x.d.getDay()] + '</span></div>'; }).join('') + '</div></div>';
    }
    renderers.push(render); render();
    setInterval(function () { if (S.gym.timerStart) render(); }, 30000);
  };
  function parsePlan(text) {
    return String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var p = l.split('|').map(function (x) { return x.trim(); });
      var unit = /دقیقه|ثانیه/.test(p[3] || '') && !/kg/.test(p[3] || '') ? (p[3].indexOf('دقیقه') >= 0 ? 'دقیقه' : 'ثانیه') : 'تکرار';
      return { name: p[0], sets: Math.max(1, Math.min(10, num(p[1]) || 3)), reps: en(p[2] || '12'), unit: unit, weight: unit === 'تکرار' ? (p[3] || '') : '', done: 0 };
    });
  }
  function exerciseSheet(id) {
    var s = session(today(), true), e = id ? s.exercises.find(function (x) { return x.id === id; }) : null;
    form({
      title: e ? 'ویرایش حرکت' : 'افزودن حرکت',
      fields: [
        { name: 'name', label: 'نام حرکت', value: e ? e.name : '', placeholder: 'مثلاً اسکوات' },
        { name: 'sets', label: 'تعداد ست', type: 'number', value: e ? e.sets : 3, row: '3a' },
        { name: 'reps', label: 'تکرار / زمان', type: 'number', value: e ? e.reps : 12, row: '3a' },
        { name: 'weight', label: 'وزنه', value: e ? e.weight : '', placeholder: '30 kg', row: '3a' },
        { name: 'unit', label: 'واحد', type: 'chips', value: e ? e.unit || 'تکرار' : 'تکرار', options: [{ value: 'تکرار', label: 'تکرار' }, { value: 'ثانیه', label: 'ثانیه' }, { value: 'دقیقه', label: 'دقیقه' }] }
      ],
      extra: e ? [{ label: 'حذف', cls: 'danger', run: function () { s.exercises.splice(s.exercises.indexOf(e), 1); save(); refresh(); toast('حرکت حذف شد'); } }] : [],
      onSubmit: function (v) {
        var name = (v.name || '').trim(); if (!name) { toast('نام حرکت را وارد کنید'); return false; }
        var o = e || { id: uid(), done: 0 };
        o.name = name; o.sets = Math.max(1, Math.min(10, Math.round(num(v.sets)) || 3)); o.reps = String(num(v.reps) || 12); o.weight = (v.weight || '').trim(); o.unit = v.unit; o.done = Math.min(o.done, o.sets);
        if (!e) s.exercises.push(o); s.finished = false; save(); refresh(); toast(e ? 'حرکت ویرایش شد' : '«' + name + '» اضافه شد');
      }
    });
  }
  function addMeal(m) { var k = today(); (S.gym.meals[k] = S.gym.meals[k] || []).push(Object.assign({ id: uid() }, m)); save(); }
  function mealSheet(m) {
    var editing = m && m.id;
    form({
      title: editing ? 'ویرایش وعده' : 'ثبت دستی کالری',
      fields: [
        { name: 'name', label: 'غذا / وعده', value: m ? m.name : '', placeholder: 'مثلاً ناهار' },
        { name: 'kcal', label: 'کالری (kcal)', type: 'number', value: m && m.kcal || '' },
        { name: 'p', label: 'پروتئین g', type: 'number', value: m && m.p || '', row: '3a' },
        { name: 'c', label: 'کربوهیدرات g', type: 'number', value: m && m.c || '', row: '3a' },
        { name: 'f', label: 'چربی g', type: 'number', value: m && m.f || '', row: '3a' }
      ],
      extra: editing ? [{ label: 'حذف', cls: 'danger', run: function () { var l = mealsToday(), i = l.indexOf(m); l.splice(i, 1); save(); refresh(); toast('وعده حذف شد', { label: 'واگرد', run: function () { l.splice(i, 0, m); save(); refresh(); } }); } }] : [],
      onSubmit: function (v) {
        var kcal = num(v.kcal); if (!kcal) { toast('کالری را وارد کنید'); return false; }
        var o = { name: (v.name || '').trim() || 'وعده', kcal: Math.round(kcal), p: num(v.p), c: num(v.c), f: num(v.f) };
        if (editing) Object.assign(m, o); else addMeal(o);
        save(); refresh(); toast(editing ? 'وعده ویرایش شد' : fa(o.kcal) + ' کالری ثبت شد');
      }
    });
  }
  function goalsSheet() {
    var g = S.gym.goals;
    form({ title: 'اهداف تغذیه روزانه', fields: [{ name: 'kcal', label: 'کالری (kcal)', type: 'number', value: g.kcal }, { name: 'p', label: 'پروتئین g', type: 'number', value: g.p, row: '3a' }, { name: 'c', label: 'کربوهیدرات g', type: 'number', value: g.c, row: '3a' }, { name: 'f', label: 'چربی g', type: 'number', value: g.f, row: '3a' }], onSubmit: function (v) { g.kcal = Math.max(500, num(v.kcal)) || g.kcal; g.p = num(v.p) || g.p; g.c = num(v.c) || g.c; g.f = num(v.f) || g.f; save(); refresh(); toast('اهداف ذخیره شد'); } });
  }
  function weightSheet() {
    var lw = lastWeight();
    form({ title: 'ثبت وزن', fields: [{ name: 'kg', label: 'وزن (kg)', type: 'number', value: lw ? lw.kg : '' }, { name: 'date', label: 'تاریخ', type: 'date', value: today() }], onSubmit: function (v) { var kg = num(v.kg); if (kg < 20 || kg > 400) { toast('وزن معتبر وارد کنید'); return false; } var d = v.date || today(); var ex = S.gym.weights.find(function (w) { return w.date === d; }); if (ex) ex.kg = kg; else S.gym.weights.push({ date: d, kg: kg }); save(); refresh(); toast('وزن ' + fa(kg) + ' kg ثبت شد'); } });
  }
  function weightHistory() {
    var w = S.gym.weights.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 30);
    var close = infoSheet('سابقه وزن', w.length ? '<p class="ui-sub">برای حذف، روی ردیف بزنید.</p><div class="ui-list">' + w.map(function (x) { return '<div class="ui-item" data-w="' + x.date + '" style="cursor:pointer"><div class="grow"><div class="t">' + faDate(parseIso(x.date), { weekday: 'long', day: 'numeric', month: 'long' }) + '</div></div><div class="amt">' + fa(x.kg) + ' kg</div></div>'; }).join('') + '</div>' : '<div class="ui-empty">هنوز وزنی ثبت نشده</div>', [{ label: 'ثبت وزن', cls: 'primary', run: weightSheet }]);
    $$('.ui-overlay [data-w]').forEach(function (r) { r.onclick = function () { var d = r.getAttribute('data-w'); close(); setTimeout(function () { confirmBox('حذف این ثبت وزن؟', faDayMonth(parseIso(d)), 'حذف', function () { S.gym.weights = S.gym.weights.filter(function (x) { return x.date !== d; }); save(); refresh(); }); }, 220); }; });
  }

  /* ---------------- boot ---------------- */
  buildNav(); bindHeader(); applyDark();
  if (P[PAGE]) P[PAGE]();
  checkReminders(); setInterval(checkReminders, 30000);
  window.addEventListener('pageshow', function (e) { if (e.persisted) { S = loadState() || S; refresh(); } });
  window.__app = { state: function () { return S; }, refresh: refresh };
})();
