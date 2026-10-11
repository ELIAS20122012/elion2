/* App shell: top bar (profile · name · settings), fixed bottom bar with four sections, router and render loop. */
import { init, subscribe, reloadFromStorage, resetToSample, S } from './core/store.js';
import { $ } from './core/util.js';
import { esc } from './core/format.js';
import { currentRoute } from './router.js';
import { bindActions, patchHTML } from './ui/dom.js';
import { icon } from './ui/widgets.js';
import { checkReminders } from './features/reminders.js';
import { openSettings, openProfile } from './features/settings.js';

import today from './pages/today.js';
import tasks from './pages/tasks.js';
import gym from './pages/gym.js';
import money from './pages/money.js';
import shop from './pages/shop.js';

const PAGES = { today, tasks, gym, money, shop };
const NAV = [['today', 'wb_sunny', 'امروز'], ['tasks', 'task_alt', 'کارها'], ['gym', 'fitness_center', 'ورزش'], ['money', 'account_balance_wallet', 'مالی'], ['shop', 'shopping_basket', 'خرید']];

let page = null;
let view = null;

function render() {
  if (!page || !view) return;
  try {
    patchHTML(view, page.render());
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="empty">خطایی رخ داد.<br><small>${esc(String(e.message || e))}</small></p>`;
  }
}

/* The round button hops from the old icon to the new one in an arc; the notch in the bar follows it. */
let ballX = null;
const HOP_MS = 520;
function placeNavDot() {
  const nav = $('#nav');
  const a = nav.querySelector('a[aria-current="page"]');
  const ball = nav.querySelector('.ball');
  if (!a || !ball) return;
  const x = a.offsetLeft + a.offsetWidth / 2;
  const inner = ball.firstElementChild;
  const setIcon = () => { inner.innerHTML = a.querySelector('.material-symbols-outlined').outerHTML; };
  const still = ballX === null || ballX === x || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) {
    setIcon();
    ball.style.transform = `translateX(${x - 27}px)`;
    nav.style.setProperty('--x', `${x}px`);
  } else {
    const from = ballX;
    const dist = Math.abs(x - from);
    const lift = -Math.min(46, 22 + dist / 8);
    ball.getAnimations().forEach((an) => an.cancel());
    inner.getAnimations().forEach((an) => an.cancel());
    ball.style.transform = `translateX(${x - 27}px)`;
    ball.animate([{ transform: `translateX(${from - 27}px)` }, { transform: `translateX(${x - 27}px)` }], { duration: HOP_MS, easing: 'cubic-bezier(.45, 0, .25, 1)' });
    inner.animate([
      { transform: 'translateY(0) scale(1, 1)', easing: 'ease-out' },
      { transform: 'translateY(4px) scale(1.18, .8)', offset: 0.1, easing: 'cubic-bezier(.2, .8, .3, 1)' },
      { transform: `translateY(${lift}px) scale(.88, 1.16)`, offset: 0.45, easing: 'cubic-bezier(.6, 0, .8, .4)' },
      { transform: 'translateY(2px) scale(1.22, .78)', offset: 0.78, easing: 'ease-out' },
      { transform: 'translateY(-7px) scale(.95, 1.05)', offset: 0.88, easing: 'ease-in' },
      { transform: 'translateY(0) scale(1, 1)' },
    ], { duration: HOP_MS + 220 });
    nav.animate([{ '--x': `${from}px` }, { '--x': `${x}px` }], { duration: HOP_MS, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'forwards' });
    setTimeout(setIcon, HOP_MS / 2);
    nav.style.setProperty('--x', `${x}px`);
  }
  ballX = x;
}

function show() {
  const id = currentRoute();
  page = PAGES[id];
  view = document.createElement('div');
  view.className = `view page-${id}`;
  $('#app').replaceChildren(view);
  bindActions(view, page);
  document.title = `${page.title} · نظم`;
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (page.mount) page.mount();
  placeNavDot();
  render();
  window.scrollTo(0, 0);
}

function buildChrome() {
  $('#top').innerHTML = `<button class="tb-btn" data-act="profile" aria-label="پروفایل">${icon('account_circle')}</button><span class="wordmark">نظم</span><button class="tb-btn" data-act="settings" aria-label="تنظیمات">${icon('settings')}</button>`;
  $('#nav').innerHTML = `${NAV.map(([id, ic, label]) => `<a href="#/${id}" data-route="${id}" aria-label="${label}">${icon(ic)}<small>${label}</small></a>`).join('')}<span class="ball" aria-hidden="true"><span class="ball-in"></span></span>`;
}

function splash() {
  const el = $('#splash');
  try { if (sessionStorage.getItem('nazm-splash')) { el.remove(); return; } sessionStorage.setItem('nazm-splash', '1'); } catch { /* storage blocked */ }
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
}

function boot() {
  init();
  buildChrome();
  bindActions($('#top'), { act: { profile: openProfile, settings: openSettings } });
  subscribe(render);
  window.addEventListener('hashchange', show);
  window.addEventListener('resize', placeNavDot);
  $('#nav').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.dataset.route === currentRoute() && PAGES[a.dataset.route].act.hub) PAGES[a.dataset.route].act.hub();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { reloadFromStorage(); render(); } });
  setInterval(checkReminders, 30000);
  show();
  splash();
  checkReminders();
  window.__app = { state: () => S, sample: resetToSample };
}

boot();
