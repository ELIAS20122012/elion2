// Long-term memory as a Markdown file (data/knowledge/memory.md): Elias adds facts with /remember,
// every chat task gets them as context (memory:notes). Plain text, editable in Obsidian/Notepad.
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "./types.ts";
import { registerPanel } from "../interfaces/dashboard.ts";

export function memoryFile(home: string): string {
  return path.join(home, "data", "knowledge", "memory.md");
}

export function readNotes(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
}

export function writeNotes(file: string, notes: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Elias OS memory\n\n${notes.map((n) => `- ${n}`).join("\n")}\n`, "utf8");
}

export const memoryPlugin: Plugin = {
  name: "memory",
  description: "Long-term notes: /remember /notes /forget, context memory:notes",
  setup({ kernel, home }) {
    const file = memoryFile(home);
    registerPanel("memory", () => ({ notes: readNotes(file) }));
    kernel.registerContextSource({
      name: "memory:notes",
      capability: "read:memory",
      description: "Facts Elias asked Elias OS to remember",
      fetch: async () => {
        const n = readNotes(file);
        return n.length ? n.map((x) => `- ${x}`).join("\n") : "No saved notes.";
      },
    });
    kernel.registerCommand({
      name: "remember",
      description: "به خاطر بسپار (/remember متن)",
      plugin: "memory",
      run(args) {
        const text = args.replace(/\s+/g, " ").trim();
        if (!text) return "استفاده: /remember متن";
        const notes = readNotes(file);
        if (notes.includes(text)) return "قبلاً ذخیره شده.";
        writeNotes(file, [...notes, text]);
        kernel.log("memory.added", text.slice(0, 80));
        return `🧠 ذخیره شد (#${notes.length + 1})`;
      },
    });
    kernel.registerCommand({
      name: "notes",
      description: "یادداشت‌های ذخیره‌شده",
      plugin: "memory",
      run() {
        const n = readNotes(file);
        return n.length ? n.map((x, i) => `${i + 1}. ${x}`).join("\n") : "یادداشتی نیست. /remember متن";
      },
    });
    kernel.registerCommand({
      name: "forget",
      description: "حذف یادداشت (/forget شماره)",
      plugin: "memory",
      run(args) {
        const i = Number(args.trim()) - 1;
        const n = readNotes(file);
        if (!Number.isInteger(i) || i < 0 || i >= n.length) return "استفاده: /forget شماره (از /notes)";
        const [gone] = n.splice(i, 1);
        writeNotes(file, n);
        kernel.log("memory.removed", String(gone).slice(0, 80));
        return `🗑 حذف شد: ${gone}`;
      },
    });
  },
};
