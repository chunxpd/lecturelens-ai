import { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Camera,
  Captions,
  GitBranch,
  Monitor,
  Play,
  Volume2,
} from 'lucide-react';
import type { CapturedFrame, SceneAnalysis, VideoStoryline } from '../types/lecture';

interface SceneTimelineViewProps {
  scenes: SceneAnalysis[];
  storyline?: VideoStoryline;
  capturedFrames: Record<string, CapturedFrame>;
  hasYoutubePlayer: boolean;
  onJumpToTimestamp: (seconds: number) => void;
}

function findClosestFrame(
  scene: SceneAnalysis,
  capturedFrames: Record<string, CapturedFrame>,
): CapturedFrame | null {
  const frames = Object.values(capturedFrames);
  if (frames.length === 0) return null;
  const sorted = [...frames]
    .map((f) => ({ f, diff: Math.abs(f.timestampSeconds - scene.captureSeconds) }))
    .sort((a, b) => a.diff - b.diff);
  return sorted[0] && sorted[0].diff <= 15 ? sorted[0].f : null;
}

const PRIORITY_LABEL: Record<SceneAnalysis['capturePriority'], { text: string; cls: string }> = {
  high: { text: '캡처 우선순위: 높음(수식/도식/코드)', cls: 'text-[#0F766E] font-semibold' },
  medium: { text: '캡처 우선순위: 보통', cls: 'text-[#1E3A8A]' },
  low: { text: '캡처 우선순위: 참고', cls: 'text-slate-500' },
};

export function SceneTimelineView({
  scenes,
  storyline,
  capturedFrames,
  hasYoutubePlayer,
  onJumpToTimestamp,
}: SceneTimelineViewProps) {
  const [selectedId, setSelectedId] = useState<string>(scenes[0]?.id ?? '');
  const activeScene = scenes.find((s) => s.id === selectedId) ?? scenes[0];

  if (!activeScene) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        분석된 장면 데이터가 아직 없습니다.
      </div>
    );
  }

  const matchedFrame = findClosestFrame(activeScene, capturedFrames);
  const rawPriority = String(activeScene.capturePriority || 'medium').trim().toLowerCase();
  const normalizedPriority: SceneAnalysis['capturePriority'] =
    rawPriority === 'high' || rawPriority.includes('높')
      ? 'high'
      : rawPriority === 'low' || rawPriority.includes('낮') || rawPriority.includes('참고')
        ? 'low'
        : 'medium';
  const priorityMeta = PRIORITY_LABEL[normalizedPriority] ?? PRIORITY_LABEL.medium;

  return (
    <div className="space-y-6">
      {storyline && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
              <GitBranch className="w-4 h-4 text-[#1E3A8A]" />
              <span>전체 영상 스토리라인 및 교육적 재구성 흐름</span>
            </div>
            <span className="text-xs font-mono text-[#0F766E]">
              성격:{' '}
              {storyline.domainType === 'theory-heavy'
                ? '이론·수식 중심'
                : storyline.domainType === 'practice-heavy'
                  ? '실습·구현 중심'
                  : '이론 + 응용 균형'}
            </span>
          </div>
          <p className="text-sm font-semibold text-[#1E3A8A] leading-relaxed">
            핵심 메시지: {storyline.coreMessage}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3">
              <p className="font-bold text-slate-700 mb-1">도입부 (Intro)</p>
              <p className="text-slate-600 leading-relaxed">{storyline.introSummary}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3">
              <p className="font-bold text-slate-700 mb-1">핵심 전개 (Body)</p>
              <p className="text-slate-600 leading-relaxed">{storyline.bodySummary}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-3">
              <p className="font-bold text-slate-700 mb-1">결론 및 시사점 (Conclusion)</p>
              <p className="text-slate-600 leading-relaxed">{storyline.conclusionSummary}</p>
            </div>
          </div>
          {storyline.pedagogicalReorderNote && (
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-800">강의 재구성 방향: </strong>
              {storyline.pedagogicalReorderNote}
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <aside className="lg:col-span-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#0F172A]">시간순 장면 목차</h2>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              총 {scenes.length}개 구간
            </span>
          </div>

          <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
            {scenes.map((scene) => {
              const isSelected = scene.id === activeScene.id;
              const hasReal = Boolean(findClosestFrame(scene, capturedFrames));
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => setSelectedId(scene.id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#EFF6FF] text-[#0F172A]'
                      : 'bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                    <span className="font-mono tabular-nums font-medium text-[#1E3A8A]">
                      {String(scene.sceneNumber).padStart(2, '0')} · {scene.startTime} – {scene.endTime}
                    </span>
                    <span
                      className={`font-mono tabular-nums ${hasReal ? 'text-[#0F766E] font-semibold' : 'text-slate-500'}`}
                    >
                      {hasReal ? `프레임 확보 · ${scene.captureTimestamp}` : `캡처 ${scene.captureTimestamp}`}
                    </span>
                  </div>
                  <p
                    className={`text-sm leading-snug ${isSelected ? 'font-semibold text-[#0F172A]' : 'font-medium text-slate-800'}`}
                  >
                    {scene.title}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="lg:col-span-8 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1.5">
                  <span className="font-mono tabular-nums font-semibold text-[#1E3A8A]">
                    장면 {String(activeScene.sceneNumber).padStart(2, '0')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {activeScene.startTime} – {activeScene.endTime}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#0284C7]">
                    캡처 {activeScene.captureTimestamp}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={priorityMeta.cls}>{priorityMeta.text}</span>
                </div>
                <h3 className="text-xl font-bold text-[#0F172A] tracking-tight">
                  {activeScene.title}
                </h3>
              </div>

              {hasYoutubePlayer && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onJumpToTimestamp(activeScene.startSeconds)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    구간 시작 ({activeScene.startTime})
                  </button>
                  <button
                    type="button"
                    onClick={() => onJumpToTimestamp(activeScene.captureSeconds)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#1E3A8A] rounded-lg hover:bg-[#1E40AF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    캡처 시점 이동 ({activeScene.captureTimestamp})
                  </button>
                </div>
              )}
            </div>

            {matchedFrame && (
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-900 overflow-hidden">
                <img
                  src={matchedFrame.imageDataUrl}
                  alt={activeScene.title}
                  className="w-full max-h-[340px] object-contain mx-auto"
                />
                <div className="bg-[#F8FAFC] border-t border-slate-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>실제 영상 추출 화면 · {matchedFrame.sourceLabel}</span>
                  <span className="font-mono tabular-nums">
                    {matchedFrame.width}×{matchedFrame.height} · 선명도 {matchedFrame.sharpnessScore}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-2">
                  <Monitor className="w-4 h-4 text-[#0284C7]" />
                  <span>실제 화면 구성 (Screen Composition)</span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {activeScene.screenComposition}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-2">
                  <Volume2 className="w-4 h-4 text-[#1E3A8A]" />
                  <span>음성 설명 핵심 내용 (Audio Summary)</span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {activeScene.audioCoreSummary}
                </p>
              </div>
            </div>

            {activeScene.onScreenTextAndSubtitles && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-1.5">
                  <Captions className="w-4 h-4 text-[#0F766E]" />
                  <span>화면 내 자막 및 텍스트 (On-Screen Text &amp; Subtitles)</span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {activeScene.onScreenTextAndSubtitles}
                </p>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <h4 className="text-xs font-semibold text-slate-700 mb-2">
                등장하는 그림 · 도식 · 수식 · 코드 (Visual Diagrams &amp; Equations)
              </h4>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {activeScene.visualDiagramsAndEquations}
              </p>
            </div>

            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 mb-1">
                  <Camera className="w-4 h-4 text-amber-700" />
                  <span>강의자료 핵심 화면 캡처 가이드 · 시점 {activeScene.captureTimestamp}</span>
                </div>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {activeScene.captureGuide}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
              <h4 className="text-sm font-bold text-[#0F172A]">
                사실 검증 경계: 영상 실제 설명 vs. 대학생 보충 설명
              </h4>
              <span className="text-xs text-slate-500">추측 배제 원칙 적용</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0284C7] mb-2.5">
                  <Monitor className="w-3.5 h-3.5" />
                  <span>영상 실제 설명 (출처 A · Observed in Video)</span>
                </div>
                <ul className="space-y-2 text-sm text-slate-800 leading-relaxed">
                  {(activeScene.observedInVideo ?? []).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-mono text-xs text-[#0284C7] mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#4F46E5] mb-2.5">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>학부생 이해 보충 설명 (출처 B/C · Supplementary)</span>
                </div>
                <ul className="space-y-2 text-sm text-slate-800 leading-relaxed">
                  {(activeScene.supplementaryForStudents ?? []).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-mono text-xs text-[#4F46E5] mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-[#F8FAFC] p-3.5 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-800">미확인 · 모호 영역 기록: </span>
                {activeScene.unverifiedOrAmbiguous}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
