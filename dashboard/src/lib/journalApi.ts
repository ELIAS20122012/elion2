/** Same-origin: the dev/preview server forwards /api to the journal server (see vite.config.ts). */
export const API_BASE = "/api";

/**
 * Where the answers are coming from. The hosted dashboard is served by a Cloudflare Pages function
 * that forwards /api to the PC at home and, when that PC is off, answers from the published mirror
 * instead (functions/api/[[path]].ts). It labels every reply, so the UI can say which one you are
 * looking at. Running locally there is no such label and this stays null - nothing to warn about.
 */
export type DataSource = { kind: "pc" | "mirror" | "demo"; generatedAt: number | null };

let dataSource: DataSource | null = null;
const sourceListeners = new Set<(s: DataSource | null) => void>();

/** Subscribe to the data source; the callback fires immediately with what is known so far. */
export function onDataSource(fn: (s: DataSource | null) => void): () => void {
  sourceListeners.add(fn);
  fn(dataSource);
  return () => void sourceListeners.delete(fn);
}

function noteSource(res: Response): void {
  const kind = res.headers.get("x-journal-source");
  if (kind !== "pc" && kind !== "mirror" && kind !== "demo") return; // no gateway in front of us (local dev)
  const at = Number(res.headers.get("x-journal-generated-at"));
  const next: DataSource = { kind, generatedAt: Number.isFinite(at) && at > 0 ? at : null };
  if (dataSource?.kind === next.kind && dataSource.generatedAt === next.generatedAt) return;
  dataSource = next;
  for (const fn of sourceListeners) fn(next);
}

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
  /** connect/disconnect: false pauses MT5/MT4 auto-sync for this account and /live reports it as not connected. */
  enabled: boolean;
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
  /** true when the account itself was disconnected (enabled:false) - distinct from "connected:false" meaning no signal yet. */
  disabled?: boolean;
  /** the MetaTrader engine switch (Connection page) is off, so MT5 is deliberately not being contacted */
  engine_off?: boolean;
  last_seen_ago?: number | null;
  balance?: number | null;
  equity?: number | null;
  floating?: number | null;
  open_count?: number | null;
  server?: string | null;
  error?: string | null;
}

export interface OrderInput {
  symbol: string;
  direction: "buy" | "sell";
  order_type?: "market" | "limit" | "stop";
  price?: number | null;
  volume: number;
  sl?: number | null;
  tp?: number | null;
  comment?: string | null;
}

export interface OrderResult {
  ticket: number;
  price: number;
  volume: number;
  retcode: number;
}

export interface LivePosition {
  ticket: string;
  symbol: string;
  direction: "buy" | "sell";
  volume: number;
  open_price: number;
  open_time: string | null;
  sl: number | null;
  tp: number | null;
  price: number | null;
  profit: number;
  swap: number;
  commission: number;
}

export interface LivePending {
  ticket: string;
  symbol: string;
  type: "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop";
  volume: number;
  price: number;
  sl: number | null;
  tp: number | null;
}

export interface LiveQuote {
  symbol: string;
  bid: number;
  ask: number;
  change: number | null;
}

export interface LivePositions {
  live: boolean;
  pending?: LivePending[];
  quotes?: LiveQuote[];
  balance?: number | null;
  equity?: number | null;
  floating?: number;
  age?: number;
  positions: LivePosition[];
}

export type EngineTerminal = { id: number; path: string; name: string; platform: "mt4" | "mt5" };
export interface EngineStatus {
  mt5: { on: boolean; bridge: boolean; terminals: EngineTerminal[] };
  mt4: { on: boolean; terminals: EngineTerminal[] };
}

export interface NewsEvent {
  time: number;
  title: string;
  country: string;
  impact: "High" | "Medium" | "Low" | "Holiday" | string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
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
  } catch (e) {
    // only requests that pass their own AbortSignal (AI Lab) can end up here by timing out
    const name = (e as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new ApiError("The request timed out.", 408);
    throw new ApiError("سرور ژورنال در دسترس نیست", 0);
  }
  noteSource(res); // a refusal is still news about where we are talking to
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
  if (res.status === 204) return undefined as T;
  // A reverse proxy/auth gateway in front of this app (e.g. Cloudflare Access on the tunnel) can return
  // its own HTTP 200 HTML login page instead of forwarding the request - that reads as "success" unless
  // we check the body is actually JSON, and would otherwise surface as a confusing generic "offline".
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new ApiError("نشست ورود قطع شده (احتمالاً Cloudflare Access) — این صفحه را در تب جدید باز و دوباره وارد شوید.", 0);
  }
  return res.json();
}

/* ---- AI Lab (journal/ai.py): read-only analysis by Gemini or Claude. Keys live only on the journal server. ---- */

export type AiProviderId = "gemini" | "claude";

export interface AiProvider {
  id: AiProviderId;
  label: string;
  model: string;
  available: boolean;
  /** why it is unavailable (e.g. which environment variable is missing) */
  reason: string | null;
}

export interface AiShare {
  rules: boolean;
  trades: boolean;
  mt5_account: boolean;
  market: boolean;
}

export interface AiImage {
  mime: "image/png" | "image/jpeg" | "image/webp";
  /** base64 without the data: prefix */
  data: string;
  label: string;
}

export interface AiAnalyzeRequest {
  provider: AiProviderId;
  question: string;
  account_id: number | null;
  share: AiShare;
  rules: { id: string; title: string; hint: string; status: string }[];
  images: AiImage[];
  symbol: string;
  timeframe: string;
}

export interface AiRuleCheck {
  rule: string;
  status: "met" | "not_met" | "unclear" | "not_applicable";
  evidence: string;
}

export interface AiAnalysis {
  summary: string;
  market_bias: "bullish" | "bearish" | "neutral" | "unclear";
  rule_checks: AiRuleCheck[];
  observations: string[];
  risks: string[];
  next_steps: string[];
  data_gaps: string[];
}

export interface AiAnalyzeResponse {
  provider: AiProviderId;
  model: string;
  analysis: AiAnalysis;
  context_used: { rules: number; trades: number; mt5_account: boolean; market_candles: number; images: number };
  /** what was shared but could not be read (e.g. MT5 not connected) */
  notes: string[];
  elapsed_ms: number;
}

/* ---- robot signal queue (journal/signals.py): detector -> AI review -> your decision -> measured outcome. Never trades. ---- */

export interface SignalPoint { i: number; time: number; price: number; macd_i: number | null; macd: number | null }

export interface SignalIn {
  account_id: number | null;
  key: string;
  rule: string;
  rule_def: { id: string; title: string; hint: string; status: string } | null;
  symbol: string;
  tf_sec: number;
  side: "high" | "low";
  a: SignalPoint;
  b: SignalPoint;
  cross_i: number;
  features: Record<string, number>;
  params: Record<string, unknown>;
  /** [time, open, high, low, close] up to and including the formation candle */
  candles: number[][];
  macd: (number | null)[];
  signal: (number | null)[];
  provider?: AiProviderId | null;
}

export interface SignalVerdict {
  verdict: "valid" | "invalid" | "unsure";
  reasons: string[];
  rule_checks: AiRuleCheck[];
  risks: string[];
  data_gaps: string[];
}

export interface SignalOutcome {
  horizon: number;
  definition: string;
  mfe: number;
  mae: number;
  close_move: number;
  atr: number;
  mfe_atr: number | null;
  mae_atr: number | null;
  favorable: boolean;
}

export interface Signal {
  id: number;
  account_id: number | null;
  key: string;
  rule: string;
  symbol: string;
  tf_sec: number;
  side: "high" | "low";
  formed_time: number;
  formed_price: number;
  created_at: number;
  ai_status: "none" | "reviewing" | "done" | "error";
  ai_provider: string | null;
  ai_model: string | null;
  ai_verdict: SignalVerdict["verdict"] | null;
  ai_review: SignalVerdict | null;
  ai_error: string | null;
  decision: "pending" | "approved" | "rejected";
  decided_at: number | null;
  outcome: SignalOutcome | null;
  features: Record<string, number>;
}

export interface SignalGroup { signals: number; measured: number; favorable: number; favorable_rate: number | null; avg_mfe_atr: number | null; avg_mae_atr: number | null }
export interface SignalStats { horizon: number; total: number; by_ai_verdict: Record<string, SignalGroup>; by_decision: Record<string, SignalGroup>; all: SignalGroup | undefined }

/** A little longer than the server's own provider timeout (AI_TIMEOUT_SECONDS, default 60 s). */
export const AI_CLIENT_TIMEOUT_MS = 90_000;

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface RuleLabel {
  key: string;
  label: "ok" | "bad";
  features: Record<string, number> | null;
  updated_at: number;
}

export const journalApi = {
  health: () => call<{ ok: boolean }>("/health"),
  candles: (id: number, tf: number, count: number) =>
    call<{ symbol: string; tf: number; candles: [number, number, number, number, number, number][] }>(`/accounts/${id}/candles?tf=${tf}&count=${count}`),
  engine: () => call<EngineStatus>("/engine"),
  engineStart: (platform: "mt4" | "mt5") => call<EngineStatus>(`/engine/${platform}/start`, { method: "POST" }),
  engineStop: (platform: "mt4" | "mt5", close = true) => call<EngineStatus>(`/engine/${platform}/stop?close=${close}`, { method: "POST" }),
  news: () => call<{ events: NewsEvent[]; fetched_at: number; stale: boolean }>("/news"),
  backup: (daily = false) => call<{ file: string; size: number; skipped: boolean }>(`/backup${daily ? "?daily=true" : ""}`, { method: "POST" }),
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
  /** Sends a REAL market order to this account's MT5 terminal. Not read-only - no size/SL limit, no confirmation step. */
  placeOrder: (id: number, o: OrderInput) => call<OrderResult>(`/accounts/${id}/order`, json("POST", o)),
  positions: (id: number) => call<LivePositions>(`/accounts/${id}/positions`),
  modifyPosition: (id: number, ticket: string, sl: number | null, tp: number | null) =>
    call<{ ticket: string }>(`/accounts/${id}/positions/${ticket}/modify`, json("POST", { sl, tp })),
  cancelOrder: (id: number, ticket: string) => call<{ ticket: string }>(`/accounts/${id}/positions/${ticket}/cancel`, json("POST", {})),
  closePosition: (id: number, ticket: string) => call<{ ticket: string; price: number }>(`/accounts/${id}/positions/${ticket}/close`, json("POST", {})),
  saveNotes: (tradeId: number, n: Notes) => call<{ ok: boolean }>(`/trades/${tradeId}/notes`, json("PUT", n)),
  clearTrades: (id: number) => call<void>(`/accounts/${id}/trades`, { method: "DELETE" }),
  terminals: () => call<{ path: string; name: string }[]>("/mt5/terminals"),
  detected: () => call<Detected[]>("/detected"),
  live: (id: number) => call<LiveInfo>(`/accounts/${id}/live`),
  bridgeInfo: () => call<BridgeInfo>("/bridge/info"),
  aiProviders: () => call<AiProvider[]>("/ai/providers"),
  aiAnalyze: (req: AiAnalyzeRequest, timeoutMs = AI_CLIENT_TIMEOUT_MS) =>
    call<AiAnalyzeResponse>("/ai/analyze", { ...json("POST", req), signal: AbortSignal.timeout(timeoutMs) }),
  signals: (accountId: number | null) => call<Signal[]>(`/signals${accountId != null ? `?account_id=${accountId}` : ""}`),
  signalStats: (accountId: number | null) => call<SignalStats>(`/signals/stats${accountId != null ? `?account_id=${accountId}` : ""}`),
  createSignal: (s: SignalIn) => call<{ signal: Signal; created: boolean }>("/signals", json("POST", s)),
  reviewSignal: (id: number, provider: AiProviderId) => call<Signal>(`/signals/${id}/review`, json("POST", { provider })),
  /** records your decision only - no order is sent */
  decideSignal: (id: number, decision: Signal["decision"]) => call<Signal>(`/signals/${id}/decision`, json("POST", { decision })),
  signalOutcomes: (accountId: number | null, symbol: string, tfSec: number, candles: number[][]) =>
    call<{ measured: number; waiting: number }>("/signals/outcomes", json("POST", { account_id: accountId, symbol, tf_sec: tfSec, candles })),
  signalChartUrl: (id: number) => `${API_BASE}/signals/${id}/chart.png`,
};
