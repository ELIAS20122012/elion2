import { describe, expect, it } from "vitest";
import { fromMirror } from "./[[path]]";

/** A miniature journal: one account, one closed trade and one still open. */
const snap = {
  version: 1,
  generated_at: 1_790_000_000,
  accounts: [{ id: 34, name: "ecn", platform: "mt4", trade_count: 2 }],
  trades: {
    "34": [
      { id: 1, account_id: 34, ticket: "a", profit: 1.5, close_time: 1_789_999_000 },
      { id: 2, account_id: 34, ticket: "b", profit: -0.75, close_time: null },
    ],
  },
  snapshots: { "34": [{ time: 1_789_999_000, balance: 76, equity: 75.25 }] },
  rule_labels: { divergence: [{ rule: "divergence", key: "k", label: "ok" }] },
} as never;

const get = (path: string) => fromMirror(path, "GET", snap);
const body = <T>(res: Response) => res.json() as Promise<T>;

describe("mirror responses", () => {
  it("always answers as JSON and says where the data came from", async () => {
    for (const path of ["/health", "/accounts", "/accounts/34/trades", "/nope"]) {
      const res = get(path);
      expect(res.headers.get("content-type"), path).toContain("application/json");
      expect(res.headers.get("x-journal-source"), path).toBe("mirror");
    }
  });

  it("serves the journal the dashboard needs to render", async () => {
    expect(await body<{ mirror: boolean }>(get("/health"))).toMatchObject({ ok: true, mirror: true });
    expect(await body<unknown[]>(get("/accounts"))).toHaveLength(1);
    expect(await body<unknown[]>(get("/accounts/34/trades"))).toHaveLength(2);
    expect(await body<unknown[]>(get("/accounts/34/snapshots"))).toHaveLength(1);
    expect(await body<unknown[]>(get("/rule-labels/divergence"))).toHaveLength(1);
    expect(await body<unknown[]>(get("/rule-labels/unknown-rule"))).toEqual([]);
  });

  it("reports the feed as disconnected but still totals the open trades", async () => {
    const live = await body<Record<string, unknown>>(get("/accounts/34/live"));
    expect(live).toMatchObject({ connected: false, offline: true, open_count: 1, floating: -0.75 });
  });

  it("reports the trading engine as off rather than unknown", async () => {
    expect(await body<Record<string, { on: boolean }>>(get("/engine"))).toMatchObject({
      mt4: { on: false },
      mt5: { on: false },
    });
  });

  it("404s an account it does not hold", async () => {
    expect(get("/accounts/999/trades").status).toBe(404);
  });

  it("refuses, rather than fakes, anything that needs a live terminal", async () => {
    for (const path of ["/accounts/34/candles", "/news", "/bridge/info", "/mt5/terminals", "/whatever"]) {
      const res = get(path);
      expect(res.status, path).toBe(503);
      expect(await body<{ detail: string }>(res), path).toHaveProperty("detail");
    }
  });

  it("refuses every write, so a mirrored session can never place an order", async () => {
    const writes: Array<[string, string]> = [
      ["PUT", "/trades/1/notes"],
      ["POST", "/accounts/34/order"],
      ["POST", "/accounts/34/trades"],
      ["PATCH", "/accounts/34"],
      ["DELETE", "/accounts/34"],
    ];
    for (const [method, path] of writes) {
      const res = fromMirror(path, method, snap);
      expect(res.status, `${method} ${path}`).toBe(503);
    }
  });
});

describe("demo snapshot", () => {
  it("still refuses writes and still serves reads", async () => {
    const demoSnap = { ...(snap as Record<string, unknown>), demo: true } as never;
    expect(fromMirror("/accounts", "GET", demoSnap).status).toBe(200);
    expect(fromMirror("/accounts/34/order", "POST", demoSnap).status).toBe(503);
  });
});

describe("AI Lab through the hosted site", () => {
  it("waits long enough for an AI answer, but not for other requests", async () => {
    const { pcTimeoutFor, AI_TIMEOUT_MS } = await import("./[[path]]");
    expect(pcTimeoutFor("/ai/analyze")).toBe(AI_TIMEOUT_MS);
    expect(pcTimeoutFor("/accounts")).toBeLessThan(10_000);
  });
  it("says AI is unavailable (503) when only the mirror is answering", () => {
    expect(fromMirror("/ai/providers", "GET", snap).status).toBe(503);
    expect(fromMirror("/ai/analyze", "POST", snap).status).toBe(503);
  });
});
