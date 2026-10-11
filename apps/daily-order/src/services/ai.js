/* Optional host capabilities (e.g. image understanding when embedded in a Claude artifact).
   Outside such a host every call resolves to null / rejects with { code: 'unavailable' }. */
export function cap(name) {
  const candidates = [window, window.parent !== window ? window.parent : null];
  for (const w of candidates) {
    try {
      if (w && w.claude && w.claude.use) return w.claude.use(name).catch(() => null);
    } catch { /* cross-origin parent */ }
  }
  return Promise.resolve(null);
}

export async function askVision(file, prompt) {
  const sample = await cap('sample');
  if (!sample) throw { code: 'unavailable' };
  const limits = sample.limits ? await sample.limits().catch(() => null) : null;
  if (!limits || !limits.images) throw { code: 'images_unavailable' };
  return sample.json(prompt, { images: [file], modelTier: 'default' });
}
