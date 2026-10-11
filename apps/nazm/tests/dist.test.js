import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('committed dist/nazm.html matches src/ (rebuild with: node apps/nazm/tools/build.mjs)', () => {
  const build = fileURLToPath(new URL('../tools/build.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [build, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
