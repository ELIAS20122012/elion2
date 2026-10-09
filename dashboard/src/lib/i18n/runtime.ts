import { getSettings } from "../elionSettings";
import { translate, type Lang } from "./index";

/**
 * Translates the page as React renders it: every text node and title/placeholder/aria-label is looked up in
 * the dictionary the moment it appears (a MutationObserver runs before the browser paints, so there is no
 * flash of the other language). The original text is remembered per node, so React updating a node just
 * gets translated again. Persian text is right-to-left inside its own element; the page layout stays as designed.
 */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "CODE"]);
const orig = new WeakMap<Node, string>();
const applied = new WeakMap<Node, string>();
const attrApplied = new WeakMap<Element, Record<string, string>>();
const ATTRS = ["title", "placeholder", "aria-label"];

let lang: Lang = "en";

function skipEl(el: Element | null, attrs = false): boolean {
  // an icon's text is a ligature name, never translated; but its title/aria-label/placeholder is real text
  if (!el) return true;
  if (attrs) return el.tagName === "SCRIPT" || el.tagName === "STYLE" || !!el.closest("[data-no-i18n]");
  return SKIP_TAGS.has(el.tagName) || !!el.closest(".e-icon,[data-no-i18n]");
}

function mark(el: Element): void {
  if (lang !== "fa") return;
  el.setAttribute("data-fa", "");
  if (el.childElementCount === 0) el.setAttribute("dir", "auto");
}

function processText(n: Text): void {
  const cur = n.nodeValue ?? "";
  if (applied.get(n) === cur) return; // our own translation
  const p = n.parentElement;
  if (skipEl(p)) return;
  orig.set(n, cur);
  applied.delete(n);
  const out = translate(cur, lang);
  if (out !== null && out !== cur) {
    applied.set(n, out);
    n.nodeValue = out;
    mark(p!);
  }
}

function processAttr(el: Element, name: string): void {
  if (skipEl(el, true)) return;
  const cur = el.getAttribute(name);
  if (cur == null) return;
  const done = attrApplied.get(el) ?? {};
  if (done[name] === cur) return;
  const out = translate(cur, lang);
  if (out !== null && out !== cur) {
    done[name] = out;
    attrApplied.set(el, done);
    el.setAttribute(name, out);
  } else if (done[name] !== undefined) {
    delete done[name];
  }
}

function walk(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) return processText(node as Text);
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (skipEl(el, true)) return;
  for (const a of ATTRS) if (el.hasAttribute(a)) processAttr(el, a);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let c = tw.nextNode(); c; c = tw.nextNode()) {
    if (c.nodeType === Node.TEXT_NODE) processText(c as Text); // (icon text is skipped inside processText)
    else for (const a of ATTRS) if ((c as Element).hasAttribute(a)) processAttr(c as Element, a);
  }
}

export function startTranslator(): void {
  lang = getSettings().lang;
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle("lang-fa", lang === "fa");
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") processText(m.target as Text);
      else if (m.type === "attributes" && m.attributeName) processAttr(m.target as Element, m.attributeName);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  walk(document.body);
}


