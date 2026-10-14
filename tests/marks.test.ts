import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { imageSize, extractMarks } from "../src/voice/marks.ts";

test("extractMarks strips the MARKS line and parses levels", () => {
  const r = extractMarks('تحلیل…\nMARKS: {"levels":[{"y":40,"label":"R","type":"res"},{"y":"x"}]}');
  assert.equal(r.text, "تحلیل…");
  assert.deepEqual(r.levels, [{ y: 40, label: "R", type: "res" }]);
  assert.deepEqual(extractMarks("MARKS: {broken").levels, []);
});

test("imageSize reads PNG and JPEG headers", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elias-img-"));
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x200", "-frames:v", "1", path.join(dir, "a.png")]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-i", path.join(dir, "a.png"), path.join(dir, "a.jpg")]);
  assert.deepEqual(imageSize(path.join(dir, "a.png")), { w: 320, h: 200 });
  assert.deepEqual(imageSize(path.join(dir, "a.jpg")), { w: 320, h: 200 });
});

test("zones preserve their bounds and reject malformed model output", () => {
  const r = extractMarks('Analysis\nMARKS: {"zones":[{"y":80,"y2":110,"x1":20,"x2":300,"label":"Support","type":"sup"},null,{"y":false},{"y":20,"y2":"bad","label":42,"type":"unknown"}]}');
  assert.equal(r.text, "Analysis");
  assert.deepEqual(r.levels, [
    { y: 80, y2: 110, x1: 20, x2: 300, label: "Support", type: "sup" },
    { y: 20, label: "" },
  ]);
  assert.deepEqual(extractMarks('MARKS: {"levels":{},"zones":null}').levels, []);
});
