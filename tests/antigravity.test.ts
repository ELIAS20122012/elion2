import test from "node:test";
import assert from "node:assert/strict";
import { agyArgs, agyProvider, CliProvider } from "../src/providers/cli.ts";
import { LimitError, ProviderUnavailableError } from "../src/providers/types.ts";

const req = (prompt: string) => ({ taskId: "t", runId: "r", attempt: 1, prompt, signal: new AbortController().signal });

test("agy args: flags before -p, prompt is the value of -p", () => {
  assert.deepEqual(agyArgs()("", "hello"), ["-p", "hello"]);
  assert.deepEqual(agyArgs({ model: "gemini-3-flash" })("", "hello"), ["--model", "gemini-3-flash", "-p", "hello"]);
});

test("agyProvider is named antigravity and runs agy", () => {
  const p = agyProvider();
  assert.equal(p.name, "antigravity");
  assert.equal(agyProvider({ name: "x" }).name, "x");
});

// A fake CLI: node -e <script> -- <args…>. Echoes the -p value and the stdin it received.
const fake = (script: string) =>
  new CliProvider({
    name: "fake-agy",
    command: process.execPath,
    shell: false,
    promptAs: "arg",
    usesOutFile: false,
    args: (_o, prompt) => ["-e", script, "--", "-p", prompt],
  });

test("prompt travels as one argument (quotes, newlines, Persian) and stdin stays empty", async () => {
  const p = fake(`let i=""; process.stdin.on("data",d=>i+=d); process.stdin.on("end",()=>console.log(JSON.stringify({ arg: process.argv[process.argv.indexOf("-p")+1], stdin: i })));`);
  const prompt = 'say "hi" & echo %PATH%\nسلام دنیا — خط دوم';
  const res = await p.execute(req(prompt));
  assert.deepEqual(JSON.parse(res.output), { arg: prompt, stdin: "" });
});

test("missing binary → ProviderUnavailableError (fallback chain skips it)", async () => {
  const p = agyProvider({ command: "definitely-not-an-installed-agy" });
  await assert.rejects(p.execute(req("x")), ProviderUnavailableError);
  assert.equal((await p.health()).ok, false);
});

test("quota / 429 output → LimitError (cooldown), other failures → plain Error", async () => {
  const limited = fake(`console.error("429 Resource has been exhausted (e.g. check quota)"); process.exit(1)`);
  await assert.rejects(limited.execute(req("x")), LimitError);
  const broken = fake(`console.error("boom"); process.exit(2)`);
  await assert.rejects(broken.execute(req("x")), (e: Error) => !(e instanceof LimitError) && /exited 2/.test(e.message));
});

test("aborting kills the process", async () => {
  const ac = new AbortController();
  const p = fake(`setTimeout(()=>{}, 60000)`);
  const run = p.execute({ ...req("x"), signal: ac.signal });
  setTimeout(() => ac.abort(), 200);
  await assert.rejects(run);
});
