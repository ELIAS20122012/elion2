import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel/kernel.ts";
import { EchoProvider } from "../src/providers/mock.ts";
import { pcPlugin, planTidy, categoryOf, cleanFolder } from "../src/plugins/pc.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
const old = (p: string) => { const t = new Date(Date.now() - 3 * 86_400_000); fs.utimesSync(p, t, t); };

test("categories", () => {
  assert.equal(categoryOf("a.PNG"), "Images");
  assert.equal(categoryOf("setup.exe"), "Installers");
  assert.equal(categoryOf("x.unknown"), "Other");
});

test("tidy: preview, apply, undo; skips shortcuts, new and partial files", async () => {
  const dl = tmp();
  for (const f of ["a.jpg", "b.pdf", "c.zip", "app.lnk", "half.crdownload", "new.png"]) fs.writeFileSync(path.join(dl, f), "x");
  for (const f of ["a.jpg", "b.pdf", "c.zip", "app.lnk", "half.crdownload"]) old(path.join(dl, f));
  fs.mkdirSync(path.join(dl, "Images")); fs.writeFileSync(path.join(dl, "Images", "a.jpg"), "existing");
  assert.equal(planTidy([dl]).length, 3);
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()] } as any);
  pcPlugin({ temp: [], crash: [], tidy: [dl] }).setup({ kernel: k, home: "", options: {} });
  const cmd = k.getCommand("pc")!;
  assert.match(await cmd.run("tidy"), /تأیید/);
  assert.ok(fs.existsSync(path.join(dl, "a.jpg")));
  assert.match(await cmd.run("tidy yes"), /3 فایل/);
  assert.ok(fs.existsSync(path.join(dl, "Images", "a (2).jpg")));
  assert.ok(fs.existsSync(path.join(dl, "Documents", "b.pdf")));
  assert.ok(fs.existsSync(path.join(dl, "app.lnk")) && fs.existsSync(path.join(dl, "new.png")));
  assert.match(await cmd.run("undo"), /3 فایل/);
  assert.ok(fs.existsSync(path.join(dl, "a.jpg")) && fs.existsSync(path.join(dl, "b.pdf")));
  assert.ok(k.getSchedule("pc-weekly"));
});

test("clean: only old items, needs yes", async () => {
  const t = tmp();
  fs.writeFileSync(path.join(t, "old.tmp"), "12345"); old(path.join(t, "old.tmp"));
  fs.writeFileSync(path.join(t, "fresh.tmp"), "1");
  const k = new Kernel({ dbPath: ":memory:", providers: [new EchoProvider()] } as any);
  pcPlugin({ temp: [t], crash: [], tidy: [] }).setup({ kernel: k, home: "", options: {} });
  assert.match(await k.getCommand("pc")!.run("clean"), /تأیید/);
  assert.ok(fs.existsSync(path.join(t, "old.tmp")));
  await k.getCommand("pc")!.run("clean yes");
  assert.ok(!fs.existsSync(path.join(t, "old.tmp")) && fs.existsSync(path.join(t, "fresh.tmp")));
  assert.equal(cleanFolder(path.join(t, "nope")).files, 0);
});
