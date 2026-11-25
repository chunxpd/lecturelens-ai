import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withUserApiKeys, requireUserApiKey, getRequestActiveModel, setRequestActiveModel, redactApiKeys, normalizeKey } from '../server/userApiKeys.ts';

test('server keys never substitute for absent personal keys', () => {
  const oldGemini = process.env.GEMINI_API_KEY;
  const oldOpenAI = process.env.OPENAI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = 'synthetic-owner-gemini';
    process.env.OPENAI_API_KEY = 'synthetic-owner-openai';
    assert.throws(() => requireUserApiKey('gemini'), /API 키가 없습니다/);
    assert.throws(() => withUserApiKeys({}, () => requireUserApiKey('openai')), /API 키가 없습니다/);
    assert.throws(() => withUserApiKeys({ gemini: 'synthetic-a-gemini' }, () => requireUserApiKey('openai')), /API 키가 없습니다/);
  } finally {
    if (oldGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldGemini;
    if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAI;
  }
});

test('concurrent requests preserve each user key and active model across awaits', async () => {
  const run = (id: string, delay: number) => withUserApiKeys({
    gemini: 'synthetic-gemini-' + id, openai: 'synthetic-openai-' + id
  }, async () => {
    assert.equal(getRequestActiveModel(), null);
    setRequestActiveModel('model-' + id);
    await new Promise(resolve => setTimeout(resolve, delay));
    assert.equal(requireUserApiKey('gemini'), 'synthetic-gemini-' + id);
    assert.equal(requireUserApiKey('openai'), 'synthetic-openai-' + id);
    assert.equal(getRequestActiveModel(), 'model-' + id);
    assert.equal(redactApiKeys('error synthetic-openai-' + id), 'error [API KEY REDACTED]');
  });
  await Promise.all([run('a', 20), run('b', 1)]);
  assert.equal(getRequestActiveModel(), null);
  assert.throws(() => requireUserApiKey('openai'), /API 키가 없습니다/);
});

test('invalid or duplicate headers are rejected', () => {
  assert.equal(normalizeKey('x'), undefined);
  assert.equal(normalizeKey('valid-key,other-key'), undefined);
  assert.equal(normalizeKey('valid-key\nother-key'), undefined);
  assert.equal(normalizeKey('  synthetic-valid-key  '), 'synthetic-valid-key');
});
