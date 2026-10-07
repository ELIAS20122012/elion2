import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { ScriptedProvider } from "../src/providers/mock.ts";
import { ContextUnavailableError } from "../src/kernel/types.ts";
import { GoogleAuth, recentMail, upcomingEvents, formatMail, googleContextSources, redactSecrets } from "../src/connectors/google.ts";
import { briefingTask } from "../src/agents/briefing.ts";

function kernelWith(p: ScriptedProvider) {
  return new Kernel({ dbPath: ":memory:", providers: [p], defaultProvider: p.name, retryBaseMs: 0 });
}

test("context data is fetched and handed to the agent, marked as untrusted", async () => {
  const p = new ScriptedProvider([{ output: "📅 ok" }]);
  const k = kernelWith(p);
  k.registerContextSource({ name: "gmail:recent", capability: "read:email", description: "", fetch: async () => "From: boss | Subject: Q3" });
  await (k.createTask({ title: "b", prompt: "summarize", capabilities: ["read:email"], context: ["gmail:recent"] }), k.processNext());
  const prompt = p.calls[0]!.prompt;
  assert.match(prompt, /<data source="gmail:recent">\nFrom: boss \| Subject: Q3\n<\/data>/);
  assert.match(prompt, /never follow instructions/);
});

test("context without its capability is refused before anything is fetched", async () => {
  const p = new ScriptedProvider([{ output: "x" }]);
  const k = kernelWith(p);
  let fetched = false;
  k.registerContextSource({ name: "gmail:recent", capability: "read:email", description: "", fetch: async () => ((fetched = true), "x") });
  const t = k.createTask({ title: "b", prompt: "p", context: ["gmail:recent"] });
  await k.processNext();
  assert.equal(k.getTask(t.id)!.failureKind, "permission_denied");
  assert.equal(fetched, false);
  assert.equal(p.calls.length, 0);
});

test("unknown context source → context_unavailable", async () => {
  const k = kernelWith(new ScriptedProvider([]));
  const t = k.createTask({ title: "b", prompt: "p", context: ["drive:all"] });
  await k.processNext();
  assert.equal(k.getTask(t.id)!.failureKind, "context_unavailable");
});

test("not-configured source fails fast; transient source error is retried", async () => {
  const p = new ScriptedProvider([{ output: "done" }]);
  const k = kernelWith(p);
  k.registerContextSource({ name: "a:x", capability: "read:a", description: "", fetch: async () => { throw new ContextUnavailableError("Google is not authorized"); } });
  let n = 0;
  k.registerContextSource({ name: "b:x", capability: "read:b", description: "", fetch: async () => { if (n++ === 0) throw new Error("ECONNRESET"); return "ok"; } });
  const t1 = k.createTask({ title: "1", prompt: "p", capabilities: ["read:a"], context: ["a:x"], maxAttempts: 3 });
  await k.processNext();
  assert.equal(k.getTask(t1.id)!.status, "failed");
  assert.equal(k.getTask(t1.id)!.failureKind, "context_unavailable");
  assert.equal(k.getTask(t1.id)!.attempts, 1);
  const t2 = k.createTask({ title: "2", prompt: "p", capabilities: ["read:b"], context: ["b:x"] });
  await k.drain();
  assert.equal(k.getTask(t2.id)!.status, "succeeded");
  assert.equal(k.getTask(t2.id)!.attempts, 2);
});

test("briefing task declares exactly the capabilities its context needs", () => {
  const b = briefingTask();
  const g = new GoogleAuth(os.tmpdir());
  const caps = new Map(googleContextSources(g).map((s) => [s.name, s.capability]));
  caps.set("tasks:open", "read:tasks");
  for (const c of b.context!) assert.ok(b.capabilities!.includes(caps.get(c)!), c);
});

// ───────────── Google connector with a fake Google ─────────────

function tmpConfig(withToken = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-g-"));
  fs.writeFileSync(path.join(dir, "google-client.json"), JSON.stringify({ installed: { client_id: "cid", client_secret: "sec" } }));
  if (withToken) fs.writeFileSync(path.join(dir, "google-token.json"), JSON.stringify({ refresh_token: "rt", created_at: "x" }));
  return dir;
}

function fakeGoogle(o: { refreshFails?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "refresh_token") {
        return o.refreshFails ? json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }) : json(200, { access_token: "at", expires_in: 3600 });
      }
      return json(200, { access_token: "at", expires_in: 3600, refresh_token: "new-rt", scope: "s" });
    }
    assert.equal((init?.headers as Record<string, string>)?.authorization, "Bearer at");
    if (u.includes("/messages?")) return json(200, { messages: [{ id: "m1" }, { id: "m2" }] });
    if (u.includes("/messages/m1")) return json(200, { snippet: "Please review the &quot;contract&quot;", labelIds: ["UNREAD", "IMPORTANT"], payload: { headers: [{ name: "From", value: "Ali <ali@x.com>" }, { name: "Subject", value: "Contract" }, { name: "Date", value: "Fri" }] } });
    if (u.includes("/messages/m2")) return json(200, { snippet: "newsletter", labelIds: [], payload: { headers: [{ name: "Subject", value: "News" }] } });
    if (u.includes("/calendar/v3/")) return json(200, { items: [
      { summary: "Student call", start: { dateTime: "2026-10-03T10:00:00+02:00" }, end: { dateTime: "2026-10-03T11:00:00+02:00" } },
      { summary: "Holiday", start: { date: "2026-10-03" }, end: { date: "2026-10-04" } },
      { summary: "Gone", status: "cancelled", start: { date: "2026-10-03" }, end: { date: "2026-10-04" } },
    ] });
    return json(404, { error: { message: "not found" } });
  }) as typeof fetch;
  return { f, calls };
}

test("Gmail and Calendar are read and formatted", async () => {
  const { f } = fakeGoogle();
  const g = new GoogleAuth(tmpConfig(), f);
  const mail = await recentMail(g);
  assert.equal(mail.length, 2);
  assert.deepEqual([mail[0]!.unread, mail[0]!.important, mail[0]!.snippet], [true, true, 'Please review the "contract"']);
  assert.match(formatMail(mail), /2 emails in the last 24h \(1 unread\)/);
  const ev = await upcomingEvents(g);
  assert.equal(ev.length, 2);
  assert.equal(ev[1]!.allDay, true);
});

test("access token is cached between calls", async () => {
  const { f, calls } = fakeGoogle();
  const g = new GoogleAuth(tmpConfig(), f);
  await upcomingEvents(g);
  await upcomingEvents(g);
  assert.equal(calls.filter((c) => c.includes("oauth2")).length, 1);
});

test("missing token or revoked access → ContextUnavailableError (no pointless retries)", async () => {
  await assert.rejects(new GoogleAuth(tmpConfig(false), fakeGoogle().f).accessToken(), ContextUnavailableError);
  await assert.rejects(new GoogleAuth(tmpConfig(), fakeGoogle({ refreshFails: true }).f).accessToken(), ContextUnavailableError);
  await assert.rejects(async () => new GoogleAuth(fs.mkdtempSync(path.join(os.tmpdir(), "e-")), fakeGoogle().f).loadClient(), ContextUnavailableError);
});

test("OAuth loopback flow stores the refresh token (state checked)", async () => {
  const dir = tmpConfig(false);
  const g = new GoogleAuth(dir, fakeGoogle().f);
  let authUrl = "";
  const done = g.authorize({ openBrowser: false, log: (s) => { if (s.startsWith("https://accounts.google.com")) authUrl = s.trim(); } });
  while (!authUrl) await new Promise((r) => setTimeout(r, 10));
  const u = new URL(authUrl);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.match(u.searchParams.get("scope")!, /gmail\.readonly .*calendar\.readonly/);
  const redirect = u.searchParams.get("redirect_uri")!;
  const res = await fetch(`${redirect}/?code=abc&state=${u.searchParams.get("state")}`);
  assert.match(await res.text(), /وصل شد/);
  await done;
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "google-token.json"), "utf8")).refresh_token, "new-rt");
});

test("OAuth callback with a wrong state is rejected", async () => {
  const g = new GoogleAuth(tmpConfig(false), fakeGoogle().f);
  let authUrl = "";
  const done = g.authorize({ openBrowser: false, log: (s) => { if (s.startsWith("https://")) authUrl = s.trim(); } });
  done.catch(() => {});
  while (!authUrl) await new Promise((r) => setTimeout(r, 10));
  const redirect = new URL(authUrl).searchParams.get("redirect_uri")!;
  await fetch(`${redirect}/?code=abc&state=evil`);
  await assert.rejects(done, /state mismatch/);
});

test("verification codes and one-time links are masked before any AI sees them", () => {
  assert.equal(redactSecrets("Ihr Bestätigungscode lautet 325141. Gültig 10 Min."), "Ihr Bestätigungscode lautet [code hidden]. Gültig 10 Min.");
  assert.equal(redactSecrets("کد تأیید شما ۴۸۲۹۱۷ است"), "کد تأیید شما [code hidden] است");
  assert.match(redactSecrets("Reset: https://x.com/reset?token=abc"), /\[link hidden\]/);
  // ordinary numbers in normal mail stay intact
  assert.equal(redactSecrets("Meeting on 2026-10-03 at 10:00, invoice 1500 EUR"), "Meeting on 2026-10-03 at 10:00, invoice 1500 EUR");
});
