// Skills written as Markdown files in <home>/skills/*.md — no code needed.
//
// ---
// name: mail
// description: ایمیل‌های مهم همین الان
// capabilities: read:email
// context: gmail:recent
// verify: contains:📧          (or: non_empty | regex:<pattern> | json:k1,k2 | none)
// provider: auto               (optional)
// timeout: 300                 (seconds, optional)
// ---
// Prompt text. {{input}} is replaced with what the user typed after the command.
import fs from "node:fs";
import path from "node:path";
import type { Skill, TaskInput } from "../kernel/types.ts";
import { parseVerify } from "../kernel/verify.ts";

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function parseSkillMd(text: string, fallbackName: string): Skill {
  const m = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").match(/^---\n(?:([\s\S]*?)\n)?---(?:\n|$)([\s\S]*)$/);
  if (!m) throw new Error("missing --- front matter ---");
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const body = (m[2] ?? "").trim();
  if (!body) throw new Error("empty prompt");
  const name = (meta.name || fallbackName).toLowerCase();
  const verify = parseVerify(meta.verify);
  const timeout = Number(meta.timeout);
  return {
    name,
    description: meta.description || name,
    plugin: "skills",
    build(input: string): TaskInput {
      const prompt = body.includes("{{input}}")
        ? body.replaceAll("{{input}}", input || "(nothing)")
        : input ? `${body}\n\nRequest from Elias: ${input}` : body;
      return {
        title: meta.title || meta.description || name,
        prompt,
        capabilities: list(meta.capabilities),
        context: list(meta.context),
        verify,
        ...(meta.provider ? { provider: meta.provider } : {}),
        ...(timeout > 0 ? { timeoutMs: timeout * 1000 } : {}),
      };
    },
  };
}

/** Loads every skills/*.md; a broken file is reported, never fatal. */
export function loadSkillDir(dir: string): { skills: Skill[]; errors: string[] } {
  const skills: Skill[] = [];
  const errors: string[] = [];
  if (!fs.existsSync(dir)) return { skills, errors };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    try {
      skills.push(parseSkillMd(fs.readFileSync(path.join(dir, f), "utf8"), path.basename(f, ".md")));
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
    }
  }
  return { skills, errors };
}
