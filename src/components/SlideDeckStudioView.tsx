import { apiFetch } from '../utils/userApiClient';
import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Image as ImageIcon,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  CapturedFrame,
  DiagramPreset,
  LectureSlide,
  SlideLayoutType,
  SourceTier,
} from '../types/lecture';
import { DIAGRAM_LABELS, DiagramCanvas } from './DiagramCanvas';
import { MathBlock } from './MathBlock';
import { extractSingleFrameClientSide } from '../utils/videoFrameExtractor';

interface SlideDeckStudioViewProps {
  slides: LectureSlide[];
  capturedFrames: Record<string, CapturedFrame>;
  contextSummary: string;
  courseName: string;
  hasYoutubePlayer: boolean;
  mp4File: File | null;
  onUpdateSlide: (slideNumber: number, updated: LectureSlide) => void;
  onSetSlides: (nextSlides: LectureSlide[]) => void;
  onJumpToTimestamp: (seconds: number) => void;
  onUpdateFrame: (frame: CapturedFrame) => void;
}

const LAYOUT_LABELS: Record<SlideLayoutType, string> = {
  cover: '표지 (Cover)',
  objectives: '학습 목표 (Objectives)',
  agenda: '강의 목차 (Agenda)',
  'video-hero': '영상 대형 캡처 중심 (Video Hero 60%)',
  'image-left-text': '좌측 이미지 · 우측 핵심 요약',
  'image-right-text': '좌측 핵심 요약 · 우측 이미지',
  'multi-capture-compare': '다중 장면 비교 (Multi-Capture)',
  timeline: '발전 타임라인 (Timeline)',
  'comparison-table': '기술 비교표 (Comparison Table)',
  'architecture-diagram': '아키텍처 도식 (Architecture)',
  'process-steps': '단계별 연산 흐름 (Process Steps)',
  'equation-focus': '핵심 수식 집중 (Equation Focus)',
  'matrix-stepwise': '행렬 차원 · 수치 예제 (Matrix)',
  'chart-analysis': '성능/그래프 분석 (Chart)',
  'code-lab': '실습 코드 · 해설 (Code Lab)',
  'case-study': '산업 · 응용 사례 (Case Study)',
  'key-concept': '핵심 개념 강조 (Key Callout)',
  summary: '핵심 요약 (Summary)',
  quiz: '학습 확인 퀴즈 (Quiz)',
  references: '참고문헌 · 출처 (References)',
};

const TIER_META: Record<SourceTier, { label: string; colorClass: string }> = {
  A: { label: '출처 A · 영상 직접 확인', colorClass: 'text-[#0284C7]' },
  B: { label: '출처 B · 영상 연계 학부 보충', colorClass: 'text-[#1E3A8A]' },
  C: { label: '출처 C · 전공 교육 학술 추가', colorClass: 'text-[#4F46E5]' },
};

function findMatchedFrames(
  slide: LectureSlide,
  capturedFrames: Record<string, CapturedFrame>,
): CapturedFrame[] {
  const frames: CapturedFrame[] = [];
  if (slide.capturedFrameIds && slide.capturedFrameIds.length > 0) {
    for (const id of slide.capturedFrameIds) {
      if (capturedFrames[id]) frames.push(capturedFrames[id]);
    }
  }
  if (frames.length === 0 && slide.captureTimestamp && slide.captureTimestamp !== '해당 없음') {
    const all = Object.values(capturedFrames);
    if (all.length > 0) {
      const sorted = [...all]
        .map((f) => ({ f, diff: Math.abs(f.timestampSeconds - slide.captureSeconds) }))
        .sort((a, b) => a.diff - b.diff);
      if (sorted[0] && sorted[0].diff <= 15) {
        frames.push(sorted[0].f);
      }
    }
  }
  return frames;
}

function parseMmSs(mmss: string): number {
  const parts = (mmss || '0:00')
    .trim()
    .split(':')
    .map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return 0;
}

export function SlideDeckStudioView({
  slides,
  capturedFrames,
  contextSummary,
  courseName,
  hasYoutubePlayer,
  mp4File,
  onUpdateSlide,
  onSetSlides,
  onJumpToTimestamp,
  onUpdateFrame,
}: SlideDeckStudioViewProps) {
  const [activeSlideNum, setActiveSlideNum] = useState<number>(slides[0]?.slideNumber ?? 1);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isRecapturing, setIsRecapturing] = useState(false);
  const [refineFeedback, setRefineFeedback] = useState<string | null>(null);

  const activeIndex = Math.max(
    0,
    slides.findIndex((s) => s.slideNumber === activeSlideNum),
  );
  const activeSlide = slides[activeIndex] ?? slides[0];

  if (!activeSlide) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        생성된 슬라이드가 없습니다.
      </div>
    );
  }

  const updateField = <K extends keyof LectureSlide>(key: K, value: LectureSlide[K]) => {
    onUpdateSlide(activeSlide.slideNumber, {
      ...activeSlide,
      [key]: value,
    });
  };

  const renumberSlides = (list: LectureSlide[]) =>
    list.map((s, idx) => ({ ...s, slideNumber: idx + 1 }));

  const handleAddSlide = () => {
    const newSlide: LectureSlide = {
      slideNumber: activeSlide.slideNumber + 1,
      section: activeSlide.section,
      titleKo: '새 강의 슬라이드',
      titleEn: 'New Lecture Slide',
      slideType: 'key-concept',
      estimatedMinutes: 1,
      bullets: ['핵심 학습 포인트 1', '핵심 학습 포인트 2'],
      keyHighlight: '핵심 요약 메시지를 입력하세요.',
      equationLatex: '',
      matrixNote: '',
      diagramPreset: 'none',
      diagramCaption: '',
      captureTimestamp: '해당 없음',
      captureSeconds: 0,
      captureGuideText: '',
      sourceBoundary: 'video-plus-supplementary',
      sourceTier: 'B',
      videoBasedPoints: '',
      supplementaryPoints: '교수자 추가 보충 슬라이드',
      speakerScript: '이 슬라이드에서는 추가 보충 개념을 설명합니다.',
    };
    const next = [...slides];
    next.splice(activeIndex + 1, 0, newSlide);
    const renumbered = renumberSlides(next);
    onSetSlides(renumbered);
    setActiveSlideNum(activeIndex + 2);
  };

  const handleDuplicateSlide = () => {
    const copy: LectureSlide = {
      ...activeSlide,
      titleKo: `${activeSlide.titleKo} (복제)`,
    };
    const next = [...slides];
    next.splice(activeIndex + 1, 0, copy);
    const renumbered = renumberSlides(next);
    onSetSlides(renumbered);
    setActiveSlideNum(activeIndex + 2);
  };

  const handleDeleteSlide = () => {
    if (slides.length <= 1) return;
    const next = slides.filter((_, idx) => idx !== activeIndex);
    const renumbered = renumberSlides(next);
    onSetSlides(renumbered);
    setActiveSlideNum(Math.min(activeSlide.slideNumber, renumbered.length));
  };

  const handleMoveSlide = (direction: -1 | 1) => {
    const targetIdx = activeIndex + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;
    const next = [...slides];
    const [moved] = next.splice(activeIndex, 1);
    next.splice(targetIdx, 0, moved);
    const renumbered = renumberSlides(next);
    onSetSlides(renumbered);
    setActiveSlideNum(targetIdx + 1);
  };

  const activeBullets = Array.isArray(activeSlide.bullets) ? activeSlide.bullets : [];

  const handleBulletChange = (idx: number, val: string) => {
    const next = [...activeBullets];
    next[idx] = val;
    updateField('bullets', next);
  };

  const handleAddBullet = () => {
    updateField('bullets', [...activeBullets, '새 강의 포인트를 입력하세요']);
  };

  const handleRemoveBullet = (idx: number) => {
    updateField(
      'bullets',
      activeBullets.filter((_, i) => i !== idx),
    );
  };

  const handleAiRefine = async () => {
    if (!refinePrompt.trim() || isRefining) return;
    setIsRefining(true);
    setRefineFeedback(null);
    try {
      const res = await apiFetch('/api/refine-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slide: activeSlide,
          instruction: refinePrompt.trim(),
        }),
      });
      const data = (await res.json()) as { slide?: LectureSlide; error?: string };
      if (!res.ok || !data.slide) {
        throw new Error(data.error || '슬라이드 보완 요청에 실패했습니다.');
      }
      onUpdateSlide(activeSlide.slideNumber, data.slide);
      setRefinePrompt('');
      setRefineFeedback('슬라이드와 교수자 스크립트가 반영되었습니다.');
    } catch (err) {
      setRefineFeedback(err instanceof Error ? err.message : '요청 처리 중 오류가 발생했습니다.');
    } finally {
      setIsRefining(false);
    }
  };

  const handleRegenerateSingle = async (mode: 'full' | 'design-only') => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    setRefineFeedback(null);
    try {
      const res = await apiFetch('/api/regenerate-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slide: activeSlide,
          contextSummary,
          mode,
        }),
      });
      const data = (await res.json()) as { slide?: LectureSlide; error?: string };
      if (!res.ok || !data.slide) {
        throw new Error(data.error || '단일 슬라이드 재생성에 실패했습니다.');
      }
      onUpdateSlide(activeSlide.slideNumber, data.slide);
      setRefineFeedback(
        mode === 'design-only'
          ? '레이아웃과 도식 구성을 개선했습니다.'
          : '현재 슬라이드 내용과 대본을 새로 구성했습니다.',
      );
    } catch (err) {
      setRefineFeedback(err instanceof Error ? err.message : '재생성 중 오류가 발생했습니다.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRecaptureForSlide = async () => {
    if (!mp4File || isRecapturing) return;
    setIsRecapturing(true);
    setRefineFeedback(null);
    try {
      const sec = parseMmSs(activeSlide.captureTimestamp);
      const frame = await extractSingleFrameClientSide(
        mp4File,
        sec,
        courseName || '강의 영상',
        activeSlide.titleKo,
      );
      if (frame) {
        onUpdateFrame(frame);
        updateField('capturedFrameIds', [frame.id]);
        updateField('captureSeconds', frame.timestampSeconds);
        setRefineFeedback(`시점 ${frame.timestampFormatted} 실제 영상 프레임을 추출하여 슬라이드에 연결했습니다.`);
      }
    } catch (err) {
      setRefineFeedback(err instanceof Error ? err.message : '프레임 재추출 실패');
    } finally {
      setIsRecapturing(false);
    }
  };

  const matchedFrames = findMatchedFrames(activeSlide, capturedFrames);
  const allFrames = Object.values(capturedFrames).sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds,
  );
  const rawTier = String(activeSlide.sourceTier || 'B').trim().toUpperCase();
  const normalizedTier: SourceTier = rawTier === 'A' || rawTier === 'C' ? rawTier : 'B';
  const tierInfo = TIER_META[normalizedTier] ?? TIER_META.B;
  const hasCaptureGuide =
    Boolean(activeSlide.captureTimestamp) && activeSlide.captureTimestamp !== '해당 없음';

  const renderVisualBox = () => {
    if (matchedFrames.length > 0) {
      const frame = matchedFrames[0];
      return (
        <div className="rounded-lg border border-slate-200 bg-slate-900 overflow-hidden">
          <img
            src={frame.imageDataUrl}
            alt={activeSlide.titleKo}
            className="w-full max-h-[300px] object-contain mx-auto"
          />
          <div className="bg-[#F8FAFC] border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-600 flex items-center justify-between gap-2">
            <span className="truncate">
              실제 영상 캡처 ({frame.timestampFormatted}) · {frame.sourceUrl || frame.sourceLabel}
              {activeSlide.visionVerified === 'verified' && (
                <strong className="ml-2 text-[#0F766E]">· AI 시각 일치 검증됨</strong>
              )}
              {activeSlide.visionVerified === 'needs-review' && (
                <strong className="ml-2 text-amber-700">
                  · 검토 필요 ({activeSlide.visionMatchNote || '다른 시점 재캡처 권장'})
                </strong>
              )}
            </span>
            <span className="font-mono tabular-nums shrink-0">
              {frame.width}×{frame.height}
            </span>
          </div>
        </div>
      );
    }

    if (activeSlide.diagramPreset !== 'none') {
      return (
        <DiagramCanvas
          preset={activeSlide.diagramPreset}
          caption={activeSlide.diagramCaption}
        />
      );
    }

    if (hasCaptureGuide) {
      return (
        <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50/70 p-4">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900">
              <Camera className="w-3.5 h-3.5 text-amber-700" />
              권장 영상 캡처 시점: {activeSlide.captureTimestamp}
            </span>
            {hasYoutubePlayer && (
              <button
                type="button"
                onClick={() => onJumpToTimestamp(activeSlide.captureSeconds)}
                className="text-xs font-medium text-[#1E3A8A] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                시점 미리보기
              </button>
            )}
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">{activeSlide.captureGuideText}</p>
        </div>
      );
    }

    return null;
  };

  const hasVisualElement =
    matchedFrames.length > 0 || activeSlide.diagramPreset !== 'none' || hasCaptureGuide;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Rail: Slide Navigation + CRUD */}
      <aside className="xl:col-span-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#0F172A]">슬라이드 구성</h2>
            <span className="font-mono text-[11px] tabular-nums text-slate-500">
              총 {slides.length}장
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleAddSlide}
              title="새 슬라이드 추가"
              className="p-1.5 text-slate-600 hover:text-[#1E3A8A] hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDuplicateSlide}
              title="현재 슬라이드 복제"
              className="p-1.5 text-slate-600 hover:text-[#1E3A8A] hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => handleMoveSlide(-1)}
              title="위로 이동"
              className="p-1.5 text-slate-600 hover:text-[#1E3A8A] disabled:opacity-30 cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={activeIndex >= slides.length - 1}
              onClick={() => handleMoveSlide(1)}
              title="아래로 이동"
              className="p-1.5 text-slate-600 hover:text-[#1E3A8A] disabled:opacity-30 cursor-pointer"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={slides.length <= 1}
              onClick={handleDeleteSlide}
              title="현재 슬라이드 삭제"
              className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100 max-h-[780px] overflow-y-auto">
          {slides.map((s) => {
            const isActive = s.slideNumber === activeSlide.slideNumber;
            const frameHit = findMatchedFrames(s, capturedFrames).length > 0;
            return (
              <button
                key={s.slideNumber}
                type="button"
                onClick={() => {
                  setActiveSlideNum(s.slideNumber);
                  setRefineFeedback(null);
                }}
                className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                  isActive ? 'bg-[#EFF6FF]' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mb-1">
                  <span className="font-mono tabular-nums font-semibold text-[#1E3A8A]">
                    {String(s.slideNumber).padStart(2, '0')} · {s.slideType}
                  </span>
                  <span className={frameHit ? 'text-[#0F766E] font-semibold' : 'truncate max-w-[110px]'}>
                    {frameHit ? '영상캡처 연결' : s.section}
                  </span>
                </div>
                <p
                  className={`text-sm leading-snug line-clamp-2 ${isActive ? 'font-semibold text-[#0F172A]' : 'font-medium text-slate-800'}`}
                >
                  {s.titleKo}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Center & Right Workbench */}
      <div className="xl:col-span-9 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
            <span className="font-mono tabular-nums font-semibold text-[#0F172A]">
              {String(activeSlide.slideNumber).padStart(2, '0')} /{' '}
              {String(slides.length).padStart(2, '0')}
            </span>
            <span aria-hidden="true">·</span>
            <span>{activeSlide.section}</span>
            <span aria-hidden="true">·</span>
            <span>{LAYOUT_LABELS[activeSlide.slideType] || activeSlide.slideType}</span>
            <span aria-hidden="true">·</span>
            <span className={`font-semibold ${tierInfo.colorClass}`}>{tierInfo.label}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => {
                const prev = slides[activeIndex - 1];
                if (prev) setActiveSlideNum(prev.slideNumber);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              이전
            </button>
            <button
              type="button"
              disabled={activeIndex >= slides.length - 1}
              onClick={() => {
                const next = slides[activeIndex + 1];
                if (next) setActiveSlideNum(next.slideNumber);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              다음
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 16:9 Live Multi-Layout Slide Canvas */}
        <section className="rounded-xl border border-slate-300 bg-white overflow-hidden">
          {activeSlide.slideType === 'cover' || activeSlide.slideNumber === 1 ? (
            <div className="bg-[#1E3A8A] text-white p-8 md:p-12 min-h-[380px] flex flex-col justify-between">
              <div>
                <p className="font-mono text-xs tracking-wider text-blue-200 mb-3">
                  {courseName || 'AI응용기술'} · UNIVERSITY LECTURE DECK
                </p>
                <h3 className="text-2xl md:text-4xl font-bold leading-tight text-balance">
                  {activeSlide.titleKo}
                </h3>
                {activeSlide.titleEn && (
                  <p className="mt-2 text-base md:text-lg text-blue-100 font-medium">
                    {activeSlide.titleEn}
                  </p>
                )}
              </div>
              <ul className="mt-8 space-y-2 text-sm text-blue-50">
                {activeBullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span>•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="p-7 md:p-9 bg-white">
              <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200 text-xs text-slate-500">
                <span>
                  {courseName} · {activeSlide.section} ·{' '}
                  <strong className={tierInfo.colorClass}>{tierInfo.label}</strong>
                </span>
                <span className="font-mono tabular-nums text-[#1E3A8A] font-semibold">
                  {String(activeSlide.slideNumber).padStart(2, '0')} /{' '}
                  {String(slides.length).padStart(2, '0')}
                </span>
              </div>

              <div className="mt-5 mb-5">
                <h3 className="text-2xl font-bold text-[#0F172A] leading-snug text-balance">
                  {activeSlide.titleKo}
                </h3>
                {activeSlide.titleEn && (
                  <p className="mt-1 text-sm font-medium text-[#0284C7]">{activeSlide.titleEn}</p>
                )}
              </div>

              {/* Layout-Specific Canvas Renderers */}
              {activeSlide.slideType === 'comparison-table' &&
              activeSlide.comparisonTable?.headers?.length ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#1E3A8A] text-white">
                          {activeSlide.comparisonTable.headers.map((h, i) => (
                            <th key={i} className="py-2.5 px-3.5 font-semibold">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {(activeSlide.comparisonTable.rows ?? []).map((row, rIdx) => (
                          <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-[#F8FAFC]' : 'bg-white'}>
                            {(Array.isArray(row) ? row : []).map((cell, cIdx) => (
                              <td key={cIdx} className="py-2.5 px-3.5 text-slate-800">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {activeBullets.map((b, i) => (
                      <li key={i}>• {b}</li>
                    ))}
                  </ul>
                </div>
              ) : activeSlide.slideType === 'code-lab' && activeSlide.codeBlock?.code ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                  <div className="lg:col-span-7 rounded-lg bg-[#0F172A] p-4 text-slate-100 overflow-x-auto">
                    <p className="font-mono text-xs font-bold text-sky-400 mb-2">
                      {(activeSlide.codeBlock.language || 'python').toUpperCase()} 실습 코드
                    </p>
                    <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
                      {activeSlide.codeBlock.code}
                    </pre>
                  </div>
                  <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 space-y-3">
                    <ul className="space-y-2 text-sm text-slate-800">
                      {activeBullets.map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                    </ul>
                    {activeSlide.codeBlock.explanation && (
                      <p className="text-xs text-slate-600 pt-2 border-t border-slate-200 leading-relaxed">
                        {activeSlide.codeBlock.explanation}
                      </p>
                    )}
                  </div>
                </div>
              ) : (activeSlide.slideType === 'timeline' ||
                  activeSlide.slideType === 'process-steps') &&
                activeSlide.timelineSteps &&
                activeSlide.timelineSteps.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {activeSlide.timelineSteps.slice(0, 4).map((st, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3.5 space-y-1.5"
                      >
                        <p className="font-mono text-xs font-bold text-[#0F766E]">
                          {st.label || `STEP ${idx + 1}`}
                        </p>
                        <p className="text-sm font-bold text-[#0F172A]">{st.title}</p>
                        <p className="text-xs text-slate-600 leading-relaxed">{st.detail}</p>
                      </div>
                    ))}
                  </div>
                  {activeBullets.length > 0 && (
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {activeBullets.map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : activeSlide.slideType === 'quiz' && activeSlide.quizItem ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
                    <p className="text-base font-bold text-[#0F172A]">
                      Q. {activeSlide.quizItem.question}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-sm">
                    {(activeSlide.quizItem.options ?? []).map((opt, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg border px-3.5 py-2.5 ${
                          idx === activeSlide.quizItem?.answerIndex
                            ? 'border-[#0F766E] bg-emerald-50/70 font-semibold text-[#0F172A]'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        {idx + 1}) {opt}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3.5 text-xs text-slate-700">
                    <strong className="text-[#0F766E]">
                      정답 {(activeSlide.quizItem.answerIndex ?? 0) + 1}번 · 해설:{' '}
                    </strong>
                    {activeSlide.quizItem.explanation}
                  </div>
                </div>
              ) : activeSlide.slideType === 'multi-capture-compare' &&
                matchedFrames.length >= 2 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {matchedFrames.slice(0, 4).map((f) => (
                      <div
                        key={f.id}
                        className="rounded-lg border border-slate-200 bg-slate-900 overflow-hidden"
                      >
                        <img
                          src={f.imageDataUrl}
                          alt={f.visualSummary}
                          className="w-full h-40 object-contain"
                        />
                        <p className="bg-[#F8FAFC] px-2.5 py-1 text-[11px] text-slate-600">
                          {f.timestampFormatted} · {f.visualSummary}
                        </p>
                      </div>
                    ))}
                  </div>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {activeBullets.map((b, i) => (
                      <li key={i}>• {b}</li>
                    ))}
                  </ul>
                </div>
              ) : activeSlide.slideType === 'equation-focus' ||
                activeSlide.slideType === 'matrix-stepwise' ? (
                <div className="space-y-4">
                  {(activeSlide.equationLatex || activeSlide.matrixNote) && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-2">
                      {activeSlide.equationLatex && <MathBlock latex={activeSlide.equationLatex} />}
                      {activeSlide.matrixNote && (
                        <p className="font-mono text-xs tabular-nums text-[#1E3A8A] text-center">
                          차원 규격: {activeSlide.matrixNote}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-[#F8FAFC] p-4">
                      <ul className="space-y-2.5 text-sm text-slate-800 leading-relaxed">
                        {activeBullets.map((b, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="font-mono text-xs font-bold text-[#1E3A8A] mt-1">
                              0{idx + 1}
                            </span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-4 space-y-2 text-xs text-slate-700">
                      <p className="font-bold text-[#0F766E]">변수 및 차원 추적</p>
                      {activeSlide.equationVariables?.map((v, i) => (
                        <p key={i}>
                          <code className="font-mono font-bold text-[#1E3A8A]">{v.symbol}</code>:{' '}
                          {v.meaning}
                        </p>
                      ))}
                      {activeSlide.numericExample && (
                        <p className="pt-2 border-t border-slate-100 text-slate-600">
                          <strong>수치 예제:</strong> {activeSlide.numericExample}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Standard & Asymmetric 2-Column Layouts */
                <div
                  className={`grid grid-cols-1 ${hasVisualElement ? 'lg:grid-cols-12' : ''} gap-6 items-start`}
                >
                  {activeSlide.slideType === 'image-left-text' && hasVisualElement && (
                    <div className="lg:col-span-6">{renderVisualBox()}</div>
                  )}

                  <div
                    className={
                      !hasVisualElement
                        ? 'space-y-4'
                        : activeSlide.slideType === 'video-hero'
                          ? 'lg:col-span-5 space-y-4'
                          : 'lg:col-span-6 space-y-4'
                    }
                  >
                    {activeSlide.keyHighlight && activeSlide.slideType === 'key-concept' && (
                      <div className="rounded-lg bg-[#1E3A8A] text-white px-4 py-3 text-sm font-semibold">
                        {activeSlide.keyHighlight}
                      </div>
                    )}
                    <ul className="space-y-3 text-[15px] text-slate-800 leading-relaxed">
                      {activeBullets.map((b, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <span className="font-mono text-xs font-bold text-[#1E3A8A] mt-1.5">
                            0{idx + 1}
                          </span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>

                    {(activeSlide.equationLatex || activeSlide.matrixNote) && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-2">
                        {activeSlide.equationLatex && <MathBlock latex={activeSlide.equationLatex} />}
                        {activeSlide.matrixNote && (
                          <p className="font-mono text-xs tabular-nums text-[#1E3A8A]">
                            행렬 차원: {activeSlide.matrixNote}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {activeSlide.slideType !== 'image-left-text' && hasVisualElement && (
                    <div
                      className={
                        activeSlide.slideType === 'video-hero' ? 'lg:col-span-7' : 'lg:col-span-6'
                      }
                    >
                      {renderVisualBox()}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600">
                <div>
                  <span className="font-semibold text-[#0284C7]">영상 실제 근거: </span>
                  {activeSlide.videoBasedPoints || '해당 없음 (교과 연계 설명)'}
                </div>
                <div>
                  <span className="font-semibold text-[#4F46E5]">학부 보충 심화: </span>
                  {activeSlide.supplementaryPoints || '영상 내용 중심 구성'}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Professor Script & Slide Detailed Editor */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h4 className="text-base font-bold text-[#0F172A]">
                슬라이드 세부 편집 · 이미지 매칭 · 교수자 대본
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                변경 사항은 즉시 반영되며 PPTX·DOCX·PDF 내보내기 및 IndexedDB에 자동 저장됩니다.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isRegenerating}
                onClick={() => handleRegenerateSingle('design-only')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0F766E] bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LayoutTemplate className="w-3.5 h-3.5" />
                디자인/레이아웃만 개선
              </button>
              <button
                type="button"
                disabled={isRegenerating}
                onClick={() => handleRegenerateSingle('full')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1E3A8A] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                이 슬라이드만 AI 재생성
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">한국어 슬라이드 제목</span>
              <input
                type="text"
                value={activeSlide.titleKo}
                onChange={(e) => updateField('titleKo', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">영문 기술 용어 부제</span>
              <input
                type="text"
                value={activeSlide.titleEn}
                onChange={(e) => updateField('titleEn', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">슬라이드 레이아웃 (20종)</span>
              <select
                value={activeSlide.slideType}
                onChange={(e) => updateField('slideType', e.target.value as SlideLayoutType)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.entries(LAYOUT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">자체 생성 도식 (Diagram)</span>
              <select
                value={activeSlide.diagramPreset}
                onChange={(e) => updateField('diagramPreset', e.target.value as DiagramPreset)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                {Object.entries(DIAGRAM_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">출처 구분 (Source Tier)</span>
              <select
                value={activeSlide.sourceTier || 'B'}
                onChange={(e) => updateField('sourceTier', e.target.value as SourceTier)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                <option value="A">A — 영상에서 직접 확인된 내용</option>
                <option value="B">B — 영상 연계 학부 보충 설명</option>
                <option value="C">C — 전공 교육용 학술 추가</option>
              </select>
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">캡처 시점 (MM:SS) 및 재추출</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={activeSlide.captureTimestamp}
                  onChange={(e) => {
                    updateField('captureTimestamp', e.target.value);
                    updateField('captureSeconds', parseMmSs(e.target.value));
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono tabular-nums text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
                />
                {mp4File && (
                  <button
                    type="button"
                    disabled={isRecapturing}
                    onClick={handleRecaptureForSlide}
                    className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-white bg-[#0F766E] rounded-lg hover:bg-[#0D9488] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {isRecapturing ? '추출중' : '시점 캡처'}
                  </button>
                )}
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">LaTeX 수식 ($ 제외)</span>
              <input
                type="text"
                value={activeSlide.equationLatex}
                onChange={(e) => updateField('equationLatex', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">행렬 차원 표기</span>
              <input
                type="text"
                value={activeSlide.matrixNote}
                onChange={(e) => updateField('matrixNote', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">연결된 실제 영상 프레임 선택</span>
              <select
                value={activeSlide.capturedFrameIds?.[0] || ''}
                onChange={(e) =>
                  updateField('capturedFrameIds', e.target.value ? [e.target.value] : [])
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#1E3A8A]"
              >
                <option value="">자동 시점 매칭 또는 도식 사용</option>
                {allFrames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.timestampFormatted} — {f.visualSummary.slice(0, 32)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeSlide.slideType === 'code-lab' && (
            <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <ImageIcon className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>실습 코드 블록 편집 ({activeSlide.codeBlock?.language || 'python'})</span>
              </div>
              <textarea
                rows={5}
                value={activeSlide.codeBlock?.code || ''}
                onChange={(e) =>
                  updateField('codeBlock', {
                    language: activeSlide.codeBlock?.language || 'python',
                    code: e.target.value,
                    explanation: activeSlide.codeBlock?.explanation || '',
                  })
                }
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-[#0F172A]"
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">슬라이드 본문 항목</span>
              <button
                type="button"
                onClick={handleAddBullet}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A8A] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                항목 추가
              </button>
            </div>
            <div className="space-y-2">
              {activeBullets.map((bullet, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-400 w-5">{idx + 1}.</span>
                  <input
                    type="text"
                    value={bullet}
                    onChange={(e) => handleBulletChange(idx, e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveBullet(idx)}
                    aria-label="항목 삭제"
                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              교수자 강의 스크립트 (PowerPoint Speaker Notes &amp; DOCX 수록)
            </span>
            <textarea
              rows={5}
              value={activeSlide.speakerScript}
              onChange={(e) => updateField('speakerScript', e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#0F172A] leading-relaxed focus:outline-none focus:border-[#1E3A8A]"
            />
          </label>

          {/* AI Slide Refinement Bar */}
          <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <input
              type="text"
              value={refinePrompt}
              onChange={(e) => setRefinePrompt(e.target.value)}
              placeholder="예: Softmax 스케일링 이유를 분산(Variance) 관점에서 2문장 더 쉽게 보완해줘"
              className="flex-1 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3.5 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-[#1E3A8A]"
            />
            <button
              type="button"
              disabled={isRefining || !refinePrompt.trim()}
              onClick={handleAiRefine}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] rounded-lg hover:bg-[#1E40AF] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isRefining ? '보완 반영 중...' : 'AI로 슬라이드 다듬기'}
            </button>
          </div>
          {refineFeedback && (
            <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
              <Check className="w-3.5 h-3.5" />
              {refineFeedback}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
