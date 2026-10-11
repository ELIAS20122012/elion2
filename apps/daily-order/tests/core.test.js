import test from 'node:test';
import assert from 'node:assert/strict';
import { toJ, fromJ, jMonthLen } from '../src/core/jalali.js';
import { fa, en, num, money, esc } from '../src/core/format.js';
import { config } from '../src/core/config.js';
import { addDays, parseIso, iso, weekStart, hmToMin, minToHM, daysBetween } from '../src/core/dates.js';
import { addMonthsIso, monthKey, shiftMonthKey, dayOfMonth } from '../src/core/calendar.js';

test('Jalali conversion matches known Nowruz dates', () => {
  assert.deepEqual(toJ('2024-03-20'), { jy: 1403, jm: 1, jd: 1 });
  assert.deepEqual(toJ('2023-03-21'), { jy: 1402, jm: 1, jd: 1 });
  assert.equal(fromJ(1403, 1, 1), '2024-03-20');
});

test('Jalali conversion round-trips over several years', () => {
  for (let d = new Date(2020, 0, 1); d < new Date(2032, 0, 1); d = addDays(d, 17)) {
    const j = toJ(iso(d));
    assert.equal(fromJ(j.jy, j.jm, j.jd), iso(d));
  }
});

test('Jalali month lengths: 31 / 30 / Esfand 29 or 30', () => {
  assert.equal(jMonthLen(1403, 1), 31);
  assert.equal(jMonthLen(1403, 7), 30);
  assert.equal(jMonthLen(1403, 12), 30); // 1403 is a leap year
  assert.equal(jMonthLen(1404, 12), 29);
});

test('digit helpers', () => {
  assert.equal(fa(1234), '۱۲۳۴');
  assert.equal(en('۱۲۳٤'), '1234');
  assert.equal(num('۱,۲۵۰.۵'), 1250.5);
  assert.equal(num('abc'), 0);
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('money honours currency, sign and privacy', () => {
  config.currency = '€'; config.privacy = false;
  assert.ok(money(1234.5).includes('1,235'));
  assert.ok(money(-12.5).includes('-€ 12.50'));
  assert.equal(money(10, true), '••••');
  config.currency = 'تومان';
  assert.ok(money(5000).includes('5,000 تومان'));
  config.currency = '€';
});

test('week starts on Saturday', () => {
  assert.equal(iso(weekStart(parseIso('2026-10-11'))), '2026-10-10'); // Sunday → previous Saturday
  assert.equal(iso(weekStart(parseIso('2026-10-10'))), '2026-10-10');
});

test('time helpers', () => {
  assert.equal(hmToMin('09:30'), 570);
  assert.equal(minToHM(570), '09:30');
  assert.equal(hmToMin(''), null);
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
});

test('addMonthsIso keeps the anchor day and clamps (Jalali)', () => {
  config.calendar = 'jalali';
  const shahrivar31 = fromJ(1403, 6, 31);
  assert.deepEqual(toJ(addMonthsIso(shahrivar31, 1)), { jy: 1403, jm: 7, jd: 30 });
  assert.deepEqual(toJ(addMonthsIso(fromJ(1403, 12, 1), 1)), { jy: 1404, jm: 1, jd: 1 });
  assert.equal(dayOfMonth(fromJ(1403, 3, 15)), 15);
});

test('addMonthsIso clamps in the Gregorian calendar', () => {
  config.calendar = 'gregorian';
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsIso('2026-11-15', 3), '2027-02-15');
  config.calendar = 'jalali';
});

test('month keys follow the active calendar and shift across years', () => {
  config.calendar = 'jalali';
  assert.equal(monthKey(fromJ(1403, 5, 9)), '1403-05');
  assert.equal(shiftMonthKey('1403-11', 3), '1404-02');
  assert.equal(shiftMonthKey('1403-02', -3), '1402-11');
  config.calendar = 'gregorian';
  assert.equal(monthKey('2026-10-11'), '2026-10');
  config.calendar = 'jalali';
});
