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

function isRemoteHost(): boolean {
  return !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

// Send smaller copies to AI vision only. Original PPTX frame images remain untouched.
async function compressVisionImage(dataUrl: string): Promise<string> {
  if (dataUrl.length <= 280000) return dataUrl;
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지 전송 크기 조정 실패');
  for (const maxWidth of [1280, 960, 720, 480]) {
    const scale = Math.min(1, maxWidth / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.72, 0.55]) {
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.length <= 280000) return jpeg;
    }
  }
  throw new Error('이미지가 웹 호스팅 전송 제한을 초과합니다. 로컬 버전을 이용하세요.');
}

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
  let body = init.body;
  if (isRemoteHost()) {
    if (url.pathname === '/api/analyze-upload' || url.pathname === '/api/extract-frames') {
      throw new Error('웹 호스팅에서는 MP4 서버 분석이 제한됩니다. YouTube 또는 로컬 버전을 사용하세요.');
    }
    if (body instanceof FormData) {
      for (const value of body.values()) {
        if (value instanceof File && value.size > 3 * 1024 * 1024) throw new Error('웹 버전의 참고 파일은 최대 3MB입니다.');
      }
    }
    if (typeof body === 'string' && ['/api/verify-slide-frames','/api/inspect-captured-frames'].includes(url.pathname)) {
      const payload = JSON.parse(body);
      const field = url.pathname === '/api/verify-slide-frames' ? 'items' : 'frames';
      if (Array.isArray(payload[field])) {
        payload[field] = await Promise.all(payload[field].map(async (item: { imageDataUrl?: string }) =>
          typeof item.imageDataUrl === 'string' ? { ...item, imageDataUrl: await compressVisionImage(item.imageDataUrl) } : item));
      }
      body = JSON.stringify(payload);
    }
    if (typeof body === 'string' && new Blob([body]).size > 3.5 * 1024 * 1024) throw new Error('웹 호스팅 요청 크기를 초과했습니다. 참고 자료를 줄이거나 로컬 버전을 사용하세요.');
  }
  return fetch(url.pathname + url.search, { ...init, body, headers, cache: 'no-store', redirect: 'error', credentials: 'same-origin' });
}
