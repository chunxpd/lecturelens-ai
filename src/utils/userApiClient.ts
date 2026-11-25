// Keys are intentionally held in memory only. Never put them in localStorage,
// sessionStorage, IndexedDB, project configuration, URLs, or a generated file.
type UserApiKeys = { gemini: string; openai: string };
let keys: UserApiKeys = { gemini: '', openai: '' };

export function setUserApiKeys(next: UserApiKeys): void {
  keys = { gemini: next.gemini.trim(), openai: next.openai.trim() };
}

export function clearUserApiKeys(): void {
  keys = { gemini: '', openai: '' };
}

const geminiOnly = new Set(['/api/models', '/api/test-connection', '/api/parse-pdf', '/api/refine-slide', '/api/regenerate-slide']);
const openaiOnly = new Set(['/api/test-openai']);
const either = new Set(['/api/analyze-video', '/api/analyze-upload', '/api/verify-slide-frames', '/api/inspect-captured-frames']);

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !path.startsWith('/api/') || !url.pathname.startsWith('/api/')) {
    throw new Error('API 요청은 현재 사이트의 API 주소만 허용합니다.');
  }
  const headers = new Headers(init.headers);
  // Do not accept key headers supplied through callers.
  headers.delete('x-lecturelens-gemini-key');
  headers.delete('x-lecturelens-openai-key');
  if ((geminiOnly.has(url.pathname) || either.has(url.pathname)) && keys.gemini) headers.set('x-lecturelens-gemini-key', keys.gemini);
  if ((openaiOnly.has(url.pathname) || either.has(url.pathname)) && keys.openai) headers.set('x-lecturelens-openai-key', keys.openai);
  if ((headers.has('x-lecturelens-gemini-key') || headers.has('x-lecturelens-openai-key')) &&
      window.location.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)) {
    throw new Error('API 키 입력 및 전송은 HTTPS 사이트에서만 이용할 수 있습니다.');
  }
  return fetch(url.pathname + url.search, { ...init, headers, cache: 'no-store', redirect: 'error', credentials: 'same-origin' });
}
