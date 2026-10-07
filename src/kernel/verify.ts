// Verification step of the loop: plan → execute → verify → correct → retry.
import type { VerifySpec } from "./types.ts";

export interface VerifyResult {
  ok: boolean;
  reason: string;
}

export function verifyOutput(spec: VerifySpec, output: string): VerifyResult {
  switch (spec.type) {
    case "none":
      return { ok: true, reason: "no verification requested" };
    case "non_empty":
      return output.trim().length > 0
        ? { ok: true, reason: "output is non-empty" }
        : { ok: false, reason: "output was empty" };
    case "contains":
      return output.includes(spec.text)
        ? { ok: true, reason: `output contains "${spec.text}"` }
        : { ok: false, reason: `output must contain "${spec.text}"` };
    case "regex": {
      const re = new RegExp(spec.pattern, spec.flags);
      return re.test(output)
        ? { ok: true, reason: `output matches /${spec.pattern}/` }
        : { ok: false, reason: `output must match /${spec.pattern}/${spec.flags ?? ""}` };
    }
    case "json": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(output));
      } catch {
        return { ok: false, reason: "output must be valid JSON" };
      }
      const missing = (spec.requiredKeys ?? []).filter(
        (k) => typeof parsed !== "object" || parsed === null || !(k in (parsed as Record<string, unknown>)),
      );
      return missing.length
        ? { ok: false, reason: `JSON is missing keys: ${missing.join(", ")}` }
        : { ok: true, reason: "valid JSON with required keys" };
    }
  }
}

/** Accept JSON wrapped in a ```json fenced block, which models often produce. */
export function extractJson(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1]! : s).trim();
}

/** Parses CLI shorthand: "none" | "non_empty" | "contains:TEXT" | "regex:PATTERN" | "json" | "json:a,b". */
export function parseVerify(s: string | undefined): VerifySpec {
  if (!s || s === "non_empty") return { type: "non_empty" };
  if (s === "none") return { type: "none" };
  const idx = s.indexOf(":");
  const kind = idx === -1 ? s : s.slice(0, idx);
  const arg = idx === -1 ? "" : s.slice(idx + 1);
  if (kind === "contains" && arg) return { type: "contains", text: arg };
  if (kind === "regex" && arg) return { type: "regex", pattern: arg };
  if (kind === "json") return { type: "json", requiredKeys: arg ? arg.split(",").map((k) => k.trim()) : [] };
  throw new Error(`Unknown verify spec "${s}". Use none | non_empty | contains:X | regex:X | json[:k1,k2]`);
}
