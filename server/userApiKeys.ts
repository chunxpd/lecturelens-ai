import { AsyncLocalStorage } from 'node:async_hooks';

export type UserApiKeys = { gemini?: string; openai?: string };
type RequestContext = { keys: UserApiKeys; activeModel: string | null };
const requests = new AsyncLocalStorage<RequestContext>();

export const KEY_HEADERS = {
  gemini: 'x-lecturelens-gemini-key',
  openai: 'x-lecturelens-openai-key',
} as const;

export function normalizeKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  // Accept current and future provider formats; reject duplicate/malformed headers.
  return key.length >= 8 && key.length <= 2048 && /^[\x21-\x7e]+$/.test(key) && !key.includes(',') ? key : undefined;
}

export function withUserApiKeys<T>(keys: UserApiKeys, run: () => T): T {
  return requests.run({ keys: { gemini: normalizeKey(keys.gemini), openai: normalizeKey(keys.openai) }, activeModel: null }, run);
}

export function requireUserApiKey(provider: keyof UserApiKeys): string {
  const key = requests.getStore()?.keys[provider];
  if (!key) throw new Error((provider === 'gemini' ? 'Gemini' : 'OpenAI') + ' API 키가 없습니다. 상단 API 키 설정에서 본인의 키를 입력하고 적용하세요.');
  // Deliberately never fall back to process.env, Google credentials, or another request.
  return key;
}

export function getRequestActiveModel(): string | null {
  return requests.getStore()?.activeModel ?? null;
}

export function setRequestActiveModel(model: string): void {
  const request = requests.getStore();
  if (request) request.activeModel = model;
}

export function redactApiKeys(value: string): string {
  let safe = value;
  for (const key of Object.values(requests.getStore()?.keys ?? {})) {
    if (key) safe = safe.split(key).join('[API KEY REDACTED]');
  }
  return safe.replace(/(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{15,})/g, '[API KEY REDACTED]');
}
