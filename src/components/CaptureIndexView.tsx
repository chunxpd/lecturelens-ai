import { useState } from 'react';
import { Camera, Play, RefreshCw } from 'lucide-react';
import type { CapturedFrame, LectureAnalysisResult } from '../types/lecture';
import { extractSingleFrameClientSide } from '../utils/videoFrameExtractor';

interface CaptureIndexViewProps {
  analysis: LectureAnalysisResult;
  capturedFrames: Record<string, CapturedFrame>;
  mp4File: File | null;
  hasYoutubePlayer: boolean;
  onJumpToTimestamp: (seconds: number) => void;
  onUpdateFrame: (frame: CapturedFrame) => void;
}

function findMatchedFrame(
  captureSeconds: number,
  capturedFrames: Record<string, CapturedFrame>,
): CapturedFrame | null {
  const frames = Object.values(capturedFrames);
  if (frames.length === 0) return null;
  const sorted = [...frames]
    .map((f) => ({ f, diff: Math.abs(f.timestampSeconds - captureSeconds) }))
    .sort((a, b) => a.diff - b.diff);
  return sorted[0] && sorted[0].diff <= 15 ? sorted[0].f : null;
}

export function CaptureIndexView({
  analysis,
  capturedFrames,
  mp4File,
  hasYoutubePlayer,
  onJumpToTimestamp,
  onUpdateFrame,
}: CaptureIndexViewProps) {
  const [busySceneId, setBusySceneId] = useState<string | null>(null);

  const captureRows = analysis.scenes.map((scene) => {
    const linkedSlides = analysis.slides.filter(
      (s) =>
        s.captureTimestamp &&
        s.captureTimestamp !== '해당 없음' &&
        Math.abs(s.captureSeconds - scene.captureSeconds) <= 8,
    );
    const frame = findMatchedFrame(scene.captureSeconds, capturedFrames);
    return {
      scene,
      linkedSlides,
      frame,
    };
  });

  const handleAdjustSceneFrame = async (
    sceneId: string,
    existingFrame: CapturedFrame | null,
    targetSeconds: number,
    summary: string,
  ) => {
    if (!mp4File || busySceneId) return;
    setBusySceneId(sceneId);
    try {
      const updated = await extractSingleFrameClientSide(
        mp4File,
        Math.max(0.2, targetSeconds),
        analysis.videoMeta.title || mp4File.name,
        summary,
      );
      if (updated) {
        onUpdateFrame({
          ...updated,
          id: existingFrame?.id || updated.id,
        });
      }
    } finally {
      setBusySceneId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#0F172A]">
            강의자료 핵심 화면 캡처 인덱스 (Extracted Frames &amp; Timestamps)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            영상에서 실제 도식·수식·코드·강조 설명이 드러나는 시점, 추출된 실제 이미지 및 매칭 슬라이드 번호입니다.
          </p>
        </div>
        <span className="font-mono text-xs tabular-nums text-slate-600">
          캡처 포인트 {captureRows.length}개 · 실제 확보 {Object.keys(capturedFrames).length}장
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th className="py-3 px-4 w-48">추출 프레임 미리보기</th>
              <th className="py-3 px-4 w-28">캡처 시점</th>
              <th className="py-3 px-4 w-52">장면 및 구간</th>
              <th className="py-3 px-4">화면 포착 대상 및 캡처 가이드</th>
              <th className="py-3 px-4 w-36">활용 슬라이드</th>
              <th className="py-3 px-4 w-40 text-right">시점 이동 / 재추출</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {captureRows.map(({ scene, linkedSlides, frame }) => {
              const isBusy = busySceneId === scene.id;
              return (
                <tr key={scene.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 px-4 align-top">
                    {frame ? (
                      <div className="space-y-1">
                        <div className="w-40 aspect-video rounded border border-slate-200 bg-slate-900 overflow-hidden">
                          <img
                            src={frame.imageDataUrl}
                            alt={scene.title}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <p className="font-mono text-[10px] tabular-nums text-[#0F766E]">
                          {frame.timestampFormatted} · {frame.width}×{frame.height}
                        </p>
                      </div>
                    ) : (
                      <div className="w-40 aspect-video rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center p-2 text-center text-[11px] text-slate-400">
                        YouTube 자동 캡처 / MP4 연결 대기
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4 align-top">
                    <div className="inline-flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums text-[#1E3A8A]">
                      <Camera className="w-3.5 h-3.5 text-amber-600" />
                      <span>{scene.captureTimestamp}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 align-top">
                    <p className="font-semibold text-[#0F172A] leading-snug">{scene.title}</p>
                    <p className="font-mono text-xs tabular-nums text-slate-500 mt-1">
                      {scene.startTime} – {scene.endTime}
                    </p>
                  </td>
                  <td className="py-3.5 px-4 align-top space-y-1.5">
                    <p className="text-slate-800 leading-relaxed">{scene.captureGuide}</p>
                    <p className="text-xs text-slate-500">
                      화면 도식/수식: {scene.visualDiagramsAndEquations}
                    </p>
                  </td>
                  <td className="py-3.5 px-4 align-top">
                    {linkedSlides.length > 0 ? (
                      <span className="font-mono text-xs tabular-nums text-[#0284C7] font-semibold">
                        {linkedSlides
                          .map((ls) => `Slide ${String(ls.slideNumber).padStart(2, '0')}`)
                          .join(', ')}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">장면 참고용</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 align-top text-right space-y-1.5">
                    {hasYoutubePlayer && (
                      <button
                        type="button"
                        onClick={() => onJumpToTimestamp(scene.captureSeconds)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#1E3A8A] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        재생 이동
                      </button>
                    )}
                    {mp4File && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleAdjustSceneFrame(
                              scene.id,
                              frame,
                              (frame?.timestampSeconds ?? scene.captureSeconds) - 1,
                              scene.title,
                            )
                          }
                          className="px-2 py-1 text-[11px] font-mono bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                        >
                          -1s
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleAdjustSceneFrame(
                              scene.id,
                              frame,
                              (frame?.timestampSeconds ?? scene.captureSeconds) + 1,
                              scene.title,
                            )
                          }
                          className="px-2 py-1 text-[11px] font-mono bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                        >
                          +1s
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleAdjustSceneFrame(
                              scene.id,
                              frame,
                              scene.captureSeconds,
                              scene.title,
                            )
                          }
                          aria-label="재추출"
                          className="p-1 text-slate-500 hover:text-[#0F766E] cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
