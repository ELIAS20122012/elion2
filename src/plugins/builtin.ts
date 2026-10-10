// Built-in plugins: everything outside the kernel is a plugin, including Google and the briefing.
import path from "node:path";
import { GoogleAuth, googleContextSources } from "../connectors/google.ts";
import { briefingTask } from "../agents/briefing.ts";
import { loadSkillDir } from "./markdown-skills.ts";
import type { Plugin } from "./types.ts";
import { memoryPlugin } from "./memory.ts";
import { tradingPlugin } from "./trading.ts";
import { youtubePlugin } from "./youtube.ts";
import { videoPlugin } from "./video.ts";
import { aiVideoPlugin } from "./aivideo.ts";
import { remindersPlugin } from "./reminders.ts";
import { appointmentsPlugin } from "./appointments.ts";
import { maintenancePlugin } from "./maintenance.ts";
import { vaultPlugin } from "./vault.ts";
import { mt4Plugin } from "./mt4.ts";
import { healthPlugin } from "./health.ts";
import { researchPlugin } from "./research.ts";
import { teamPlugin } from "./team.ts";
import { websitePlugin } from "./website.ts";
import { pcPlugin } from "./pc.ts";

export const corePlugin: Plugin = {
  name: "core",
  description: "Open tasks and approvals as context (tasks:open)",
  setup({ kernel }) {
    kernel.registerContextSource({
      name: "tasks:open",
      capability: "read:tasks",
      description: "Open tasks and pending approvals in Elias OS",
      fetch: async () => {
        const open = kernel.listTasks({ limit: 200 }).filter((t) => ["queued", "awaiting_approval"].includes(t.status));
        const since = Date.now() - 24 * 3600_000;
        const failed = kernel.listTasks({ status: "failed", limit: 50 }).filter((t) => new Date(t.updatedAt).getTime() > since);
        const approvals = kernel.listApprovals("pending");
        const lines = [
          ...open.map((t) => `- [${t.status}] ${t.title}`),
          ...failed.map((t) => `- [failed in last 24h: ${t.failureKind}] ${t.title}`),
          ...approvals.map((a) => `- [waiting for Elias's approval] ${a.capability}`),
        ];
        return lines.length ? lines.join("\n") : "No open tasks or pending approvals.";
      },
    });
  },
};

export const googlePlugin: Plugin = {
  name: "google",
  description: "Gmail + Calendar, read-only (gmail:recent, calendar:upcoming)",
  setup({ kernel, home }) {
    for (const src of googleContextSources(new GoogleAuth(path.join(home, "config")))) kernel.registerContextSource(src);
  },
};

export const briefingPlugin: Plugin = {
  name: "briefing",
  description: "Morning briefing skill (/brief)",
  setup({ kernel }) {
    kernel.registerSkill({ name: "brief", description: "گزارش صبح (تقویم + ایمیل + کارها)", plugin: "briefing", build: () => briefingTask() });
  },
};

export const skillsPlugin: Plugin = {
  name: "skills",
  description: "Markdown skills from skills/*.md",
  setup({ kernel, home }) {
    const { skills, errors } = loadSkillDir(path.join(home, "skills"));
    for (const s of skills) kernel.registerSkill(s);
    for (const e of errors) kernel.log("skill.invalid", e, { level: "warn" });
  },
};

export const BUILTIN_PLUGINS = [corePlugin, memoryPlugin, googlePlugin, briefingPlugin, tradingPlugin, youtubePlugin, videoPlugin, aiVideoPlugin, remindersPlugin, appointmentsPlugin, maintenancePlugin, vaultPlugin, mt4Plugin, healthPlugin, researchPlugin, teamPlugin, websitePlugin, pcPlugin(), skillsPlugin];
