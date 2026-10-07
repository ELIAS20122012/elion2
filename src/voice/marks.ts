// Chart markup: reads image size and draws AI-provided horizontal levels (video venv + Pillow).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export interface Level {
  y: number;
  label: string;
  type?: "res" | "sup" | "other";
}

/** Width/height of a PNG or JPEG without dependencies. */
export function imageSize(file: string): { w: number; h: number } | null {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

/** Pulls the "MARKS: {...}" line out of an AI answer. */
export function extractMarks(result: string): { text: string; levels: Level[] } {
  let levels: Level[] = [];
  const text = result
    .split(/\r?\n/)
    .filter((line) => {
      const m = line.trim().replace(/^`+|`+$/g, "").match(/^MARKS:\s*(\{.*\})\s*$/);
      if (!m) return true;
      try {
        const j = JSON.parse(m[1]!) as { levels?: Level[] };
        levels = (j.levels ?? []).filter((l) => Number.isFinite(Number(l.y))).slice(0, 8);
      } catch {
        /* ignore malformed marks */
      }
      return false;
    })
    .join("\n")
    .trim();
  return { text, levels };
}

export type Marker = (image: string, levels: Level[]) => Promise<string>;

export function makeMarker(home: string): Marker | null {
  const py = process.platform === "win32" ? path.join(home, "data", "video-venv", "Scripts", "python.exe") : path.join(home, "data", "video-venv", "bin", "python");
  const script = path.join(home, "video", "mark_chart.py");
  if (!fs.existsSync(py) || !fs.existsSync(script)) return null;
  const font = path.join(home, "data", "fonts", "Vazirmatn-Regular.ttf");
  return (image, levels) =>
    new Promise((resolve, reject) => {
      const out = path.join(os.tmpdir(), `elias-marked-${Date.now()}.jpg`);
      execFile(py, [script, image, out, JSON.stringify({ levels, font: fs.existsSync(font) ? font : undefined })], { windowsHide: true, timeout: 60_000 }, (err) =>
        err ? reject(err) : resolve(out),
      );
    });
}
