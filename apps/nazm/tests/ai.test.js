import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFood, _viaGemini } from '../src/services/ai.js';

test('parseFood accepts objects, JSON strings and fenced JSON; rounds and clamps', () => {
  assert.deepEqual(parseFood({ name: 'برنج', kcal: 412.6 }), { name: 'برنج', kcal: 413 });
  assert.deepEqual(parseFood('{"name":"سالاد","kcal":"۱۸۰"}'), { name: 'سالاد', kcal: 180 });
  assert.deepEqual(parseFood('```json\n{"name":"","kcal":-5}\n```'), { name: 'غذا', kcal: 0 });
  assert.throws(() => parseFood('no json here'), { code: 'bad_response' });
});

test('Gemini request carries the image and the answer is parsed', async () => {
  let seen;
  const fake = async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"name":"کباب","kcal":650}' }] } }] }) };
  };
  const r = await _viaGemini('KEY', 'data:image/jpeg;base64,AAAA', fake);
  assert.deepEqual(r, { name: 'کباب', kcal: 650 });
  assert.ok(seen.url.includes('key=KEY'));
  const parts = seen.body.contents[0].parts;
  assert.equal(parts[1].inline_data.mime_type, 'image/jpeg');
  assert.equal(parts[1].inline_data.data, 'AAAA');
  assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
});

test('Gemini errors map to codes', async () => {
  const bad = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(_viaGemini('K', 'data:image/jpeg;base64,A', bad), { code: 'bad_key' });
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(_viaGemini('K', 'data:image/jpeg;base64,A', down), { code: 'http_error' });
});
