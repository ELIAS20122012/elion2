// Text → Persian voice note (edge-tts + ffmpeg, via the video venv). Used for spoken Telegram replies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export type Speaker = (text: string) => Promise<string>;

/** Strips markdown/emoji noise and keeps the reply short enough to listen to. */
export function speakable(text: string, max = 700): string {
  const t = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>|~]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("؟"), cut.lastIndexOf("!"));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut) + " …";
}

export function makeSpeaker(home: string, voice = "fa-IR-FaridNeural", python?: string, ext: "ogg" | "wav" = "ogg"): Speaker | null {
  const py = python ?? (process.platform === "win32" ? path.join(home, "data", "video-venv", "Scripts", "python.exe") : path.join(home, "data", "video-venv", "bin", "python"));
  const script = path.join(home, "video", "tts.py");
  if ((/[\\/]/.test(py) && !fs.existsSync(py)) || !fs.existsSync(script)) return null;
  return (text) =>
    new Promise((resolve, reject) => {
      const out = path.join(os.tmpdir(), `elias-tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
      const p = spawn(py, [script, out, voice], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      const killer = setTimeout(() => p.kill(), 120_000);
      p.on("close", (code) => {
        clearTimeout(killer);
        if (code === 0 && fs.existsSync(out)) resolve(out);
        else reject(new Error(`tts failed (${code}): ${err.slice(-300)}`));
      });
      p.stdin.end(speakable(text), "utf8");
    });
}
