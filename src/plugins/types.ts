// Plugin contract. A plugin adds capabilities to the fixed core: context sources, providers, skills.
// Plugins never touch the DB directly — they go through the kernel (permissions + log stay enforced).
import type { Kernel } from "../kernel/kernel.ts";

export interface PluginContext {
  kernel: Kernel;
  /** config.plugins.options[<plugin name>] */
  options: Record<string, unknown>;
  /** Elias OS home folder (config/, data/, skills/, plugins/). */
  home: string;
}

export interface Plugin {
  name: string;
  version?: string;
  description: string;
  setup(ctx: PluginContext): void | Promise<void>;
}

export interface LoadedPlugin {
  name: string;
  version: string;
  description: string;
  source: "builtin" | "local";
  error?: string;
}
