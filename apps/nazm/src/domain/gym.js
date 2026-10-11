/* Workout sessions, meals and body weight. Pure data logic — no DOM. */
import { S } from '../core/store.js';
import { uid, sum } from '../core/util.js';
import { iso, addDays, parseIso, today } from '../core/dates.js';
import { en, num } from '../core/format.js';

export const TABS = [
  { key: 'workout', icon: 'fitness_center', label: 'برنامه تمرینی' },
  { key: 'calorie', icon: 'restaurant', label: 'کالری و تغذیه' },
  { key: 'weight', icon: 'monitor_weight', label: 'پایش وزن' },
  { key: 'analysis', icon: 'insights', label: 'آنالیز' },
];

/* ---------- sessions ---------- */
export function session(date = today(), create = false) {
  let s = S.gym.sessions[date];
  if (!s && create) {
    const plan = S.gym.weekly[parseIso(date).getDay()];
    s = S.gym.sessions[date] = { name: plan ? plan.name : 'جلسه تمرین', minutes: 0, target: 45, finished: false, exercises: [] };
  }
  return s;
}

export function setsOf(s) {
  let total = 0;
  let done = 0;
  (s ? s.exercises : []).forEach((e) => { total += +e.sets || 0; done += Math.min(+e.done || 0, +e.sets || 0); });
  return { tot: total, done };
}

const isActive = (key) => { const s = S.gym.sessions[key]; return !!s && (s.finished || setsOf(s).done > 0); };
export const wasActive = isActive;

/** Consecutive training days ending today (or yesterday if today has none yet). */
export function streak() {
  let n = 0;
  let d = new Date();
  if (!isActive(iso(d))) d = addDays(d, -1);
  while (isActive(iso(d))) { n++; d = addDays(d, -1); }
  return n;
}

export function sessionMinutes(s) {
  if (!s) return 0;
  let m = s.minutes || 0;
  if (S.gym.timerStart && s === S.gym.sessions[today()]) m += (Date.now() - S.gym.timerStart) / 60000;
  return Math.round(m);
}

export function stopTimer(s) {
  if (!S.gym.timerStart) return;
  s.minutes = (s.minutes || 0) + (Date.now() - S.gym.timerStart) / 60000;
  S.gym.timerStart = null;
}

export function finishSession(s) { stopTimer(s); s.finished = true; }

/** Start the timer the first time a set is ticked. Returns true when it started. */
export function autoStartTimer() {
  const s = session(today());
  if (s && !S.gym.timerStart && !s.minutes && !s.finished) { S.gym.timerStart = Date.now(); return true; }
  return false;
}

/** The session for `date`; created from the weekday's plan the first time the day is opened. */
export function sessionFromPlan(date) {
  let s = S.gym.sessions[date];
  const plan = S.gym.weekly[parseIso(date).getDay()];
  if (!s && plan && parsePlan(plan.items).length) {
    s = session(date, true);
    loadPlanInto(s, plan);
  }
  return s;
}

/** After the weekday plan changed: re-apply it to a day that has no progress yet. */
export function resyncSessionWithPlan(date) {
  const s = S.gym.sessions[date];
  const plan = S.gym.weekly[parseIso(date).getDay()];
  if (s && !s.finished && setsOf(s).done === 0 && plan) loadPlanInto(s, plan);
}

/* ---------- weekly plan ("name | sets | reps | weight" per line) ---------- */
export function parsePlan(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const p = line.split('|').map((x) => x.trim());
    const timed = /دقیقه|ثانیه/.test(p[3] || '') && !/kg/.test(p[3] || '');
    const unit = timed ? (p[3].includes('دقیقه') ? 'دقیقه' : 'ثانیه') : 'تکرار';
    return { name: p[0], sets: Math.max(1, Math.min(10, num(p[1]) || 3)), reps: en(p[2] || '12'), unit, weight: unit === 'تکرار' ? (p[3] || '') : '', done: 0 };
  });
}

export function loadPlanInto(s, plan) {
  s.name = plan.name || s.name;
  s.exercises = parsePlan(plan.items).map((x) => ({ ...x, id: uid(), done: 0 }));
  s.finished = false;
}

/* ---------- meals ---------- */
export const mealsOn = (k = today()) => S.gym.meals[k] || [];
export function addMeal(m, k = today()) { (S.gym.meals[k] = S.gym.meals[k] || []).push({ id: uid(), ...m }); }
export const sumMeals = (list) => ({
  kcal: sum(list, (m) => +m.kcal || 0), p: sum(list, (m) => +m.p || 0), c: sum(list, (m) => +m.c || 0), f: sum(list, (m) => +m.f || 0),
});

/* ---------- weight ---------- */
const byDate = () => S.gym.weights.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
export const lastWeight = () => { const w = byDate(); return w[w.length - 1]; };
export function weightOn(date) {
  const w = byDate().filter((x) => x.date <= date);
  return w.length ? w[w.length - 1].kg : null;
}
export function setWeight(date, kg) {
  const ex = S.gym.weights.find((w) => w.date === date);
  if (ex) ex.kg = kg; else S.gym.weights.push({ date, kg });
}
export const round1 = (n) => Math.round(n * 10) / 10;

/** Weight change over the last `days` days (null when unknown). */
export function weightChange(days) {
  const lw = lastWeight();
  const base = weightOn(iso(addDays(new Date(), -days)));
  return lw && base != null ? round1(lw.kg - base) : null;
}

/** Last-7-days summary for the analysis tab. */
export function weekAnalysis() {
  const days = [];
  let totalSets = 0, sessions = 0, kcal = 0, mealDays = 0;
  for (let i = 6; i >= 0; i--) {
    const d = addDays(new Date(), -i);
    const k = iso(d);
    const s = S.gym.sessions[k];
    const st = setsOf(s);
    days.push({ d, v: st.done });
    totalSets += st.done;
    if (s && (s.finished || st.done)) sessions++;
    const m = S.gym.meals[k];
    if (m && m.length) { kcal += sumMeals(m).kcal; mealDays++; }
  }
  return { days, totalSets, sessions, avgKcal: mealDays ? Math.round(kcal / mealDays) : null };
}
