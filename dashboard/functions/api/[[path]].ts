/**
 * /api/* for the hosted dashboard.
 *
 * The app only ever talks to its own origin (see src/lib/journalApi.ts). This function decides
 * where that request is actually served from:
 *
 *   PC on  -> forwarded to the journal server at home through the Cloudflare tunnel. Everything
 *             works exactly as it does locally, including writing notes and placing orders.
 *   PC off -> answered from snapshot.json, the read-only mirror the PC publishes. The journal,
 *             analytics and backtest pages keep working; anything that needs a live terminal
 *             says so instead of showing a stale number as if it were live.
 *
 * Responses carry X-Journal-Source: pc | mirror, so the UI can tell the user which one they are
 * looking at.
 */

interface Env {
  /** Origin of the tunnel that reaches the journal server, e.g. https://pc.eliongroup.org */
  PC_ORIGIN?: string;
  /** Cloudflare Access service token, if PC_ORIGIN sits behind Access (it should). */
  ACCESS_CLIENT_ID?: string;
  ACCESS_CLIENT_SECRET?: string;
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
}

/** How long to wait for the PC before deciding it is not there. */
const PC_TIMEOUT_MS = 6000;

/** The journal server's session cookie (backend/journal/auth.py). */
const SESSION_COOKIE = "elion_session";
/** AI Lab analysis waits on Gemini/Claude on the PC (journal/ai.py, up to AI_TIMEOUT_SECONDS), so it gets longer. */
export const AI_TIMEOUT_MS = 95_000;
export const pcTimeoutFor = (rest: string) => (rest.startsWith("/ai/") ? AI_TIMEOUT_MS : PC_TIMEOUT_MS);

const json = (body: unknown, status = 200, source = "mirror") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-journal-source": source,
    },
  });

const offline = (what: string) =>
  json({ detail: `${what} فقط وقتی کامپیوتر خانه روشن است در دسترس است. این صفحه از آخرین نسخه‌ی ذخیره‌شده خوانده می‌شود.` }, 503);

interface Snapshot {
  version: number;
  generated_at: number;
  /** Set by journal/demo.py: invented data for the public demo, not a mirror of anyone's journal. */
  demo?: boolean;
  accounts: Array<Record<string, unknown> & { id: number }>;
  trades: Record<string, Array<Record<string, unknown>>>;
  snapshots: Record<string, Array<Record<string, unknown>>>;
  rule_labels: Record<string, Array<Record<string, unknown>>>;
}

async function tryPc(request: Request, rest: string, env: Env): Promise<Response | null> {
  if (!env.PC_ORIGIN) return null;
  const target = new URL(env.PC_ORIGIN);
  const here = new URL(request.url);
  target.pathname = rest || "/";
  target.search = here.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  // Forward our own session cookie and nothing else: the Cloudflare Access cookie belongs to this
  // origin, not to the tunnel's, and sending it along only confuses the journal server.
  const ours = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c.startsWith(`${SESSION_COOKIE}=`))
    .join("; ");
  if (ours) headers.set("cookie", ours);
  else headers.delete("cookie");
  if (env.ACCESS_CLIENT_ID && env.ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", env.ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.ACCESS_CLIENT_SECRET);
  }

  try {
    const res = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().arrayBuffer(),
      signal: AbortSignal.timeout(pcTimeoutFor(rest)),
    });
    // An Access login page comes back as a perfectly healthy HTML 200; that is not the journal server.
    const ct = res.headers.get("content-type") ?? "";
    if (res.status !== 204 && !ct.includes("application/json")) return null;
    const out = new Response(res.body, res);
    out.headers.set("x-journal-source", "pc");
    out.headers.set("cache-control", "no-store");
    return out;
  } catch {
    return null; // unreachable, refused, or slower than PC_TIMEOUT_MS
  }
}

async function loadSnapshot(request: Request, env: Env): Promise<Snapshot | null> {
  try {
    const res = await env.ASSETS.fetch(new URL("/snapshot.json", request.url).toString());
    return res.ok ? await res.json<Snapshot>() : null;
  } catch {
    return null;
  }
}

/** Answer the read-only routes the mirror genuinely holds data for; refuse the rest honestly. */
export function fromMirror(rest: string, method: string, snap: Snapshot): Response {
  if (method !== "GET" && method !== "HEAD")
    return json({ detail: "برای ثبت و ویرایش باید کامپیوتر خانه روشن باشد — الان فقط حالت نمایش در دسترس است." }, 503);

  const age = Math.max(0, Math.floor(Date.now() / 1000) - snap.generated_at);

  if (rest === "/" || rest === "/health") return json({ ok: true, mirror: true, generated_at: snap.generated_at, age });
  if (rest === "/accounts") return json(snap.accounts);
  if (rest === "/detected") return json([]);
  if (rest === "/engine")
    return json({ mt5: { on: false, bridge: false, terminals: [] }, mt4: { on: false, terminals: [] } });

  let m = rest.match(/^\/accounts\/(\d+)\/(trades|snapshots|live)$/);
  if (m) {
    const [, id, what] = m;
    if (!snap.accounts.some((a) => String(a.id) === id)) return json({ detail: "حساب پیدا نشد" }, 404);
    if (what === "trades") return json(snap.trades[id] ?? []);
    if (what === "snapshots") return json(snap.snapshots[id] ?? []);
    // live: honestly disconnected, but the open-trade totals are still worth showing.
    const open = (snap.trades[id] ?? []).filter((t) => t.close_time == null);
    const floating = open.reduce((s, t) => s + Number(t.profit ?? 0), 0);
    return json({
      source: "mirror",
      connected: false,
      offline: true,
      generated_at: snap.generated_at,
      floating: Math.round(floating * 100) / 100,
      open_count: open.length,
    });
  }

  m = rest.match(/^\/rule-labels\/([^/]+)$/);
  if (m) return json(snap.rule_labels[decodeURIComponent(m[1])] ?? []);

  if (rest.startsWith("/accounts/") && rest.endsWith("/candles")) return offline("تاریخچه‌ی کندل از ترمینال");
  if (rest === "/news") return offline("تقویم اقتصادی");
  if (rest === "/bridge/info" || rest === "/mt5/terminals") return offline("اطلاعات ترمینال");
  if (rest.startsWith("/ai/")) return offline("تحلیل هوش مصنوعی (AI Lab)");
  return offline("این بخش");
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api/, "") || "/";

  const live = await tryPc(request, rest, env);
  if (live) return live;

  const snap = await loadSnapshot(request, env);
  if (!snap)
    return json({ detail: "سرور ژورنال در دسترس نیست و نسخه‌ی ذخیره‌شده‌ای هم منتشر نشده است." }, 503);
  const res = fromMirror(rest, request.method, snap);
  res.headers.set("x-journal-generated-at", String(snap.generated_at)); // lets the UI date what it shows
  if (snap.demo) res.headers.set("x-journal-source", "demo"); // "sample data", not "your PC is off"
  return res;
};
