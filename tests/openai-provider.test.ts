import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAIJson, requireOpenAIKey, toStrictSchema } from '../server/openaiProvider.ts';

const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' }, note: { type: 'STRING' } }, required: ['ok'] };

test('converts optional Gemini fields to nullable required OpenAI fields', () => {
  assert.deepEqual(toStrictSchema(schema), {
    type: 'object', properties: { ok: { type: 'boolean' }, note: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    required: ['ok', 'note'], additionalProperties: false,
  });
});

test('paid calls are disabled until explicitly opted in', () => {
  const prev = process.env.ENABLE_OPENAI_HYBRID;
  try {
    process.env.ENABLE_OPENAI_HYBRID = 'false';
    assert.throws(() => requireOpenAIKey(), /비활성화/);
  } finally {
    if (prev === undefined) delete process.env.ENABLE_OPENAI_HYBRID;
    else process.env.ENABLE_OPENAI_HYBRID = prev;
  }
});

test('Responses API payload is server-only and normalized, using a mock fetch', async (t) => {
  const oldEnabled = process.env.ENABLE_OPENAI_HYBRID;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.ENABLE_OPENAI_HYBRID = 'true';
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  try {
    const mock = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const request = JSON.parse(String(init.body));
      assert.equal(request.store, false);
      assert.equal(request.text.format.strict, true);
      assert.equal(request.input[0].content[1].type, 'input_image');
      return new Response(JSON.stringify({ status: 'completed', model: 'mock-model', output: [
        { content: [{ type: 'output_text', text: '{"ok":true,"note":null}' }] }
      ] }), { status: 200 });
    });
    const result = await callOpenAIJson({ purpose: 'vision', schema, parts: [
      { text: 'fixture' }, { inlineData: { mimeType: 'image/png', data: 'AA==' } }
    ] });
    assert.deepEqual(JSON.parse(result.response.text), { ok: true });
    assert.equal(mock.mock.calls.length, 1);
  } finally {
    if (oldEnabled === undefined) delete process.env.ENABLE_OPENAI_HYBRID; else process.env.ENABLE_OPENAI_HYBRID = oldEnabled;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
  }
});
