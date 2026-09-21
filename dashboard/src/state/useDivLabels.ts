import { useCallback, useEffect, useState } from "react";
import { journalApi, type RuleLabel } from "../lib/journalApi";

const RULE = "divergence";

/** Elias's verdicts (✓ / ✗) on what the divergence rule found. Stored in the journal server, so every device sees the same. */
export function useDivLabels() {
  const [labels, setLabels] = useState<Map<string, RuleLabel>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await journalApi.ruleLabels(RULE);
      setLabels(new Map(rows.map((r) => [r.key, r])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const set = useCallback(async (key: string, label: "ok" | "bad", features: Record<string, number>) => {
    setLabels((m) => new Map(m).set(key, { key, label, features, updated_at: Math.floor(Date.now() / 1000) })); // show it at once
    try {
      await journalApi.setRuleLabel(RULE, key, label, features);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ذخیره نشد");
      void load();
    }
  }, [load]);

  const clear = useCallback(async (key: string) => {
    setLabels((m) => { const n = new Map(m); n.delete(key); return n; });
    try {
      await journalApi.clearRuleLabel(RULE, key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "پاک نشد");
      void load();
    }
  }, [load]);

  return { labels, set, clear, error, reload: load };
}
