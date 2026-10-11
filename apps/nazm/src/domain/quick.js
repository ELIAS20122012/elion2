/* Parsing of one typed line ("نهار 120", "+حقوق 1500", "ماست ۱۲۰"). Pure — no DOM. */
import { en } from '../core/format.js';

/** Split a line into its text and the LAST number in it (Persian digits and commas accepted). */
export function splitAmount(line) {
  const text = en(String(line || '')).trim();
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)(?!.*\d)/);
  if (!m) return { title: text, amount: 0 };
  const amount = parseFloat(m[1].replace(/,/g, ''));
  const title = (text.slice(0, m.index) + text.slice(m.index + m[1].length)).replace(/\s+/g, ' ').trim();
  return { title, amount: Number.isFinite(amount) ? amount : 0 };
}

/** "+حقوق 1500" is income, anything else an expense. */
export function parseMoneyLine(line) {
  const raw = String(line || '').trim();
  const income = /^[+＋]/.test(raw);
  const { title, amount } = splitAmount(income ? raw.slice(1) : raw);
  return { type: income ? 'income' : 'expense', title, amount };
}
