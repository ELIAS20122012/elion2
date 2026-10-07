// Loads built-in plugins (sync, in createKernel) and local plugins from <home>/plugins (async, at startup).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Kernel } from "../kernel/kernel.ts";
import type { LoadedPlugin, Plugin } from "./types.ts";

export interface PluginsConfig {
  /** Plugin names to skip (built-in or local). */
  disabled?: string[];
  /** Per-plugin options, keyed by plugin name. */
  options?: Record<string, Record<string, unknown>>;
}

const registry = new WeakMap<Kernel, LoadedPlugin[]>();

export function loadedPlugins(k: Kernel): LoadedPlugin[] {
  return registry.get(k) ?? [];
}

function record(k: Kernel, p: LoadedPlugin): void {
  const list = registry.get(k) ?? [];
  list.push(p);
  registry.set(k, list);
}

function ctx(k: Kernel, p: Plugin, home: string, cfg: PluginsConfig) {
  return { kernel: k, home, options: cfg.options?.[p.name] ?? {} };
}

export function loadBuiltinPlugins(k: Kernel, plugins: Plugin[], home: string, cfg: PluginsConfig = {}): void {
  for (const p of plugins) {
    if (cfg.disabled?.includes(p.name)) continue;
    const info: LoadedPlugin = { name: p.name, version: p.version ?? "builtin", description: p.description, source: "builtin" };
    try {
      const r = p.setup(ctx(k, p, home, cfg));
      if (r instanceof Promise) throw new Error("built-in plugins must set up synchronously");
    } catch (e) {
      info.error = (e as Error).message;
      k.log("plugin.failed", `${p.name}: ${info.error}`, { level: "error" });
    }
    record(k, info);
  }
}

function entryOf(dir: string, name: string): string | null {
  const full = path.join(dir, name);
  if (fs.statSync(full).isDirectory()) {
    for (const f of ["index.ts", "index.mjs", "index.js"]) if (fs.existsSync(path.join(full, f))) return path.join(full, f);
    return null;
  }
  return /\.(ts|mjs|js)$/.test(name) && !name.endsWith(".d.ts") ? full : null;
}

/** Local plugins are trusted code on Elias's own PC: <home>/plugins/<name>/index.ts (default export: Plugin). */
export async function loadLocalPlugins(k: Kernel, home: string, cfg: PluginsConfig = {}): Promise<void> {
  const dir = path.join(home, "plugins");
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const entry = entryOf(dir, name);
    if (!entry) continue;
    const info: LoadedPlugin = { name: name.replace(/\.(ts|mjs|js)$/, ""), version: "?", description: "", source: "local" };
    try {
      const mod = (await import(pathToFileURL(entry).href)) as { default?: Plugin };
      const p = mod.default;
      if (!p || typeof p.setup !== "function" || !p.name) throw new Error("default export must be a Plugin { name, description, setup }");
      Object.assign(info, { name: p.name, version: p.version ?? "0.0.0", description: p.description ?? "" });
      if (cfg.disabled?.includes(p.name) || loadedPlugins(k).some((x) => x.name === p.name)) continue;
      await p.setup(ctx(k, p, home, cfg));
      k.log("plugin.loaded", `${p.name} ${info.version}`, { level: "debug" });
    } catch (e) {
      info.error = (e as Error).message;
      k.log("plugin.failed", `${info.name}: ${info.error}`, { level: "error" });
    }
    record(k, info);
  }
}
