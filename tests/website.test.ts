import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Kernel } from "../src/kernel/kernel.ts";
import { checkSite, siteTask, websitePlugin } from "../src/plugins/website.ts";
import { handler } from "../src/interfaces/dashboard.ts";

const CUR = { "index.html": "<html><body>Elias OS <a href=\"/privacy\">p</a></body></html>", "privacy.html": "<html>PRIVACY</html>" };

test("guard rails: privacy kept, OAuth footer re-added, bad names/scripts rejected", () => {
  const r = checkSite(JSON.stringify({ files: { "index.html": "<html><body>Elion Group</body></html>", "projects.html": "<html>x</html>" }, summary: "s" }), CUR);
  assert.equal(r.files["privacy.html"], "<html>PRIVACY</html>");
  assert.match(r.files["index.html"]!, /href="\/privacy"[\s\S]*<\/body>|Elias OS[\s\S]*href="\/privacy"/);
  assert.throws(() => checkSite(JSON.stringify({ files: { "../x.html": "<html></html>", "index.html": "<html></html>" }, summary: "" }), CUR), /bad file name/);
  assert.throws(() => checkSite(JSON.stringify({ files: { "index.html": "<html><script src=\"https://x\"></script></html>" }, summary: "" }), CUR), /external scripts/);
  assert.match(siteTask(CUR, "add projects").prompt, /href="\/privacy"/);
});

test("flow: /site → draft → sandboxed preview → publish needs approval", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
  fs.mkdirSync(path.join(home, "site"));
  for (const [n, b] of Object.entries(CUR)) fs.writeFileSync(path.join(home, "site", n), b);
  const out = JSON.stringify({ files: { "index.html": "<html><body>Elias OS new <a href=\"/privacy\">p</a><a href=\"/projects\">x</a></body></html>", "projects.html": "<html>P</html>" }, summary: "- صفحه‌ی پروژه‌ها" });
  const k = new Kernel({ dbPath: ":memory:", providers: [{ name: "fake", health: async () => ({ ok: true, detail: "" }), execute: async () => ({ output: out }) }], defaultProvider: "fake" });
  k.registerProvider({ name: "reminder", health: async () => ({ ok: true, detail: "" }), execute: async (r) => ({ output: r.prompt }) });
  await websitePlugin.setup({ kernel: k, home, options: {} });
  await k.getCommand("site")!.run("یک صفحه‌ی پروژه‌ها اضافه کن");
  while (await k.processNext()) {}
  assert.ok(fs.existsSync(path.join(home, "site-draft", "projects.html")));
  assert.match(k.listTasks({ limit: 10 }).find((t) => t.source === "website")!.result!, /site-preview/);
  // preview served sandboxed with rewritten links
  const srv = http.createServer(handler(k, 7498));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  const res = await new Promise<{ h: http.IncomingHttpHeaders; b: string }>((resolve) =>
    http.get({ port, path: "/site-preview/", headers: { host: "127.0.0.1:7498" } }, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => resolve({ h: r.headers, b })); }));
  srv.close();
  assert.match(String(res.h["content-security-policy"]), /sandbox/);
  assert.match(res.b, /href="\/site-preview\/projects"/);
  // publish → approval required (capability publish:website)
  await k.getCommand("site")!.run("publish");
  await k.processNext();
  assert.equal(k.listApprovals("pending").length, 1);
  assert.equal(fs.readFileSync(path.join(home, "site", "index.html"), "utf8"), CUR["index.html"]); // live site untouched until approved
});
