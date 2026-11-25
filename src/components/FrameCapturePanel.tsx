import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  Film,
  Info,
  Loader2,
  Monitor,
  MonitorOff,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { CapturedFrame, LectureAnalysisResult } from '../types/lecture';
import {
  extractFramesClientSide,
  extractSingleFrameClientSide,
  type FrameExtractionTarget,
} from '../utils/videoFrameExtractor';
import {
  captureYoutubeTargetsFromSession,
  checkDisplayCaptureSupport,
  startTabCaptureSession,
  type ActiveTabCaptureSession,
  type CaptureTargetItem,
  type TabCaptureProgress,
  type YouTubePlayerLike,
} from '../utils/youtubeTabCapture';
import type { CaptureOverlayStatus } from './YoutubePlayerStage';

export interface VisionVerificationResultItem {
  slideNumber: number;
  matched: boolean;
  status: 'verified' | 'needs-review';
  observedVisual: string;
  reason: string;
}

export interface FrameVisionInsightItem {
  id: string;
  observedVisual: string;
  detectedText: string;
  visionTags: string[];
  visionProvider?: 'gemini' | 'hybrid';
}

interface FrameCapturePanelProps {
  aiProvider: 'gemini' | 'hybrid';
  analysis: LectureAnalysisResult | null;
  capturedFrames: Record<string, CapturedFrame>;
  mp4File: File | null;
  youtubeVideoId: string | null;
  youtubePlayer: YouTubePlayerLike | null;
  playerContainerEl: HTMLDivElement | null;
  onMp4FileSelected: (file: File) => void;
  onFramesExtracted: (frames: CapturedFrame[]) => void;
  onUpdateFrame: (frame: CapturedFrame) => void;
  onDeleteFrame: (frameId: string) => void;
  onApplyInspectedFrames?: (insights: FrameVisionInsightItem[]) => void;
  onApplyVisionResults?: (results: VisionVerificationResultItem[]) => void;
  onDedupeFrames?: () => number;
  onSetCaptureExpanded?: (expanded: boolean) => void;
  onCaptureOverlayUpdate?: (info: CaptureOverlayStatus | null) => void;
  onRegisterCancelCapture?: (cancelFn: (() => void) | null) => void;
  onTriggerPptxExport?: (frames: CapturedFrame[]) => Promise<void>;
}

function parseMmSsToSeconds(mmss: string): number {
  const parts = mmss
    .trim()
    .split(':')
    .map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return Math.max(0, Number(mmss) || 0);
}

export function FrameCapturePanel({
  aiProvider,
  analysis,
  capturedFrames,
  mp4File,
  youtubeVideoId,
  youtubePlayer,
  playerContainerEl,
  onMp4FileSelected,
  onFramesExtracted,
  onUpdateFrame,
  onDeleteFrame,
  onApplyInspectedFrames,
  onApplyVisionResults,
  onDedupeFrames,
  onSetCaptureExpanded,
  onCaptureOverlayUpdate,
  onRegisterCancelCapture,
  onTriggerPptxExport,
}: FrameCapturePanelProps) {
  const [isExtractingMp4, setIsExtractingMp4] = useState(false);
  const [isTabCapturing, setIsTabCapturing] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isVerifyingVision, setIsVerifyingVision] = useState(false);
  const [autoDownloadAfterFull, setAutoDownloadAfterFull] = useState(true);
  const [tabProgress, setTabProgress] = useState<TabCaptureProgress | null>(null);
  const [extractProgress, setExtractProgress] = useState('');
  const [extractError, setExtractError] = useState<string | null>(null);
  const [recapturingId, setRecapturingId] = useState<string | null>(null);
  const [customTimeMap, setCustomTimeMap] = useState<Record<string, string>>({});
  const [copiedUrl, setCopiedUrl] = useState(false);

  const mp4InputRef = useRef<HTMLInputElement | null>(null);
  const manualImgInputRef = useRef<HTMLInputElement | null>(null);
  const manualTargetFrameRef = useRef<string | null>(null);
  const tabSessionRef = useRef<ActiveTabCaptureSession | null>(null);
  const captureAbortRef = useRef<AbortController | null>(null);

  const supportInfo = useMemo(() => checkDisplayCaptureSupport(), []);

  useEffect(() => {
    return () => {
      captureAbortRef.current?.abort();
      tabSessionRef.current?.stop();
      tabSessionRef.current = null;
      onSetCaptureExpanded?.(false);
      onCaptureOverlayUpdate?.(null);
      onRegisterCancelCapture?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameList = Object.values(capturedFrames).sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds,
  );

  const maxCaptureResolution = useMemo(() => {
    if (frameList.length === 0) return null;
    return frameList.reduce(
      (best, f) => (f.width * f.height > best.width * best.height ? { width: f.width, height: f.height } : best),
      { width: frameList[0].width, height: frameList[0].height },
    );
  }, [frameList]);

  const inspectFramesWithVision = async (framesToInspect: CapturedFrame[]): Promise<FrameVisionInsightItem[]> => {
    const uninspected = framesToInspect.filter((f) => !f.visionObservedText || f.visionProvider !== aiProvider);
    if (uninspected.length === 0) return [];

    const allInsights: FrameVisionInsightItem[] = [];
    for (let i = 0; i < uninspected.length; i += 8) {
      const batch = uninspected.slice(i, i + 8);
      setExtractProgress(
        `${aiProvider === 'hybrid' ? 'OpenAI Vision' : 'Gemini Vision'}으로 캡처 이미지 실제 내용 판독 및 슬라이드 자동 매칭 중 (${Math.min(i + 8, uninspected.length)}/${uninspected.length})...`,
      );
      const res = await fetch('/api/inspect-captured-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiProvider,
          frames: batch.map((f) => ({
            id: f.id,
            imageHash: f.imageHash,
            timestampFormatted: f.timestampFormatted,
            visualSummary: f.visualSummary,
            imageDataUrl: f.imageDataUrl,
          })),
        }),
      });
      const data = (await res.json()) as {
        results?: FrameVisionInsightItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || '이미지 판독 API 요청 실패');
      if (Array.isArray(data.results)) {
        allInsights.push(...data.results.map((item) => ({ ...item, visionProvider: aiProvider })));
      }
    }

    if (allInsights.length > 0) {
      onApplyInspectedFrames?.(allInsights);
    }
    return allInsights;
  };

  const buildTargetsFromAnalysis = (maxCount?: number): CaptureTargetItem[] => {
    if (!analysis) return [];
    const seen = new Set<number>();
    const targets: (CaptureTargetItem & { priorityRank: number })[] = [];

    // In video-faithful decks, capture the actual slide anchors first and only.
    // Preview mode still uses detected scenes since it has no slides yet.
    const sceneTargets = analysis.videoMeta.contentMode === 'video-faithful' && analysis.slides.length > 0
      ? [] : analysis.scenes;
    for (const s of sceneTargets) {
      const sec = Math.max(1, Math.round(s.captureSeconds || s.startSeconds || 1));
      if (!Array.from(seen).some((x) => Math.abs(x - sec) <= 2)) {
        seen.add(sec);
        const prio = String(s.capturePriority || 'medium').toLowerCase();
        const priorityRank = prio === 'high' ? 0 : prio === 'medium' ? 1 : 2;
        targets.push({
          timestampSeconds: sec,
          label: s.title,
          keywords: `${s.visualDiagramsAndEquations} ${s.screenComposition}`,
          priorityRank,
        });
      }
    }
    for (const sl of analysis.slides) {
      if (!sl.captureTimestamp || sl.captureTimestamp === '해당 없음') continue;
      const sec = Math.max(1, Math.round(sl.captureSeconds || 1));
      if (!Array.from(seen).some((x) => Math.abs(x - sec) <= 2)) {
        seen.add(sec);
        targets.push({
          timestampSeconds: sec,
          label: sl.titleKo,
          keywords: sl.captureGuideText,
          priorityRank: 1,
        });
      }
    }

    if (typeof maxCount === 'number' && maxCount > 0 && targets.length > maxCount) {
      // For 3-scene verification, pick highest-priority scenes in chronological order
      const prioritized = [...targets]
        .sort((a, b) => a.priorityRank - b.priorityRank || a.timestampSeconds - b.timestampSeconds)
        .slice(0, maxCount)
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
      return prioritized.map(({ timestampSeconds, label, keywords }) => ({
        timestampSeconds,
        label,
        keywords,
      }));
    }

    if (analysis.videoMeta.contentMode === 'video-faithful') targets.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    return targets.slice(0, 32).map(({ timestampSeconds, label, keywords }) => ({
      timestampSeconds,
      label,
      keywords,
    }));
  };

  const handleStartScreenShare = async (): Promise<ActiveTabCaptureSession | null> => {
    setExtractError(null);
    if (tabSessionRef.current) {
      return tabSessionRef.current;
    }
    try {
      const session = await startTabCaptureSession(playerContainerEl, () => {
        tabSessionRef.current = null;
        setIsScreenSharing(false);
      });
      tabSessionRef.current = session;
      setIsScreenSharing(true);
      setExtractProgress(
        session.isCroppedByRegionApi
          ? '현재 탭 화면 공유 연결 완료 (Region Capture로 YouTube 영상 영역만 정확히 분리됨)'
          : '화면 공유 연결 완료 (YouTube 플레이어 좌표 기준 자동 크롭 준비됨)',
      );
      return session;
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : '화면 공유를 시작할 수 없습니다.');
      return null;
    }
  };

  const handleStopScreenShare = () => {
    captureAbortRef.current?.abort();
    tabSessionRef.current?.stop();
    tabSessionRef.current = null;
    setIsScreenSharing(false);
    setIsTabCapturing(false);
  };

  const handleAutoCaptureYoutubeTab = async (maxTargets?: number) => {
    if (isTabCapturing) return;
    if (!analysis || analysis.scenes.length === 0) {
      setExtractError('먼저 유튜브 영상 분석을 실행해 캡처할 장면 시점을 확보해주세요.');
      return;
    }
    if (!youtubeVideoId || !youtubePlayer || !playerContainerEl) {
      setExtractError(
        'YouTube 플레이어가 아직 준비되지 않았습니다. 유효한 YouTube URL을 입력한 뒤 잠시 후 다시 시도해주세요.',
      );
      return;
    }

    const targets = buildTargetsFromAnalysis(maxTargets);
    if (targets.length === 0) {
      setExtractError('캡처 대상 타임스탬프가 없습니다.');
      return;
    }

    setExtractError(null);

    // Must request getDisplayMedia synchronously inside user click if session is not active
    let session = tabSessionRef.current;
    const createdSessionHere = !session;
    if (!session) {
      session = await handleStartScreenShare();
      if (!session) return;
    }

    const controller = new AbortController();
    captureAbortRef.current = controller;
    onRegisterCancelCapture?.(() => controller.abort());
    setIsTabCapturing(true);
    const initialProgress: TabCaptureProgress = {
      total: targets.length,
      processed: 0,
      successCount: 0,
      failedCount: 0,
      currentTimestamp: '00:00',
      progressPercent: 0,
      statusMessage: '고해상도 캡처 스테이지를 확대하고 YouTube 자동 캡처를 준비 중입니다...',
    };
    setTabProgress(initialProgress);
    onCaptureOverlayUpdate?.(initialProgress);

    const newlyCaptured: CapturedFrame[] = [];
    try {
      const { captured, failedCount, reusedCount, duplicateSkippedCount } =
        await captureYoutubeTargetsFromSession({
          session,
          player: youtubePlayer,
          playerContainer: playerContainerEl,
          youtubeVideoId,
          videoTitle: analysis.videoMeta.title || 'YouTube 강의',
          targets,
          existingFrames: frameList,
          signal: controller.signal,
          onExpandStage: (expanded) => onSetCaptureExpanded?.(expanded),
          onProgress: (p) => {
            setTabProgress(p);
            onCaptureOverlayUpdate?.(p);
          },
          onFrameCaptured: (frame) => {
            newlyCaptured.push(frame);
            onUpdateFrame(frame);
          },
        });

      if (newlyCaptured.length > 0) {
        onFramesExtracted(newlyCaptured);
      }

      // Build the export input from the results of this capture run, not React state
      // captured by the click handler. Include cached/reused frames and Vision results.
      const finalFrames = new Map(
        frameList.filter((frame) =>
          frame.sourceType !== 'youtube-tab-capture' ||
          (frame.captureQualityVersion === 2 &&
            (frame.sourceUrl?.includes(youtubeVideoId) || frame.id.includes(youtubeVideoId))),
        ).map((frame) => [frame.id, frame]),
      );
      for (const frame of [...captured, ...newlyCaptured]) finalFrames.set(frame.id, frame);
      let visionCompleted = false;
      if (!controller.signal.aborted) {
        try {
          const insights = await inspectFramesWithVision([...finalFrames.values()]);
          for (const insight of insights) {
            const frame = finalFrames.get(insight.id);
            if (!frame) continue;
            finalFrames.set(insight.id, {
              ...frame,
              visionObservedText: `${insight.observedVisual} ${insight.detectedText}`.trim(),
              visionTags: insight.visionTags,
              visionProvider: aiProvider,
            });
          }
          visionCompleted = [...finalFrames.values()].every((frame) => frame.visionProvider === aiProvider && Boolean(frame.visionObservedText));
        } catch {
          // Non-fatal: export can still use the actual captured frames.
          setExtractProgress('Vision 판독 일부 실패: 영상 이미지와 시점을 기준으로 매칭합니다.');
        }
      }

      const finalMsg = controller.signal.aborted
        ? `캡처가 중단되었습니다 (신규 확보: ${captured.length}장).`
        : `자동 캡처 완료 — 신규 ${captured.length}장 · 캐시재사용 ${reusedCount}장 · 중복제외 ${duplicateSkippedCount}건 · 기타제외 ${Math.max(0, failedCount - duplicateSkippedCount)}건. ${visionCompleted ? 'Vision 판독 완료.' : 'Vision 판독 미완료 — 이미지 검토 필요.'}`;

      setTabProgress({
        total: targets.length,
        processed: targets.length,
        successCount: captured.length + reusedCount,
        failedCount,
        currentTimestamp: captured[captured.length - 1]?.timestampFormatted || '완료',
        progressPercent: Math.round(((captured.length + reusedCount) / Math.max(1, targets.length)) * 100),
        statusMessage: finalMsg,
      });

      if (
        !controller.signal.aborted &&
        !maxTargets &&
        autoDownloadAfterFull &&
        (aiProvider !== 'hybrid' || visionCompleted) &&
        (newlyCaptured.length > 0 || reusedCount > 0)
      ) {
        // Explicit, fully resolved snapshot: no timeout or stale capturedFrames closure.
        await onTriggerPptxExport?.([...finalFrames.values()]);
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'YouTube 탭 자동 캡처 중 오류가 발생했습니다.');
    } finally {
      onSetCaptureExpanded?.(false);
      onCaptureOverlayUpdate?.(null);
      onRegisterCancelCapture?.(null);
      setIsTabCapturing(false);
      captureAbortRef.current = null;
      if (createdSessionHere || tabSessionRef.current) {
        tabSessionRef.current?.stop();
        tabSessionRef.current = null;
        setIsScreenSharing(false);
      }
    }
  };

  const handleVerifyMatchedFramesWithGemini = async () => {
    if (!analysis || isVerifyingVision || frameList.length === 0) return;
    setIsVerifyingVision(true);
    setExtractError(null);
    try {
      await inspectFramesWithVision(frameList);

      const itemsToVerify: Array<{
        slideNumber: number;
        titleKo: string;
        titleEn: string;
        summary: string;
        captureTimestamp: string;
        imageDataUrl: string;
      }> = [];

      for (const sl of analysis.slides) {
        const fid = sl.capturedFrameIds?.[0];
        const frame = fid ? capturedFrames[fid] : undefined;
        if (!frame) continue;
        itemsToVerify.push({
          slideNumber: sl.slideNumber,
          titleKo: sl.titleKo,
          titleEn: sl.titleEn,
          summary: `${sl.videoBasedPoints || ''} ${(sl.bullets ?? []).slice(0, 2).join(' ')}`.trim(),
          captureTimestamp: frame.timestampFormatted,
          imageDataUrl: frame.imageDataUrl,
        });
      }

      if (itemsToVerify.length === 0) {
        setExtractProgress('캡처 이미지 내용 판독 및 슬라이드 재매칭을 완료했습니다.');
        return;
      }

      const allResults: VisionVerificationResultItem[] = [];
      for (let i = 0; i < itemsToVerify.length; i += 8) {
        const batch = itemsToVerify.slice(i, i + 8);
        setExtractProgress(
          `${aiProvider === 'hybrid' ? 'OpenAI Vision' : 'Gemini Vision'}으로 슬라이드-이미지 정합성 검증 중 (${Math.min(i + 8, itemsToVerify.length)}/${itemsToVerify.length})...`,
        );
        const res = await fetch('/api/verify-slide-frames', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiProvider, items: batch }),
        });
        const data = (await res.json()) as {
          results?: VisionVerificationResultItem[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || '이미지 정합성 검증 요청에 실패했습니다.');
        }
        if (Array.isArray(data.results)) {
          allResults.push(...data.results);
        }
      }

      onApplyVisionResults?.(allResults);
      const verifiedCount = allResults.filter((r) => r.status === 'verified').length;
      const reviewCount = allResults.length - verifiedCount;
      setExtractProgress(
        `AI 이미지-슬라이드 판독·검증 완료 — 일치 확인 ${verifiedCount}장 · 검토/재캡처 권장 ${reviewCount}장`,
      );
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : '이미지 정합성 검증 중 오류가 발생했습니다.');
    } finally {
      setIsVerifyingVision(false);
    }
  };

  const handleRecaptureSingleYoutube = async (frame: CapturedFrame, targetSec: number) => {
    if (!youtubeVideoId || !youtubePlayer || !playerContainerEl || isTabCapturing) return;
    setRecapturingId(frame.id);
    setExtractError(null);

    let session = tabSessionRef.current;
    const createdHere = !session;
    if (!session) {
      session = await handleStartScreenShare();
      if (!session) {
        setRecapturingId(null);
        return;
      }
    }

    const controller = new AbortController();
    captureAbortRef.current = controller;
    onRegisterCancelCapture?.(() => controller.abort());
    try {
      const { captured } = await captureYoutubeTargetsFromSession({
        session,
        player: youtubePlayer,
        playerContainer: playerContainerEl,
        youtubeVideoId,
        videoTitle: analysis?.videoMeta.title || 'YouTube 강의',
        targets: [{ timestampSeconds: Math.max(0.5, targetSec), label: frame.visualSummary }],
        forceRecapture: true,
        signal: controller.signal,
        onExpandStage: (expanded) => onSetCaptureExpanded?.(expanded),
        onProgress: (p) => {
          setTabProgress(p);
          onCaptureOverlayUpdate?.(p);
        },
        onFrameCaptured: () => {},
      });
      if (captured[0]) {
        const updatedFrame: CapturedFrame = {
          ...captured[0],
          id: frame.id,
        };
        onUpdateFrame(updatedFrame);
        try {
          await inspectFramesWithVision([updatedFrame]);
        } catch {
          // ignore
        }
        setExtractProgress(`시점 ${captured[0].timestampFormatted} 고해상도 재캡처(${captured[0].width}×${captured[0].height})가 반영되었습니다.`);
      } else {
        setExtractError('해당 시점 재캡처에 실패했거나 검은/흐릿한 화면으로 제외되었습니다.');
      }
    } finally {
      onSetCaptureExpanded?.(false);
      onCaptureOverlayUpdate?.(null);
      onRegisterCancelCapture?.(null);
      setRecapturingId(null);
      captureAbortRef.current = null;
      if (createdHere && tabSessionRef.current) {
        tabSessionRef.current.stop();
        tabSessionRef.current = null;
        setIsScreenSharing(false);
      }
    }
  };

  const runMp4AutoExtraction = async (file: File) => {
    const targets: FrameExtractionTarget[] = buildTargetsFromAnalysis().map((t) => ({
      timestampSeconds: t.timestampSeconds,
      label: t.label,
    }));
    if (targets.length === 0) {
      setExtractError('먼저 영상 분석을 실행해 캡처할 장면/슬라이드 타임스탬프를 확보해주세요.');
      return;
    }

    setIsExtractingMp4(true);
    setExtractError(null);
    const labelPrefix = analysis?.videoMeta.title || file.name;

    try {
      setExtractProgress(`브라우저 Video/Canvas로 ${targets.length}개 시점 프레임 자동 추출 중...`);
      const frames = await extractFramesClientSide(file, targets, labelPrefix, (cur, tot) => {
        setExtractProgress(`MP4 실제 프레임 자동 캡처 및 선명도 검증 중 (${cur} / ${tot})`);
      });
      if (frames.length === 0) {
        throw new Error('브라우저에서 유효한 프레임을 추출하지 못해 서버 FFmpeg로 전환합니다.');
      }
      onFramesExtracted(frames);
      try {
        await inspectFramesWithVision(frames);
      } catch {
        // ignore
      }
      setExtractProgress(`완료: MP4 실제 프레임 ${frames.length}장 확보 (Vision 판독 및 슬라이드 매칭 완료)`);
    } catch {
      try {
        setExtractProgress(`서버 FFmpeg 엔진으로 ${targets.length}개 시점 고해상도 프레임 추출 중...`);
        const formData = new FormData();
        formData.append('video', file);
        formData.append('targets', JSON.stringify(targets));
        formData.append('sourceLabel', labelPrefix);
        const res = await fetch('/api/extract-frames', { method: 'POST', body: formData });
        const data = (await res.json()) as { frames?: CapturedFrame[]; error?: string };
        if (!res.ok || !data.frames) {
          throw new Error(data.error || 'FFmpeg 프레임 추출 실패');
        }
        onFramesExtracted(data.frames);
        try {
          await inspectFramesWithVision(data.frames);
        } catch {
          // ignore
        }
        setExtractProgress(`완료: FFmpeg 실제 프레임 ${data.frames.length}장 확보`);
      } catch (ffErr) {
        setExtractError(
          ffErr instanceof Error ? ffErr.message : '영상 프레임 자동 추출 중 오류가 발생했습니다.',
        );
      }
    } finally {
      setIsExtractingMp4(false);
    }
  };

  const handleSelectMp4 = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onMp4FileSelected(file);
    if (analysis && analysis.scenes.length > 0) {
      await runMp4AutoExtraction(file);
    }
  };

  const handleRecaptureFrame = async (frame: CapturedFrame, newSec: number) => {
    if (recapturingId) return;
    if (mp4File) {
      setRecapturingId(frame.id);
      setExtractError(null);
      try {
        const updated = await extractSingleFrameClientSide(
          mp4File,
          Math.max(0.2, newSec),
          analysis?.videoMeta.title || mp4File.name,
          frame.visualSummary,
        );
        if (updated) {
          onUpdateFrame({ ...updated, id: frame.id });
        }
      } catch (err) {
        setExtractError(err instanceof Error ? err.message : 'MP4 프레임 시점 변경 실패');
      } finally {
        setRecapturingId(null);
      }
      return;
    }

    if (youtubeVideoId && youtubePlayer) {
      await handleRecaptureSingleYoutube(frame, newSec);
    }
  };

  const handleReplaceManualImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetId = manualTargetFrameRef.current;
    if (!file || !targetId) return;
    const existing = capturedFrames[targetId];
    if (!existing) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        onUpdateFrame({
          ...existing,
          imageDataUrl: dataUrl,
          width: img.naturalWidth || existing.width,
          height: img.naturalHeight || existing.height,
          sourceType: 'manual-upload',
          sourceLabel: `직접 교체 이미지 · ${existing.timestampFormatted}`,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleCopyCurrentUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore
    }
  };

  const targetCount = buildTargetsFromAnalysis().length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <Camera className="w-4 h-4 text-[#1E3A8A]" />
            <h2 className="text-sm font-bold text-[#0F172A]">
              실제 영상 화면 자동 캡처 (YouTube 탭 화면 공유 · MP4 자동 추출)
            </h2>
            <span className="font-mono text-xs tabular-nums text-[#0F766E] font-semibold">
              캡처 확보 {frameList.length}장
            </span>
            {maxCaptureResolution && (
              <span
                className={`font-mono text-xs tabular-nums font-medium ${
                  maxCaptureResolution.width >= 1280 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                · 최고 해상도 {maxCaptureResolution.width}×{maxCaptureResolution.height}
                {maxCaptureResolution.width < 1280 ? ' (창 최대화 권장)' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            YouTube 분석 후 <strong>전체 장면 자동 캡처</strong>를 누르면 캡처 전용 대형 스테이지(최대 1920×1080)로
            확대해 1회 탭 공유만으로 UI 오버레이가 사라진 깨끗한 고해상도 PNG 프레임을 자동 확보하고, Gemini Vision으로
            실제 화면 내용을 판독해 슬라이드에 정확히 매칭합니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isScreenSharing ? (
            <button
              type="button"
              disabled={isTabCapturing || !supportInfo.supported}
              onClick={handleStartScreenShare}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Monitor className="w-3.5 h-3.5 text-[#0284C7]" />
              화면 공유 시작
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStopScreenShare}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MonitorOff className="w-3.5 h-3.5" />
              화면 공유 종료
            </button>
          )}

          <button
            type="button"
            disabled={isTabCapturing || !analysis || targetCount === 0 || !youtubeVideoId}
            onClick={() => handleAutoCaptureYoutubeTab(3)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#1E3A8A] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            핵심 3개 장면 검증 캡처
          </button>

          <button
            type="button"
            disabled={isTabCapturing || !analysis || targetCount === 0 || !youtubeVideoId}
            onClick={() => handleAutoCaptureYoutubeTab()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1E3A8A] rounded-lg hover:bg-[#1E40AF] disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isTabCapturing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isTabCapturing
              ? 'YouTube 장면 자동 캡처 중...'
              : `전체 장면 자동 캡처 (${targetCount}개)`}
          </button>

          {isTabCapturing && (
            <button
              type="button"
              onClick={() => captureAbortRef.current?.abort()}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              캡처 중단
            </button>
          )}

          <input
            ref={mp4InputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={handleSelectMp4}
            className="hidden"
          />
          <button
            type="button"
            disabled={isExtractingMp4 || isTabCapturing}
            onClick={() => mp4InputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0F766E] bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Film className="w-3.5 h-3.5" />
            {mp4File ? `MP4 변경 (${mp4File.name})` : 'MP4 파일로 자동 추출'}
          </button>

          {mp4File && analysis && analysis.scenes.length > 0 && (
            <button
              type="button"
              disabled={isExtractingMp4}
              onClick={() => runMp4AutoExtraction(mp4File)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F766E] bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isExtractingMp4 ? 'animate-spin' : ''}`} />
              MP4 재추출
            </button>
          )}

          {frameList.length > 1 && onDedupeFrames && (
            <button
              type="button"
              disabled={isTabCapturing}
              onClick={() => {
                const removed = onDedupeFrames();
                setExtractProgress(
                  removed > 0
                    ? `유사·중복 캡처 이미지 ${removed}건을 자동 정리하고 고화질 프레임으로 재매칭했습니다.`
                    : '중복된 캡처 이미지가 없습니다.',
                );
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              중복 정리
            </button>
          )}

          {analysis && frameList.length > 0 && (
            <button
              type="button"
              disabled={isVerifyingVision || isTabCapturing}
              onClick={handleVerifyMatchedFramesWithGemini}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#4F46E5] bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isVerifyingVision ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              {isVerifyingVision ? 'AI 검증 중...' : 'AI 이미지-슬라이드 검증·재매칭'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoDownloadAfterFull}
            onChange={(e) => setAutoDownloadAfterFull(e.target.checked)}
            className="rounded border-slate-300 text-[#1E3A8A]"
          />
          <span>전체 장면 자동 캡처 완료 시 완성된 PPTX 자동 다운로드</span>
        </label>
        {analysis && frameList.length === 0 && supportInfo.supported && (
          <span className="text-[#1E3A8A] font-medium">
            안내: &quot;핵심 3개 장면 검증 캡처&quot; 또는 &quot;전체 장면 자동 캡처&quot; 클릭 후 팝업에서 현재 탭을 1회 허용하세요.
          </span>
        )}
      </div>

      {/* Environment & iframe Permissions Policy Diagnostics (Requirement 5) */}
      <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-600">
          <span className="font-semibold text-[#0F172A]">실행 환경 진단:</span>
          <span>HTTPS/보안 컨텍스트({supportInfo.isSecureContext ? '정상' : '미지원'})</span>
          <span aria-hidden="true">·</span>
          <span>
            display-capture 권한(
            {supportInfo.policyAllowed === false
              ? 'iframe 정책 제한'
              : supportInfo.supported
                ? '사용 가능'
                : '확인 필요'}
            )
          </span>
          <span aria-hidden="true">·</span>
          <span>Region Capture 크롭({supportInfo.supportsRegionCapture ? '지원' : '좌표 크롭'})</span>
        </div>

        {(supportInfo.isInIframe || supportInfo.policyAllowed === false) && (
          <div className="flex items-center gap-2">
            <a
              href={typeof window !== 'undefined' ? window.location.href : '/'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#1E3A8A] bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              독립 브라우저 탭에서 열기
            </a>
            <button
              type="button"
              onClick={handleCopyCurrentUrl}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              {copiedUrl ? '주소 복사됨' : 'URL 복사'}
            </button>
          </div>
        )}
      </div>

      {!supportInfo.supported && supportInfo.reason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <p className="font-semibold">{supportInfo.reason}</p>
            <p className="text-slate-700">
              상단 <strong>독립 브라우저 탭에서 열기</strong>로 새 창에서 열거나 로컬 Windows PC(
              <code className="font-mono">http://localhost:3000</code>)에서 실행하면{' '}
              <code className="font-mono">getDisplayMedia</code> 화면 공유 캡처를 정상 사용할 수
              있으며, MP4 파일 자동 추출 기능은 iframe 환경에서도 즉시 사용 가능합니다.
            </p>
          </div>
        </div>
      )}

      {/* Real-Time Tab Capture Progress Panel (Requirement 4) */}
      {tabProgress && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
            <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
              <span className="text-slate-500 block text-[11px]">전체 캡처 대상</span>
              <span className="font-mono font-bold tabular-nums text-[#0F172A]">
                {tabProgress.total}개
              </span>
            </div>
            <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
              <span className="text-slate-500 block text-[11px]">현재 캡처 진행</span>
              <span className="font-mono font-bold tabular-nums text-slate-800">
                {tabProgress.processed}개
              </span>
            </div>
            <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
              <span className="text-slate-500 block text-[11px]">성공 개수</span>
              <span className="font-mono font-bold tabular-nums text-[#0F766E]">
                {tabProgress.successCount}개
              </span>
            </div>
            <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
              <span className="text-slate-500 block text-[11px]">실패/제외</span>
              <span className="font-mono font-bold tabular-nums text-amber-700">
                {tabProgress.failedCount}개
              </span>
            </div>
            <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
              <span className="text-slate-500 block text-[11px]">현재 캡처 시점</span>
              <span className="font-mono font-bold tabular-nums text-[#1E3A8A]">
                {tabProgress.currentTimestamp}
              </span>
            </div>
            <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
              <span className="text-slate-500 block text-[11px]">진행률 (성공 기준)</span>
              <span className="font-mono font-bold tabular-nums text-[#1E3A8A]">
                {tabProgress.progressPercent}%
              </span>
            </div>
          </div>

          <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-[#1E3A8A] transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, tabProgress.progressPercent))}%` }}
            />
          </div>
          <p className="text-xs text-slate-700">{tabProgress.statusMessage}</p>
        </div>
      )}

      {extractProgress && !tabProgress && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 flex items-center gap-2 text-xs text-emerald-900">
          {isExtractingMp4 ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#0F766E] shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#0F766E] shrink-0" />
          )}
          <span>{extractProgress}</span>
        </div>
      )}

      {extractError && (
        <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 leading-relaxed">
          {extractError}
        </div>
      )}

      <input
        ref={manualImgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleReplaceManualImage}
        className="hidden"
      />

      {frameList.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
          {frameList.map((frame) => {
            const customVal = customTimeMap[frame.id] ?? frame.timestampFormatted;
            const isBusy = recapturingId === frame.id;
            return (
              <div
                key={frame.id}
                className="rounded-lg border border-slate-200 bg-[#F8FAFC] overflow-hidden flex flex-col justify-between"
              >
                <div className="bg-slate-900 aspect-video relative overflow-hidden">
                  <img
                    src={frame.imageDataUrl}
                    alt={frame.visualSummary}
                    className="w-full h-full object-contain"
                  />
                </div>

                <div className="p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono font-bold tabular-nums text-[#1E3A8A]">
                      {frame.timestampFormatted}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {frame.width}×{frame.height} · 선명도 {frame.sharpnessScore}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[#0F172A] line-clamp-2 leading-snug">
                    {frame.visualSummary}
                  </p>

                  {(mp4File || youtubePlayer) && (
                    <div className="flex items-center gap-1 pt-1">
                      {[-2, -1, 1, 2].map((delta) => (
                        <button
                          key={delta}
                          type="button"
                          disabled={isBusy || isTabCapturing}
                          onClick={() => handleRecaptureFrame(frame, frame.timestampSeconds + delta)}
                          className="px-1.5 py-0.5 text-[11px] font-mono bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                        >
                          {delta > 0 ? `+${delta}s` : `${delta}s`}
                        </button>
                      ))}
                      <input
                        type="text"
                        value={customVal}
                        onChange={(e) =>
                          setCustomTimeMap((prev) => ({ ...prev, [frame.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRecaptureFrame(frame, parseMmSsToSeconds(customVal));
                          }
                        }}
                        aria-label="직접 캡처 시점 입력"
                        className="w-14 px-1.5 py-0.5 text-[11px] font-mono bg-white border border-slate-200 rounded"
                      />
                      <button
                        type="button"
                        disabled={isBusy || isTabCapturing}
                        onClick={() => handleRecaptureFrame(frame, parseMmSsToSeconds(customVal))}
                        title="이 장면 다시 캡처"
                        className="p-1 text-slate-600 hover:text-[#1E3A8A] disabled:opacity-40 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        manualTargetFrameRef.current = frame.id;
                        manualImgInputRef.current?.click();
                      }}
                      className="inline-flex items-center gap-1 text-slate-600 hover:text-[#1E3A8A] cursor-pointer"
                    >
                      <Upload className="w-3 h-3" />
                      이미지 교체
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteFrame(frame.id)}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      제외
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
