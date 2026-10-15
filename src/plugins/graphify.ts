// Code knowledge graph (graphify, local tree-sitter — no LLM, no cost). Coding agents read
// graphify-out/GRAPH_REPORT.md / `graphify query` instead of whole files → far fewer tokens.
// Nightly 03:45 rebuild of Elias OS + sibling projects; /graph update · /graph <question>.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { Plugin } from "./types.ts";

export function graphifyBin(home: string): string {
  return process.platform === "win32"
    ? path.join(home, "data", "graphify-venv", "Scripts", "graphify.exe")
    : path.join(home, "data", "graphify-venv", "bin", "graphify");
}

/** Elias OS itself + every sibling project folder next to it (e.g. C:\Elion\trading-robot). */
export function graphProjects(home: string, extra: string[] = []): string[] {
  const parent = path.dirname(home);
  const siblings = fs.existsSync(parent)
    ? fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => path.join(parent, d.name))
    : [];
  return [...new Set([home, ...siblings, ...extra].map((p) => path.resolve(p)))].filter((p) => fs.existsSync(p));
}

function run(bin: string, args: string[], cwd: string, timeout = 15 * 60_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(bin, args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, (err, stdout, stderr) =>
      err ? reject(new Error(`${err.message}\n${String(stderr).slice(-400)}`)) : resolve(String(stdout)),
    ),
  );
}

export const graphifyPlugin: Plugin = {
  name: "graphify",
  description: "Code knowledge graphs for coding agents (graphify, local, free) — /graph",
  setup({ kernel, home, options }) {
    const bin = graphifyBin(home);
    const projects = () => graphProjects(home, (options.extra as string[] | undefined) ?? []);
    const ready = () => fs.existsSync(bin);
    const updateAll = async () => {
      const lines: string[] = [];
      for (const p of projects()) {
        try {
          const out = await run(bin, ["update", "."], p);
          lines.push(`✅ ${path.basename(p)}: ${out.match(/Rebuilt: ([^\n]+)/)?.[1] ?? "updated"}`);
        } catch (e) {
          lines.push(`⚠️ ${path.basename(p)}: ${(e as Error).message.split("\n")[0]!.slice(0, 120)}`);
        }
      }
      return lines.join("\n");
    };

    kernel.registerProvider({
      name: "graphify",
      health: async () => ({ ok: ready(), detail: ready() ? bin : "graphify not installed (graphify-setup.cmd)" }),
      execute: async () => {
        if (!ready()) throw new Error("graphify not installed");
        return { output: await updateAll() };
      },
    });
    if (!kernel.getSchedule("graph-refresh")) {
      kernel.addSchedule("graph-refresh", "45 3 * * *", { title: "🕸 به‌روزرسانی نقشه‌ی کد", prompt: "update", provider: "graphify", source: "internal", verify: { type: "non_empty" }, maxAttempts: 1 });
    }

    kernel.registerCommand({
      name: "graph",
      description: "نقشه‌ی کد پروژه‌ها (/graph update · /graph سؤال درباره‌ی کد)",
      plugin: "graphify",
      async run(args) {
        if (!ready()) return "graphify نصب نیست — graphify-setup.cmd را اجرا کن.";
        const a = args.trim();
        if (!a || a === "status") {
          return `🕸 نقشه‌ی کد:\n${projects().map((p) => `- ${path.basename(p)}: ${fs.existsSync(path.join(p, "graphify-out", "graph.json")) ? "✅" : "—"}`).join("\n")}\n\n/graph update · /graph <سؤال>`;
        }
        if (a === "update") return `🕸 به‌روز شد:\n${await updateAll()}`;
        const [first, ...rest] = a.split(/\s+/);
        const proj = projects().find((p) => path.basename(p).toLowerCase() === first!.toLowerCase());
        const cwd = proj ?? home;
        const q = proj ? rest.join(" ") : a;
        const out = await run(bin, ["query", q, "--budget", "600"], cwd, 60_000);
        return `🕸 ${path.basename(cwd)}:\n${out.slice(0, 3500)}`;
      },
    });
  },
};
