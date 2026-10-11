import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAmount, parseMoneyLine } from '../src/domain/quick.js';

test('splitAmount takes the last number and keeps the text', () => {
  assert.deepEqual(splitAmount('ماست 120'), { title: 'ماست', amount: 120 });
  assert.deepEqual(splitAmount('ماست ۱۲۰'), { title: 'ماست', amount: 120 });
  assert.deepEqual(splitAmount('120 ماست'), { title: 'ماست', amount: 120 });
  assert.deepEqual(splitAmount('نان ۲ عدد ۴۵'), { title: 'نان ۲ عدد'.replace('۲', '2'), amount: 45 });
  assert.deepEqual(splitAmount('خرید ۱,۲۵۰.۵'), { title: 'خرید', amount: 1250.5 });
  assert.deepEqual(splitAmount('فقط متن'), { title: 'فقط متن', amount: 0 });
  assert.deepEqual(splitAmount(''), { title: '', amount: 0 });
});

test('parseMoneyLine: plain = expense, leading + = income', () => {
  assert.deepEqual(parseMoneyLine('نهار ۱۲۰'), { type: 'expense', title: 'نهار', amount: 120 });
  assert.deepEqual(parseMoneyLine('+حقوق 1500'), { type: 'income', title: 'حقوق', amount: 1500 });
  assert.deepEqual(parseMoneyLine('+ هدیه ۵۰'), { type: 'income', title: 'هدیه', amount: 50 });
  assert.equal(parseMoneyLine('بدون مبلغ').amount, 0);
});
