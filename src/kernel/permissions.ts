// Permission policy lives in the kernel. Every capability a task declares is checked
// BEFORE any provider runs. Unknown capabilities fall back to `default` (approve = safe).

export type Decision = "allow" | "approve" | "deny";

export interface Policy {
  default: Decision;
  rules: Record<string, Decision>;
}

/** Low-risk work runs autonomously; publishing, payments, deletes and real trades need Elias's approval. */
export const DEFAULT_POLICY: Policy = {
  default: "approve",
  rules: {
    "read:*": "allow",
    "think:*": "allow",
    "write:draft": "allow",
    "write:notes": "allow",
    "notify:telegram": "allow",
    "send:*": "approve",
    "publish:*": "approve",
    "payment:*": "approve",
    "delete:*": "approve",
    "trade:execute": "approve",
    "system:shell": "approve",
  },
};

const CAP_RE = /^[a-z0-9_-]+:[a-z0-9_.*-]+$/;

export function isValidCapability(cap: string): boolean {
  return CAP_RE.test(cap);
}

/** Exact rule wins; otherwise the longest matching `prefix:*` wildcard; otherwise policy default. */
export function decide(policy: Policy, capability: string): Decision {
  const exact = policy.rules[capability];
  if (exact) return exact;
  let best: { len: number; d: Decision } | null = null;
  for (const [pattern, d] of Object.entries(policy.rules)) {
    if (!pattern.endsWith("*")) continue;
    const prefix = pattern.slice(0, -1);
    if (capability.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, d };
  }
  return best ? best.d : policy.default;
}

export function mergePolicy(base: Policy, override?: Partial<Policy>): Policy {
  if (!override) return base;
  return { default: override.default ?? base.default, rules: { ...base.rules, ...(override.rules ?? {}) } };
}
