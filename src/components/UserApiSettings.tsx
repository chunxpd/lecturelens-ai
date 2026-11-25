import { useState } from 'react';
import { apiFetch, clearUserApiKeys, setUserApiKeys } from '../utils/userApiClient';

export function UserApiSettings({ disabled = false }: { disabled?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const [gemini, setGemini] = useState('');
  const [openai, setOpenai] = useState('');
  const [applied, setApplied] = useState({ gemini: false, openai: false });
  const [notice, setNotice] = useState('');
  const [testing, setTesting] = useState<'gemini' | 'openai' | null>(null);
  const secure = window.location.protocol === 'https:' || ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);

  const apply = () => {
    if (!secure) return;
    const g = gemini.trim();
    const o = openai.trim();
    if ([g,o].some(k => k && (k.length < 8 || k.length > 2048 || !/^[!-~]+$/.test(k) || k.includes(',')))) {
      setNotice('API 키 형식을 확인하세요. 공백이나 쉼표 없이 키 전체를 입력하세요.');
      return;
    }
    setUserApiKeys({ gemini: g, openai: o });
    setApplied({ gemini: Boolean(g), openai: Boolean(o) });
    setGemini('');
    setOpenai('');
    setNotice('현재 탭에 적용했습니다. 연결 테스트로 실제 권한을 확인하세요.');
  };
  const clear = () => {
    clearUserApiKeys();
    setGemini('');
    setOpenai('');
    setApplied({ gemini: false, openai: false });
    setNotice('현재 탭의 API 키를 삭제했습니다. 이미 전송한 요청에는 영향을 주지 않습니다.');
  };
  const test = async (provider: 'gemini' | 'openai') => {
    setTesting(provider);
    setNotice('');
    try {
      const res = await apiFetch(provider === 'gemini' ? '/api/test-connection' : '/api/test-openai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provider === 'gemini' ? { preferredModel: 'auto' } : { aiProvider: 'hybrid' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '연결 실패');
      if (provider === 'gemini' && !data.testedCandidates?.some((candidate: { status: string }) => candidate.status === 'ok')) throw new Error('Gemini 응답 모델이 없습니다. 키와 프로젝트 할당량을 확인하세요.');
      if (provider === 'openai' && data.status !== 'ok') throw new Error('OpenAI 연결 테스트 실패');
      setNotice((provider === 'gemini' ? 'Gemini' : 'OpenAI') + ' 연결 성공: ' + (data.activeModel || data.model || 'OK'));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '연결 실패');
    } finally {
      setTesting(null);
    }
  };
  const busy = disabled || testing !== null;
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)} className="font-semibold text-slate-800">
          개인 API 키 설정 {expanded ? '▴' : '▾'}
        </button>
        <div className="text-xs text-slate-600">Gemini: {applied.gemini ? '입력됨' : '미입력'} · OpenAI: {applied.openai ? '입력됨' : '미입력'}</div>
      </div>
      {expanded && <>
        <p className="text-xs text-slate-600">본인 API 키만 사용합니다. 서버 기본 키는 사용하지 않습니다. 키는 현재 브라우저 탭 메모리에만 유지되며 새로고침하거나 닫으면 다시 입력해야 합니다. API 호출은 각자의 API 프로젝트에 과금될 수 있습니다. 요청 시 HTTPS로 이 서버를 거쳐 제공업체로 전달됩니다.</p>
        {!secure && <p className="text-red-700 text-xs">보안을 위해 HTTPS 또는 localhost에서만 키를 입력할 수 있습니다.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-slate-700">
            <span className="font-semibold">Gemini API 키 (영상 분석 필수)</span>
            <input type="password" autoComplete="off" spellCheck={false} disabled={busy || !secure} value={gemini}
              onChange={e => setGemini(e.target.value)} placeholder={applied.gemini ? '입력됨 · 변경하려면 두 키 다시 입력' : '개인 Gemini API 키'} className="w-full rounded border border-slate-300 bg-white p-2" />
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-700">Gemini 키 발급</a>
          </label>
          <label className="space-y-1 text-xs text-slate-700">
            <span className="font-semibold">OpenAI API 키 (하이브리드 모드)</span>
            <input type="password" autoComplete="off" spellCheck={false} disabled={busy || !secure} value={openai}
              onChange={e => setOpenai(e.target.value)} placeholder={applied.openai ? '입력됨 · 변경하려면 두 키 다시 입력' : '개인 OpenAI API 키'} className="w-full rounded border border-slate-300 bg-white p-2" />
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-700">OpenAI 키 발급</a>
          </label>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" disabled={busy || !secure || (!gemini.trim() && !openai.trim())} onClick={apply} className="rounded bg-blue-900 text-white px-3 py-2 disabled:opacity-50">키 적용 (두 입력값으로 교체)</button>
          <button type="button" disabled={busy} onClick={clear} className="rounded border border-slate-300 px-3 py-2">키 삭제</button>
          <button type="button" disabled={busy || !applied.gemini} onClick={() => void test('gemini')} className="rounded border border-slate-300 px-3 py-2 disabled:opacity-50">Gemini 연결 테스트</button>
          <button type="button" disabled={busy || !applied.openai} onClick={() => void test('openai')} className="rounded border border-slate-300 px-3 py-2 disabled:opacity-50">OpenAI 연결 테스트 (유료)</button>
        </div>
        {testing && <p role="status" className="text-xs">연결 확인 중…</p>}
        {notice && <p role="status" className="text-xs text-slate-700">{notice}</p>}
      </>}
    </section>
  );
}
