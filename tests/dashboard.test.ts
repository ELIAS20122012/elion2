import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { handler } from "../src/interfaces/dashboard.ts";

test("dashboard: page + overview, writes need X-Elias, bad Host rejected", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo", retryBaseMs: 0 });
  k.registerSkill({ name: "sum", description: "s", plugin: "t", build: (i) => ({ title: "sum", prompt: i }) });
  const srv = http.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  srv.on("request", handler(k, port));
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.match(await (await fetch(base + "/")).text(), /Elias OS/);
    const ov = await (await fetch(base + "/api/overview")).json();
    assert.equal(ov.skills[0].name, "sum");
    assert.equal((await fetch(base + "/api/tasks", { method: "POST", body: JSON.stringify({ prompt: "x" }) })).status, 403);
    const ok = await fetch(base + "/api/skills/sum/run", { method: "POST", headers: { "x-elias": "1" }, body: JSON.stringify({ input: "hi" }) });
    assert.equal(ok.status, 200);
    assert.equal(k.listTasks({ limit: 1 })[0]!.source, "dashboard");
    const bad = await new Promise<number>((r) => http.get({ host: "127.0.0.1", port, path: "/api/overview", headers: { host: "evil.com" } }, (res) => r(res.statusCode!)));
    assert.equal(bad, 403);
  } finally {
    srv.close();
  }
});

test("dashboard: remote host only with owner's Cloudflare Access identity", async () => {
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()], defaultProvider: "echo" });
  const srv = http.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  srv.on("request", handler(k, port, { publicHost: "panel.example.org", ownerEmail: "me@x.com" }));
  const get = (headers: Record<string, string>) =>
    new Promise<number>((r) => http.get({ host: "127.0.0.1", port, path: "/api/overview", headers: { host: "panel.example.org", ...headers } }, (res) => (res.resume(), r(res.statusCode!))));
  try {
    assert.equal(await get({}), 403);
    assert.equal(await get({ "cf-access-jwt-assertion": "x", "cf-access-authenticated-user-email": "evil@x.com" }), 403);
    assert.equal(await get({ "cf-access-jwt-assertion": "x", "cf-access-authenticated-user-email": "ME@x.com" }), 200);
  } finally {
    srv.close();
  }
});
