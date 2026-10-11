/* Saving, picking and shrinking files. */
import { toast } from '../ui/toast.js';
import { cap } from './ai.js';

/** Save text through the host's download capability when present, else an <a download>. */
export async function saveFile(filename, data, mime, doneMsg = 'فایل آماده شد') {
  const host = await cap('downloads');
  if (host) {
    try { await host.save({ filename, data }); toast(doneMsg); } catch { toast('ذخیره فایل لغو شد'); }
    return;
  }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('فایل دانلود شد');
  } catch { toast('دانلود در این محیط ممکن نیست'); }
}

export function pickFile(accept, capture, cb) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  if (capture) input.setAttribute('capture', 'environment');
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = () => { const f = input.files && input.files[0]; input.remove(); if (f) cb(f); };
  input.click();
}

/** Downscale an image file to a small JPEG data URL (null on failure). */
export function shrinkImage(file, max, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    cb(canvas.toDataURL('image/jpeg', 0.7));
  };
  img.onerror = () => { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}

/** Promise flavour of shrinkImage: resolves a JPEG data URL, or null on failure. */
export const shrinkImageAsync = (file, max) => new Promise((resolve) => shrinkImage(file, max, resolve));
