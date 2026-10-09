import { getSettings, patchSettings, type Lang } from "../elionSettings";
import { DICT1 } from "./dict1";
import { DICT2 } from "./dict2";
import { DICT3 } from "./dict3";
import { DICT4, FA_EN } from "./dict4";
import { DICT5 } from "./dict5";

export type { Lang };

/**
 * Two-way translation of the UI text. English is the source language of the Elion pages (en → fa); the
 * shared components and backend messages that were written in Persian are translated the other way (fa → en)
 * when the site language is English. Keys are the exact text as it appears in the DOM; "${}" is a dynamic value.
 */
interface Rule { re: RegExp; out: string; weight: number }
interface Table { exact: Map<string, string>; rules: Rule[] }

export const norm = (s: string) => s.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const LATIN_DIGITS = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

function build(pairs: [string, string][], latinDigits = false): Table {
  const exact = new Map<string, string>();
  const rules: Rule[] = [];
  for (const [k, raw] of pairs) {
    const v = latinDigits ? LATIN_DIGITS(raw) : raw; // live numbers are Latin digits, so the fixed Persian text uses them too
    const key = norm(k);
    if (!key.includes("${}")) { exact.set(key, v); continue; }
    const parts = key.split("${}").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    let i = 0;
    rules.push({ re: new RegExp("^" + parts.join("(.+?)") + "$"), out: v.replace(/\$\{\}/g, () => `\u0000${i++}\u0000`), weight: key.replace(/\$\{\}/g, "").length });
  }
  rules.sort((a, b) => b.weight - a.weight); // the most specific pattern first
  return { exact, rules };
}

const TO_FA = build([...DICT1, ...DICT2, ...DICT3, ...DICT4, ...DICT5], true);
const TO_EN = build(FA_EN);

function lookup(core: string, table: Table, depth = 0): string | null {
  const hit = table.exact.get(core);
  if (hit !== undefined) return hit;
  if (depth > 0) return null;
  for (const r of table.rules) {
    const m = core.match(r.re);
    if (!m) continue;
    // a pattern with hardly any fixed text ("${}m", "${} min") may only stand for numbers, never for a whole word
    if (r.weight < 6 && m.slice(1).some((c) => !/^[\d.,:+\-−$€%\s]+$/.test(c))) continue;
    // captured values (a weekday, a session name, ...) are translated too when they are known phrases
    return r.out.replace(/\u0000(\d+)\u0000/g, (_x, n) => {
      const cap = m[Number(n) + 1];
      return lookup(norm(cap), table, depth + 1) ?? cap;
    });
  }
  return null;
}

const HAS_LATIN = /[A-Za-z]/;
const HAS_ARABIC = /[؀-ۿ]/;

/** Translates `text` for `lang`, or returns null when there is nothing to translate (it is already in that language / unknown). */
export function translate(text: string, lang: Lang): string | null {
  if (lang === "fa" ? !HAS_LATIN.test(text) : !HAS_ARABIC.test(text)) return null;
  const lead = text.match(/^\s*/)![0], trail = text.match(/\s*$/)![0];
  const core = norm(text);
  if (!core) return null;
  const out = lookup(core, lang === "fa" ? TO_FA : TO_EN);
  return out === null ? null : lead + out + trail;
}

/** For strings built in code (confirm dialogs, notifications, canvas labels) that the DOM translator can't see. */
export function t(text: string): string {
  return translate(text, getSettings().lang) ?? text;
}

/** Locale for dates/month names shown in the UI: Persian names on the Gregorian calendar with Latin digits (prices and times stay Latin). */
export function dateLocale(en = "en-US"): string {
  return getSettings().lang === "fa" ? "fa-u-ca-gregory-nu-latn" : en;
}

export function getLang(): Lang {
  return getSettings().lang;
}

export function setLang(lang: Lang): void {
  patchSettings({ lang });
  window.location.reload(); // canvases, dialogs and initial state all come up in the new language
}


