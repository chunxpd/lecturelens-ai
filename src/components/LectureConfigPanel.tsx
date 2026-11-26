import { apiFetch } from '../utils/userApiClient';
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ChevronDown, ChevronUp, FileSpreadsheet, FileText, Loader2, SlidersHorizontal, X } from 'lucide-react';
import type {
  DesignThemeId,
  LanguageMode,
  LectureConfig,
  LectureType,
  ReferenceThemeProfile,
  ScriptDetailLevel,
  StudentLevel,
  VideoImageWeight,
} from '../types/lecture';
import { BUILTIN_THEMES } from '../utils/pptxThemeAndTemplate';

interface LectureConfigPanelProps {
  config: LectureConfig;
  onChange: (next: LectureConfig) => void;
  availableFreeModels: string[];
  disabled?: boolean;
}

const STUDENT_LEVEL_LABELS: Record<StudentLevel, string> = {
  intro: '입문/교양 대학생',
  'undergrad-basic': '대학 1~2학년 기초',
  'undergrad-mid': 'AI/SW 학부 전공 (표준)',
  'undergrad-adv': '대학 3~4학년 심화',
  grad: '대학원 세미나 수준',
};

const LECTURE_TYPE_LABELS: Record<LectureType, string> = {
  theory: '이론 중심 강의',
  practice: '실습·코드 중심 강의',
  hybrid: '이론 + 실습 혼합형',
};

const IMAGE_WEIGHT_LABELS: Record<VideoImageWeight, string> = {
  low: '최소 (핵심 도식 위주)',
  medium: '보통 (균형 배치)',
  high: '높음 (장면 중심)',
  max: '최대 (실제 영상 화면 최우선)',
};

const SCRIPT_DETAIL_LABELS: Record<ScriptDetailLevel, string> = {
  brief: '핵심 요약형 (2~3문장)',
  standard: '표준 강의형 (4~5문장)',
  detailed: '상세 설명형 (6~8문장)',
  verbatim: '강의실 대본형 (도입·설명·수식·질문)',
};

const LANGUAGE_LABELS: Record<LanguageMode, string> = {
  'ko-en': '한국어 + 영문 용어 병기',
  ko: '한국어 중심',
  en: '영문 슬라이드 + 한국어 대본',
};

export function LectureConfigPanel({
  config,
  onChange,
  availableFreeModels,
  disabled = false,
}: LectureConfigPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [openAIStatus, setOpenAIStatus] = useState('');
  const [isTestingOpenAI, setIsTestingOpenAI] = useState(false);
  const testOpenAI = async () => {
    setIsTestingOpenAI(true);
    try {
      const res = await apiFetch('/api/test-openai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiProvider: 'hybrid' }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'OpenAI 연결 실패');
      setOpenAIStatus(`연결 성공: ${result.model} · 이미지 모델 ${result.visionModel} (소액 API 사용료 발생)`);
    } catch (err) { setOpenAIStatus(err instanceof Error ? err.message : '연결 실패'); }
    finally { setIsTestingOpenAI(false); }
  };
  const [isParsingTemplate, setIsParsingTemplate] = useState(false);
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const pptxInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const update = <K extends keyof LectureConfig>(key: K, value: LectureConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const handleUploadTemplate = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsParsingTemplate(true);
    setUploadNote(null);
    try {
      const formData = new FormData();
      formData.append('template', file);
      const res = await apiFetch('/api/parse-pptx-template', { method: 'POST', body: formData });
      const data = (await res.json()) as { profile?: ReferenceThemeProfile; error?: string };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || 'PPTX 템플릿 분석에 실패했습니다.');
      }
      onChange({
        ...config,
        themeId: 'custom-template',
        referenceTemplate: data.profile,
      });
      setUploadNote(`참고 PPTX 반영 완료: ${data.profile.notesSummary}`);
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : 'PPTX 템플릿 분석 중 오류가 발생했습니다.');
    } finally {
      setIsParsingTemplate(false);
    }
  };

  const handleUploadPdf = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsParsingPdf(true);
    setUploadNote(null);
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      const res = await apiFetch('/api/parse-pdf', { method: 'POST', body: formData });
      const data = (await res.json()) as { summary?: string; fileName?: string; error?: string };
      if (!res.ok || !data.summary) {
        throw new Error(data.error || 'PDF 참고자료 분석에 실패했습니다.');
      }
      onChange({
        ...config,
        referencePdfSummary: `[${data.fileName || file.name}]\n${data.summary}`,
      });
      setUploadNote(`참고 PDF(${data.fileName || file.name}) 요약이 강의 설계 프롬프트에 반영되었습니다.`);
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : 'PDF 분석 중 오류가 발생했습니다.');
    } finally {
      setIsParsingPdf(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-[#F8FAFC]">
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#1E3A8A] shrink-0" />
          <span className="font-semibold text-[#0F172A]">강의 설계 설정:</span>
          <span>{config.courseName || 'AI응용기술'}</span>
          <span aria-hidden="true">·</span>
          <span>{config.contentMode === 'video-faithful' ? '영상 충실형' : '전공 심화형'}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{config.durationMinutes}분</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {config.contentMode === 'video-faithful' ? (config.slideCountMode === 'auto' ? '영상 장면 기준 자동' : `최대 ${config.targetSlideCount}장`) : config.slideCountMode === 'auto' ? `약 ${config.targetSlideCount}장(자동)` : `${config.targetSlideCount}장`}
          </span>
          <span aria-hidden="true">·</span>
          <span>{STUDENT_LEVEL_LABELS[config.studentLevel]}</span>
          <span aria-hidden="true">·</span>
          <span>{LANGUAGE_LABELS[config.languageMode]}</span>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A8A] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isExpanded ? '설정 접기' : '세부 설정 · 참고 PPTX/PDF 열기'}
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">자료 제작 방식</span>
        {([{ value: 'academic', label: '전공 심화형 (기존)' }, { value: 'video-faithful', label: '영상 충실형 (원본 내용 중심)' }] as const).map(mode => (
          <button key={mode.value} type="button" disabled={disabled}
            aria-pressed={(config.contentMode || 'academic') === mode.value}
            onClick={() => update('contentMode', mode.value)}
            className={`rounded-md border px-3 py-2 text-xs font-semibold ${(config.contentMode || 'academic') === mode.value ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]' : 'bg-white text-slate-700 border-slate-200'}`}>
            {mode.label}
          </button>
        ))}
        <p className="w-full text-xs text-slate-500">
          {config.contentMode === 'video-faithful'
            ? '영상 순서·실제 화면·영상 속 설명 중심. 외부 기술·수식·산업 사례를 추가하지 않습니다. 자동 장수는 확인된 장면 수 기준이며 지정 장수는 상한입니다. 기존 분석 결과에는 적용되지 않으므로 전체 분석을 다시 실행하세요.'
            : '기존 전공 강의 방식: 영상 내용을 바탕으로 학부 수준의 기술·수식·사례·실습을 보충합니다.'}
        </p>
      </div>

      {isExpanded && (
        <div className="p-4 border-t border-slate-200 bg-white rounded-b-lg space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">교과목명</span>
              <input
                type="text"
                disabled={disabled}
                value={config.courseName}
                onChange={(e) => update('courseName', e.target.value)}
                placeholder="AI응용기술"
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">강의 주제 (선택)</span>
              <input
                type="text"
                disabled={disabled}
                value={config.lectureTopic}
                onChange={(e) => update('lectureTopic', e.target.value)}
                placeholder="미입력 시 영상에서 자동 추출"
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">담당 교수명 (표지 표기)</span>
              <input
                type="text"
                disabled={disabled}
                value={config.professorName}
                onChange={(e) => update('professorName', e.target.value)}
                placeholder="예: 한국폴리텍대학 교수"
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <div className="space-y-2 rounded-md border border-slate-200 p-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">AI 분석 엔진</span>
                <select disabled={disabled} value={config.aiProvider || 'gemini'}
                  onChange={(e) => { update('aiProvider', e.target.value === 'hybrid' ? 'hybrid' : 'gemini'); setOpenAIStatus(''); }}
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs bg-white">
                  <option value="gemini">Gemini 전용 (기존 방식)</option>
                  <option value="hybrid">하이브리드 (Gemini 영상 + OpenAI 강의자료/이미지, 유료)</option>
                </select>
              </label>
              {config.aiProvider === 'hybrid' && (
                <div className="text-xs text-slate-600 space-y-1">
                  <p>OpenAI 모델은 서버 설정에서 지정하고, API 키는 상단 개인 API 키 설정에 입력합니다. 강의자료 생성·이미지 판독에 사용량 기반 비용이 발생합니다.</p>
                  <button type="button" disabled={disabled || isTestingOpenAI} onClick={testOpenAI} className="rounded border border-slate-300 px-2 py-1">
                    {isTestingOpenAI ? 'OpenAI 연결 확인 중…' : 'OpenAI API 연결 테스트 (유료)'}
                  </button>
                  {openAIStatus && <p role="status">{openAIStatus}</p>}
                </div>
              )}
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">선호 Gemini 영상 분석 모델</span>
              <select
                disabled={disabled}
                value={config.preferredModel}
                onChange={(e) => update('preferredModel', e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                <option value="auto">자동 선택 (3.5-flash-lite 우선)</option>
                {Array.from(
                  new Set([
                    'gemini-3.5-flash-lite',
                    'gemini-3.1-flash-lite',
                    'gemini-4-hydrogen',
                    ...availableFreeModels,
                  ]),
                ).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">강의 시간 (분)</span>
              <input
                type="number"
                min={10}
                max={180}
                disabled={disabled}
                value={config.durationMinutes}
                onChange={(e) => {
                  const mins = Math.max(10, Math.min(180, Number(e.target.value) || 25));
                  const autoSlides =
                    mins <= 30
                      ? Math.min(25, Math.max(20, mins))
                      : mins <= 60
                        ? Math.min(40, Math.max(30, Math.round(mins * 0.7)))
                        : Math.min(60, Math.max(40, Math.round(mins * 0.65)));
                  onChange({
                    ...config,
                    durationMinutes: mins,
                    targetSlideCount:
                      config.slideCountMode === 'auto' ? autoSlides : config.targetSlideCount,
                  });
                }}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-700">슬라이드 수량 {config.contentMode === 'video-faithful' ? '(지정값은 상한)' : ''}</span>
              <div className="flex items-center gap-1.5">
                <select
                  disabled={disabled}
                  value={config.slideCountMode}
                  onChange={(e) => {
                    const nextMode = e.target.value as 'auto' | 'custom';
                    const mins = config.durationMinutes || 25;
                    const autoSlides =
                      mins <= 30
                        ? Math.min(25, Math.max(20, mins))
                        : mins <= 60
                          ? Math.min(40, Math.max(30, Math.round(mins * 0.7)))
                          : Math.min(60, Math.max(40, Math.round(mins * 0.65)));
                    onChange({
                      ...config,
                      slideCountMode: nextMode,
                      targetSlideCount: nextMode === 'auto' ? autoSlides : config.targetSlideCount,
                    });
                  }}
                  className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="auto">자동</option>
                  <option value="custom">지정</option>
                </select>
                <input
                  type="number"
                  min={8}
                  max={60}
                  disabled={disabled || config.slideCountMode === 'auto'}
                  value={config.targetSlideCount}
                  onChange={(e) =>
                    update('targetSlideCount', Math.max(8, Math.min(60, Number(e.target.value) || 25)))
                  }
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#0F172A] disabled:bg-slate-50"
                />
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">수강 대상 수준</span>
              <select
                disabled={disabled}
                value={config.studentLevel}
                onChange={(e) => update('studentLevel', e.target.value as StudentLevel)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.entries(STUDENT_LEVEL_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">강의 유형</span>
              <select
                disabled={disabled}
                value={config.lectureType}
                onChange={(e) => update('lectureType', e.target.value as LectureType)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.entries(LECTURE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">언어 표기 방식</span>
              <select
                disabled={disabled}
                value={config.languageMode}
                onChange={(e) => update('languageMode', e.target.value as LanguageMode)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.entries(LANGUAGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">영상 이미지 활용 비중</span>
              <select
                disabled={disabled}
                value={config.videoImageWeight}
                onChange={(e) => update('videoImageWeight', e.target.value as VideoImageWeight)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.entries(IMAGE_WEIGHT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">교수자 대본 상세도</span>
              <select
                disabled={disabled}
                value={config.scriptDetail}
                onChange={(e) => update('scriptDetail', e.target.value as ScriptDetailLevel)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.entries(SCRIPT_DETAIL_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">PPTX 디자인 테마</span>
              <select
                disabled={disabled}
                value={config.themeId}
                onChange={(e) => update('themeId', e.target.value as DesignThemeId)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.values(BUILTIN_THEMES).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                {config.referenceTemplate && (
                  <option value="custom-template">
                    참고 템플릿 ({config.referenceTemplate.fileName})
                  </option>
                )}
              </select>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700">
            {(
              [
                ['autoInsertVideoFrames', '영상 캡처 자동 삽입'],
                ['includeEquations', '수식 포함 (KaTeX 이미지)'],
                ['includeMatrixExamples', '행렬 차원·수치 예제'],
                ['includeCodeExamples', '실습 코드 포함'],
                ['includeUseCases', '활용 사례 포함'],
                ['includeIndustryCases', '산업 현장 사례'],
                ['includeQuiz', '학습 확인 퀴즈'],
                ['includeSpeakerScript', '교수자 대본 수록'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={disabled || (config.contentMode === 'video-faithful' && key !== 'autoInsertVideoFrames' && key !== 'includeSpeakerScript')}
                  checked={config.contentMode === 'video-faithful' && key !== 'autoInsertVideoFrames' && key !== 'includeSpeakerScript' ? false : Boolean(config[key])}
                  onChange={(e) => update(key, e.target.checked)}
                  className="rounded border-slate-300 text-[#1E3A8A] focus:ring-[#1E3A8A]"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={pptxInputRef}
                type="file"
                accept=".pptx"
                onChange={handleUploadTemplate}
                className="hidden"
              />
              <button
                type="button"
                disabled={disabled || isParsingTemplate}
                onClick={() => pptxInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-md hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isParsingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-[#0F766E]" />}
                참고 PPTX 템플릿 분석 반영
              </button>

              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleUploadPdf}
                className="hidden"
              />
              <button
                type="button"
                disabled={disabled || isParsingPdf}
                onClick={() => pdfInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-md hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isParsingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-[#1E3A8A]" />}
                참고 PDF 강의자료 업로드
              </button>

              {config.referenceTemplate && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...config,
                      referenceTemplate: null,
                      themeId: config.themeId === 'custom-template' ? 'navy-teal' : config.themeId,
                    })
                  }
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  참고 템플릿 해제 ({config.referenceTemplate.fileName})
                </button>
              )}

              {config.referencePdfSummary && (
                <button
                  type="button"
                  onClick={() => update('referencePdfSummary', '')}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  참고 PDF 해제
                </button>
              )}
            </div>

            {uploadNote && (
              <p className="text-xs text-[#0F766E] font-medium">{uploadNote}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
