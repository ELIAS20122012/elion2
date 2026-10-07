// Installs Claude-format skills (folders with SKILL.md, or .zip of them) into the agent workspace
// (data/workspace/.claude/skills). Claude Code loads them on its own when a task matches their description.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface ImportResult {
  installed: string[];
  skipped: number;
  errors: string[];
}

function unzip(zip: string, dest: string): void {
  // Windows 10+ ships bsdtar, which reads zip and refuses absolute / ".." paths.
  if (process.platform === "win32") execFileSync("tar", ["-xf", zip, "-C", dest], { stdio: "pipe" });
  else execFileSync("unzip", ["-oq", zip, "-d", dest], { stdio: "pipe" });
}

export function claudeSkillsDir(workspace: string): string {
  return path.join(workspace, ".claude", "skills");
}

export function listClaudeSkills(workspace: string): string[] {
  const dir = claudeSkillsDir(workspace);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "SKILL.md"))).sort();
}

/** Imports every *.zip and SKILL.md folder in `src` (names starting with "_" or "." are ignored). Unchanged ones are skipped. */
export function importClaudeSkills(src: string, workspace: string): ImportResult {
  const dest = claudeSkillsDir(workspace);
  fs.mkdirSync(dest, { recursive: true });
  const r: ImportResult = { installed: [], skipped: 0, errors: [] };
  if (!fs.existsSync(src)) throw new Error(`Folder not found: ${src}`);
  for (const name of fs.readdirSync(src).sort()) {
    if (name.startsWith("_") || name.startsWith(".")) continue;
    const full = path.join(src, name);
    try {
      if (name.toLowerCase().endsWith(".zip")) {
        const skill = name.slice(0, -4);
        const target = path.join(dest, skill, "SKILL.md");
        if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(full).mtimeMs) {
          r.skipped++;
          continue;
        }
        unzip(full, dest);
        if (!fs.existsSync(target)) throw new Error("zip has no <name>/SKILL.md");
        fs.utimesSync(target, new Date(), new Date());
        r.installed.push(skill);
      } else if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "SKILL.md"))) {
        fs.cpSync(full, path.join(dest, name), { recursive: true });
        r.installed.push(name);
      }
    } catch (e) {
      r.errors.push(`${name}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return r;
}
