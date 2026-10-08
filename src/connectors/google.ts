// Google connector (read-only): OAuth 2.0 for installed apps (loopback + PKCE), Gmail and Calendar.
// No SDK dependency — plain fetch. Credentials live in config/ (git-ignored):
//   config/google-client.json  ← the "Desktop app" OAuth client downloaded from Google Cloud
//   config/google-token.json   ← refresh token written by `elias google auth`
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { ContextUnavailableError, type ContextSource } from "../kernel/types.ts";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/cloud-platform", // Vertex AI (Veo / image generation on the project's billing)
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

interface StoredToken {
  refresh_token: string;
  scope?: string;
  created_at: string;
}

type Fetch = typeof fetch;

export class GoogleAuth {
  readonly clientPath: string;
  readonly tokenPath: string;
  private fetchImpl: Fetch;
  private access: { token: string; expires: number } | null = null;

  constructor(configDir: string, fetchImpl: Fetch = fetch) {
    this.clientPath = path.join(configDir, "google-client.json");
    this.tokenPath = path.join(configDir, "google-token.json");
    this.fetchImpl = fetchImpl;
  }

  loadClient(): GoogleClient {
    if (!fs.existsSync(this.clientPath)) {
      throw new ContextUnavailableError(`Google is not set up: ${this.clientPath} is missing (see docs/GOOGLE-SETUP.md)`);
    }
    const raw = JSON.parse(fs.readFileSync(this.clientPath, "utf8").replace(/^﻿/, "")) as Record<string, any>;
    if (raw.web && !raw.installed) {
      throw new ContextUnavailableError(
        "google-client.json is a 'Web application' client — Elias OS needs a 'Desktop app' OAuth client (see docs/GOOGLE-SETUP.md)",
      );
    }
    const c = raw.installed ?? raw;
    if (!c.client_id || !c.client_secret) throw new ContextUnavailableError("google-client.json has no client_id/client_secret");
    return { clientId: c.client_id, clientSecret: c.client_secret };
  }

  isAuthorized(): boolean {
    return fs.existsSync(this.tokenPath);
  }

  /** Google Cloud project id of the OAuth client (google-client.json → project_id). */
  projectId(): string | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.clientPath, "utf8").replace(/^\uFEFF/, "")) as Record<string, any>;
      return (raw.installed ?? raw).project_id ?? null;
    } catch {
      return null;
    }
  }

  /** True when the stored grant includes `scope` (older grants may lack newly added scopes). */
  hasScope(scope: string): boolean {
    if (!this.isAuthorized()) return false;
    const stored = JSON.parse(fs.readFileSync(this.tokenPath, "utf8")) as StoredToken;
    return (stored.scope ?? "").split(/\s+/).includes(scope);
  }

  /** Interactive one-time consent: opens the browser, receives the code on a loopback port, stores the refresh token. */
  async authorize(o: { openBrowser?: boolean; timeoutMs?: number; log?: (s: string) => void } = {}): Promise<void> {
    const log = o.log ?? console.log;
    const client = this.loadClient();
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(16));

    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/") {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get("error");
        const got = url.searchParams.get("code");
        const ok = !err && got && url.searchParams.get("state") === state;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          ok
            ? "<h2 style='font-family:sans-serif'>✅ Elias OS به Google وصل شد. این صفحه را ببند.</h2>"
            : `<h2 style='font-family:sans-serif'>❌ اتصال انجام نشد: ${escapeHtml(err ?? "state mismatch")}</h2>`,
        );
        clearTimeout(timer);
        server.close();
        if (ok) resolve({ code: got!, redirectUri });
        else reject(new Error(`Google authorization failed: ${err ?? "state mismatch"}`));
      });
      let redirectUri = "";
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Timed out waiting for Google consent (5 min)"));
      }, o.timeoutMs ?? 5 * 60_000);
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        redirectUri = `http://127.0.0.1:${port}`;
        const authUrl =
          `${AUTH_URL}?` +
          new URLSearchParams({
            client_id: client.clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: GOOGLE_SCOPES.join(" "),
            access_type: "offline",
            prompt: "consent",
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
          }).toString();
        log("\nOpening Google sign-in in your browser. If it does not open, paste this link into Chrome:\n");
        log(authUrl + "\n");
        if (o.openBrowser !== false) openUrl(authUrl);
      });
    });

    const tok = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: verifier,
    });
    if (!tok.refresh_token) throw new Error("Google did not return a refresh token — remove the app at myaccount.google.com/permissions and run again");
    const stored: StoredToken = { refresh_token: tok.refresh_token, scope: tok.scope, created_at: new Date().toISOString() };
    fs.writeFileSync(this.tokenPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
  }

  async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.access && Date.now() < this.access.expires) return this.access.token;
    const client = this.loadClient();
    if (!fs.existsSync(this.tokenPath)) {
      throw new ContextUnavailableError("Google is not authorized yet — run setup/google-setup.cmd");
    }
    const stored = JSON.parse(fs.readFileSync(this.tokenPath, "utf8")) as StoredToken;
    let tok;
    try {
      tok = await this.tokenRequest(
        { grant_type: "refresh_token", refresh_token: stored.refresh_token, client_id: client.clientId, client_secret: client.clientSecret },
        signal,
      );
    } catch (e) {
      if (/invalid_grant/.test(String(e))) {
        throw new ContextUnavailableError("Google authorization expired or was revoked — run setup/google-setup.cmd again");
      }
      throw e;
    }
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
    return this.access.token;
  }

  private async tokenRequest(body: Record<string, string>, signal?: AbortSignal): Promise<any> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    const j = (await res.json()) as Record<string, any>;
    if (!res.ok) throw new Error(`Google token error: ${j.error ?? res.status} ${j.error_description ?? ""}`.trim());
    return j;
  }

  /** Authenticated GET against a Google REST API. */
  async get(url: string, signal?: AbortSignal): Promise<any> {
    const token = await this.accessToken(signal);
    const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: signal ?? AbortSignal.timeout(30_000) });
    const j = (await res.json()) as Record<string, any>;
    if (!res.ok) {
      const msg = j.error?.message ?? res.status;
      if (res.status === 403 && /has not been used|is disabled/i.test(String(msg))) {
        throw new ContextUnavailableError(`Google API not enabled: ${msg}`);
      }
      throw new Error(`Google API ${res.status}: ${msg}`);
    }
    return j;
  }
}

// ───────────── Gmail ─────────────

export interface MailItem {
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  important: boolean;
}

export async function recentMail(g: GoogleAuth, o: { query?: string; max?: number; signal?: AbortSignal } = {}): Promise<MailItem[]> {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const q = o.query ?? "newer_than:1d in:inbox -category:promotions -category:social";
  const list = await g.get(`${base}?${new URLSearchParams({ q, maxResults: String(o.max ?? 25) })}`, o.signal);
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
  const out: MailItem[] = [];
  for (const id of ids) {
    const m = await g.get(
      `${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      o.signal,
    );
    const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    const labels: string[] = m.labelIds ?? [];
    out.push({
      from: h("From"),
      subject: h("Subject") || "(no subject)",
      date: h("Date"),
      snippet: redactSecrets(decodeEntities(m.snippet ?? "")).slice(0, 220),
      unread: labels.includes("UNREAD"),
      important: labels.includes("IMPORTANT"),
    });
  }
  return out;
}

export function formatMail(items: MailItem[]): string {
  if (!items.length) return "No emails in the last 24 hours.";
  const unread = items.filter((i) => i.unread).length;
  return (
    `${items.length} emails in the last 24h (${unread} unread):\n` +
    items
      .map((i) => `- ${i.unread ? "[UNREAD] " : ""}${i.important ? "[IMPORTANT] " : ""}From: ${i.from} | Subject: ${i.subject} | ${i.date}\n  ${i.snippet}`)
      .join("\n")
  );
}

// ───────────── Calendar ─────────────

export interface CalEvent {
  start: string;
  end: string;
  allDay: boolean;
  title: string;
  location: string;
}

export async function upcomingEvents(g: GoogleAuth, o: { days?: number; now?: Date; signal?: AbortSignal } = {}): Promise<CalEvent[]> {
  const now = o.now ?? new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + (o.days ?? 2));
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const j = await g.get(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, o.signal);
  return (j.items ?? [])
    .filter((e: any) => e.status !== "cancelled")
    .map((e: any) => ({
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      allDay: !e.start?.dateTime,
      title: e.summary ?? "(no title)",
      location: e.location ?? "",
    }));
}

export function formatEvents(items: CalEvent[]): string {
  if (!items.length) return "No calendar events today or tomorrow.";
  const day = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const time = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return items
    .map((e) =>
      e.allDay
        ? `- ${e.start} (all day) ${e.title}${e.location ? ` @ ${e.location}` : ""}`
        : `- ${day(e.start)} ${time(e.start)}–${time(e.end)} ${e.title}${e.location ? ` @ ${e.location}` : ""}`,
    )
    .join("\n");
}

// ───────────── context sources ─────────────

export function googleContextSources(g: GoogleAuth): ContextSource[] {
  return [
    {
      name: "gmail:recent",
      capability: "read:email",
      description: "Inbox emails from the last 24 hours (metadata + snippet, read-only)",
      fetch: async (signal) => formatMail(await recentMail(g, { signal })),
    },
    {
      name: "calendar:upcoming",
      capability: "read:calendar",
      description: "Primary calendar events today and tomorrow (read-only)",
      fetch: async (signal) => formatEvents(await upcomingEvents(g, { signal })),
    },
  ];
}

// ───────────── helpers ─────────────

const SECRET_HINT = /(code|otp|pin|passcode|verif|bestätigung|sicherheitscode|einmal|password|passwort|کد|رمز|تأیید|تایید)/i;

/** Verification codes and one-time links never leave the mailbox: they are masked before any AI or Telegram sees them. */
export function redactSecrets(text: string): string {
  let t = text.replace(/https?:\/\/\S*(token|code|verify|reset|login|auth)\S*/gi, "[link hidden]");
  if (SECRET_HINT.test(t)) t = t.replace(/(?<![\d/-]|\d[.,:])[0-9۰-۹]{4,8}(?![\d/-]|[.,:]\d)/g, "[code hidden]");
  return t;
}

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function decodeEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Opens a URL in the default browser without any shell parsing of `&` characters. */
function openUrl(url: string): void {
  try {
    if (process.platform === "win32") spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* the link is printed anyway */
  }
}
