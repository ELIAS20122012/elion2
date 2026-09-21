/** Same-origin: the dev/preview server forwards /api to the journal server (see vite.config.ts). */
export const API_BASE = "/api";

export type Platform = "mt4" | "mt5" | "other";
export type Kind = "manual" | "robot" | "backtest";

export interface Account {
  id: number;
  name: string;
  platform: Platform;
  kind: Kind;
  broker: string | null;
  login: string | null;
  currency: string;
  is_live: boolean;
  initial_balance: number | null;
  note: string | null;
  terminal_path: string | null;
  created_at: number;
  trade_count: number;
  last_trade_time: number | null;
}

export type AccountInput = Partial<Omit<Account, "id" | "created_at" | "trade_count" | "last_trade_time">> & { name: string };

export interface JTrade {
  id: number;
  account_id: number;
  ticket: string;
  symbol: string;
  direction: "buy" | "sell";
  volume: number;
  open_time: number;
  open_price: number;
  close_time: number | null;
  close_price: number | null;
  sl: number | null;
  tp: number | null;
  commission: number;
  swap: number;
  profit: number;
  comment: string | null;
  source: string | null;
  mfe: number | null;
  mae: number | null;
  setup_valid: "yes" | "no" | "unsure" | null;
  setup_id: string | null;
  emotion: string | null;
  error: string | null;
  note: string | null;
}

export type Notes = Pick<JTrade, "setup_valid" | "setup_id" | "emotion" | "error" | "note">;
export type NewTrade = Omit<JTrade, "id" | "account_id" | "setup_valid" | "setup_id" | "emotion" | "error" | "note" | "source" | "mfe" | "mae">;

/** An MT4 account the read-only indicator reports that is not in the journal yet. */
export interface Detected {
  platform: "mt4";
  login: string;
  server: string;
  company: string;
  balance: number | null;
  currency: string;
  open_count: number;
  connected: boolean;
}

export interface LiveInfo {
  source: "mt4-indicator" | "mt5-auto" | null;
  connected: boolean;
  last_seen_ago?: number | null;
  balance?: number | null;
  equity?: number | null;
  floating?: number | null;
  open_count?: number | null;
  server?: string | null;
  error?: string | null;
}

export interface BridgeInfo {
  common_dir: string;
  exists: boolean;
  files: string[];
  indicator_path: string;
  indicator_exists: boolean;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, init);
  } catch {
    throw new ApiError("سرور ژورنال در دسترس نیست", 0);
  }
  if (!res.ok) {
    let detail = `خطا ${res.status}`;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* keep default */
    }
    throw new ApiError(detail, res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface RuleLabel {
  key: string;
  label: "ok" | "bad";
  features: Record<string, number> | null;
  updated_at: number;
}

export const journalApi = {
  health: () => call<{ ok: boolean }>("/health"),
  ruleLabels: (rule: string) => call<RuleLabel[]>(`/rule-labels/${encodeURIComponent(rule)}`),
  setRuleLabel: (rule: string, key: string, label: "ok" | "bad", features: Record<string, number> | null) =>
    call<{ ok: boolean }>("/rule-labels", json("POST", { rule, key, label, features })),
  clearRuleLabel: (rule: string, key: string) => call<void>(`/rule-labels/${encodeURIComponent(rule)}?key=${encodeURIComponent(key)}`, { method: "DELETE" }),
  accounts: () => call<Account[]>("/accounts"),
  createAccount: (a: AccountInput) => call<Account>("/accounts", json("POST", a)),
  updateAccount: (id: number, a: Partial<AccountInput>) => call<Account>(`/accounts/${id}`, json("PATCH", a)),
  deleteAccount: (id: number) => call<void>(`/accounts/${id}`, { method: "DELETE" }),
  trades: (id: number) => call<JTrade[]>(`/accounts/${id}/trades`),
  addTrades: (id: number, trades: NewTrade[], replaceSource?: string) =>
    call<{ inserted: number; updated: number }>(`/accounts/${id}/trades${replaceSource ? `?replace_source=${replaceSource}` : ""}`, json("POST", trades)),
  importFile: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return call<{ parsed: number; inserted: number; updated: number }>(`/accounts/${id}/import`, { method: "POST", body: fd });
  },
  syncMt5: (id: number) => call<{ fetched: number; inserted: number; updated: number }>(`/accounts/${id}/sync-mt5`, { method: "POST" }),
  saveNotes: (tradeId: number, n: Notes) => call<{ ok: boolean }>(`/trades/${tradeId}/notes`, json("PUT", n)),
  clearTrades: (id: number) => call<void>(`/accounts/${id}/trades`, { method: "DELETE" }),
  terminals: () => call<{ path: string; name: string }[]>("/mt5/terminals"),
  detected: () => call<Detected[]>("/detected"),
  live: (id: number) => call<LiveInfo>(`/accounts/${id}/live`),
  bridgeInfo: () => call<BridgeInfo>("/bridge/info"),
};
