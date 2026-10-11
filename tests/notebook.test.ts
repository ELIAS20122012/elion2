import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { notebookPlugin, notebookIntent, findUrls, parse, serialize, Notebook, NB_PREFIX } from "../src/plugins/notebook.ts";
import { reminderProvider } from "../src/plugins/reminders.ts";
import { isSafeAction } from "../src/interfaces/actions.ts";

const POST = `اگه با هوش مصنوعی سایت طراحی می‌کنی، این ۲۸ سایت رو باید بشناسی!🔥

🎨 ایده و الهام برای طراحی سایت
godly.website — نمونه سایت‌های خلاقانه
awwwards.com — طراحی‌های برنده جوایز

🧩 کامپوننت
ui.shadcn.com — کامپوننت‌های Shadcn
https://21st.dev — کامپوننت‌های آماده`;

test("notebook: detect URLs and bare domains", () => {
  const u = findUrls(POST);
  assert.deepEqual(u.sort(), ["https://21st.dev", "https://awwwards.com", "https://godly.website", "https://ui.shadcn.com"]);
});

test("notebook: serialize/parse round trip keeps body verbatim and links by group", () => {
  const n = { id: "nabc", type: "links" as const, title: "سایت‌های طراحی", topic: "طراحی سایت", tags: ["ui", "ai"], created: "2026-10-11T12:40", source: "telegram", summary: "x", status: "ok", body: POST, links: [{ url: "https://godly.website", name: "Godly", desc: "الهام", group: "الهام طراحی" }] };
  const p = parse(serialize(n), "links/a.md")!;
  assert.equal(p.body, POST);
  assert.deepEqual(p.links, n.links);
  assert.deepEqual(p.tags, ["ui", "ai"]);
  assert.equal(p.topic, "طراحی سایت");
});

test("notebook: telegram intent — forwarded saves, #خام raw, plain chat is not captured", () => {
  assert.deepEqual(notebookIntent("hello", true), { mode: "save", text: "hello" });
  assert.deepEqual(notebookIntent("#خام متن من", false), { mode: "raw", text: "متن من" });
  assert.deepEqual(notebookIntent("#یادداشت ایده: ویدیو", false), { mode: "save", text: "ایده: ویدیو" });
  assert.equal(notebookIntent("سلام چطوری", false), null);
  assert.ok(isSafeAction("/nb links طراحی سایت"));
  assert.ok(isSafeAction("/nb read n1"));
  assert.ok(!isSafeAction("/nb del n1"));
  assert.ok(!isSafeAction("/nb edit n1 کوتاه کن"));
});

test("notebook: save → AI classifies → links grouped, de-duplicated, searchable, editable, trash", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-"));
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider(), reminderProvider], defaultProvider: "echo", retryBaseMs: 0 });
  await notebookPlugin.setup({ kernel: k, home: "", options: { dir } });
  const nb = k.getCommand("nb")!;
  assert.match(await nb.run(`save ${POST}`), /ذخیره شد \(4 لینک\)/);
  const task = k.listTasks({ limit: 5 }).find((t) => t.title.startsWith(NB_PREFIX))!;
  const id = task.title.slice(NB_PREFIX.length);
  // simulate the AI answer
  k.db.prepare("UPDATE tasks SET status='succeeded', result=? WHERE id=?").run(
    JSON.stringify({ type: "links", title: "منابع طراحی سایت با AI", topic: "طراحی سایت", tags: ["ui"], summary: "۲۸ منبع",
      links: [
        { url: "https://godly.website", name: "Godly", desc: "نمونه سایت‌های خلاقانه", group: "الهام طراحی" },
        { url: "https://ui.shadcn.com", name: "shadcn/ui", desc: "کامپوننت", group: "کامپوننت UI" },
        { url: "javascript:alert(1)", name: "bad", desc: "", group: "x" },
      ] }),
    task.id,
  );
  for (const sink of ((k as unknown as { sinks: Array<(e: unknown) => void> }).sinks)) sink({ type: "task.succeeded", taskId: task.id, message: "" });
  const book = new Notebook(dir);
  const n = book.get(id)!;
  assert.equal(n.type, "links");
  assert.equal(n.topic, "طراحی سایت");
  assert.equal(n.links.length, 2, "only http(s) links are kept");
  assert.ok(n.rel.startsWith("links"));
  assert.equal(n.body, POST, "original text kept verbatim");

  const links = await nb.run("links طراحی سایت");
  assert.match(links, /الهام طراحی/);
  assert.match(links, /godly\.website/);
  assert.match(await nb.run("shadcn"), /منابع طراحی سایت/);
  assert.match(await nb.run(`read ${id}`), /نمونه سایت‌های خلاقانه/);
  assert.match(await nb.run(""), /طراحی سایت \(1\)/);
  assert.match(await nb.run(`set ${id} topic=وب`), /topic = وب/);
  assert.equal(new Notebook(dir).get(id)!.topic, "وب");
  assert.match(await nb.run(`raw یک متن خام`), /خام ذخیره شد/);
  assert.match(await nb.run(`del ${id}`), /سطل/);
  assert.equal(new Notebook(dir).get(id), null);
  assert.ok(fs.readdirSync(path.join(dir, ".trash")).length === 1);
});
