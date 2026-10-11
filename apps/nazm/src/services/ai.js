/* Food-photo calorie estimation.
   Order of attempts: the host's own model (when embedded in a Claude artifact) → a Gemini API key the user saved
   in Settings (works in any browser) → nothing (the caller falls back to manual entry). */
import { num } from '../core/format.js';

const KEY_STORAGE = 'daily-order-gemini-key'; // kept out of the app document so backups never contain it
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

export const FOOD_PROMPT = 'You are a nutrition assistant. Look at this photo of a meal and estimate the total calories of the visible portion. '
  + 'Reply with only JSON: {"name": string (dish name in Persian/Farsi), "kcal": number, "protein": number (grams)}. '
  + 'If the image is not food, reply {"name": "غذا تشخیص داده نشد", "kcal": 0, "protein": 0}.';

export function getGeminiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function setGeminiKey(value) {
  try { if (value) localStorage.setItem(KEY_STORAGE, value.trim()); else localStorage.removeItem(KEY_STORAGE); } catch { /* storage unavailable */ }
}

/** Optional host capabilities (e.g. embedded in a Claude artifact). Resolves null when absent. */
export function cap(name) {
  const candidates = [window, window.parent !== window ? window.parent : null];
  for (const w of candidates) {
    try {
      if (w && w.claude && w.claude.use) return w.claude.use(name).catch(() => null);
    } catch { /* cross-origin parent */ }
  }
  return Promise.resolve(null);
}

/** Normalise whatever the model returned into { name, kcal }. */
export function parseFood(raw) {
  let r = raw;
  if (typeof r === 'string') {
    const m = r.match(/\{[\s\S]*\}/);
    if (!m) throw { code: 'bad_response' };
    r = JSON.parse(m[0]);
  }
  if (!r || typeof r !== 'object') throw { code: 'bad_response' };
  return { name: String(r.name || 'غذا').trim() || 'غذا', kcal: Math.max(0, Math.round(num(r.kcal))), protein: Math.max(0, Math.round(num(r.protein))) };
}

async function viaHost(file) {
  const sample = await cap('sample');
  if (!sample) return null;
  const limits = sample.limits ? await sample.limits().catch(() => null) : null;
  if (!limits || !limits.images) return null;
  return parseFood(await sample.json(FOOD_PROMPT, { images: [file], modelTier: 'default' }));
}

async function viaGemini(key, dataUrl, fetchImpl = fetch) {
  const [head, data] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const res = await fetchImpl(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: FOOD_PROMPT }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  if (!res.ok) throw { code: res.status === 400 || res.status === 403 ? 'bad_key' : 'http_error', status: res.status };
  const body = await res.json();
  const text = body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts
    && body.candidates[0].content.parts.map((p) => p.text || '').join('');
  return parseFood(text || '');
}

/** file → { name, kcal }. Throws { code } when no method is available or the call failed. */
export async function estimateFood(file, shrink) {
  const host = await viaHost(file).catch(() => null);
  if (host) return host;
  const key = getGeminiKey();
  if (!key) throw { code: 'no_method' };
  const dataUrl = await shrink(file, 1024);
  if (!dataUrl) throw { code: 'bad_image' };
  return viaGemini(key, dataUrl);
}

export { viaGemini as _viaGemini };
