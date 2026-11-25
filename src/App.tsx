import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ErrorInfo, FormEvent, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Code2,
  Download,
  FileText,
  Film,
  FolderOpen,
  Loader2,
  Play,
  Printer,
  RotateCcw,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_LECTURE_CONFIG,
  type AnalysisProgressEvent,
  type CapturedFrame,
  type LayoutValidationReport,
  type LectureAnalysisResult,
  type LectureConfig,
  type LectureProject,
  type LectureSlide,
  type ModelConnectionReport,
  type PipelineStepItem,
} from './types/lecture';
import { SceneTimelineView } from './components/SceneTimelineView';
import { ConceptsMatrixView } from './components/ConceptsMatrixView';
import { SlideDeckStudioView } from './components/SlideDeckStudioView';
import { CaptureIndexView } from './components/CaptureIndexView';
import { LectureConfigPanel } from './components/LectureConfigPanel';
import { FrameCapturePanel, type FrameVisionInsightItem, type VisionVerificationResultItem } from './components/FrameCapturePanel';
import { PipelineTracker } from './components/PipelineTracker';
import { ProjectManagerModal } from './components/ProjectManagerModal';
import { YoutubePlayerStage, type CaptureOverlayStatus } from './components/YoutubePlayerStage';
import { buildLecturePptx, triggerBlobDownload } from './utils/pptxExporter';
import {
  buildMarkdownReport,
  exportBundleZip,
  exportHandoutToPdf,
  exportScriptToDocx,
} from './utils/documentExporters';
import { listProjects, loadFramesCache, saveFramesCache, saveProject } from './utils/projectStorage';
import { dedupeCapturedFrames, matchFramesToSlides } from './utils/frameSlideMatcher';
import type { YouTubePlayerLike } from './utils/youtubeTabCapture';

type ActiveTab = 'scenes' | 'concepts' | 'slides' | 'captures';

const DEFAULT_YOUTUBE_URL = 'https://www.youtube.com/watch?v=YXLWe_pqmjU';
const CONFIG_STORAGE_KEY = 'lecturelens_config_v2';

class WorkbenchErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode; onReset: () => void }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || '화면 렌더링 중 오류가 발생했습니다.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('WorkbenchErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3 text-sm text-red-900">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span>작업 화면 렌더링 중 예기치 않은 오류가 발생했습니다</span>
          </div>
          <p className="text-xs text-red-800">{this.state.message}</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, message: '' });
              this.props.onReset();
            }}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A8A] rounded-md cursor-pointer"
          >
            새 강의로 복구하기
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function extractClientYoutubeId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
      return null;
    }
    let id: string | null = null;
    if (host.includes('youtu.be')) {
      id = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v');
    } else if (
      parsed.pathname.startsWith('/embed/') ||
      parsed.pathname.startsWith('/shorts/') ||
      parsed.pathname.startsWith('/live/')
    ) {
      id = parsed.pathname.split('/').filter(Boolean)[1] ?? null;
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function createProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeAnalysis(raw: LectureAnalysisResult): LectureAnalysisResult {
  return {
    ...raw,
    scenes: Array.isArray(raw.scenes) ? raw.scenes : [],
    concepts: Array.isArray(raw.concepts) ? raw.concepts : [],
    slides: Array.isArray(raw.slides) ? raw.slides : [],
  };
}

export default function App() {
  const [youtubeUrl, setYoutubeUrl] = useState<string>(DEFAULT_YOUTUBE_URL);
  const [activeTab, setActiveTab] = useState<ActiveTab>('scenes');
  const [config, setConfig] = useState<LectureConfig>(() => {
    try {
      const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
      return saved
        ? { ...DEFAULT_LECTURE_CONFIG, ...(JSON.parse(saved) as Partial<LectureConfig>) }
        : DEFAULT_LECTURE_CONFIG;
    } catch {
      return DEFAULT_LECTURE_CONFIG;
    }
  });

  const [projectId, setProjectId] = useState<string>(() => createProjectId());
  const [analysis, setAnalysis] = useState<LectureAnalysisResult | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<Record<string, CapturedFrame>>({});
  const [mp4File, setMp4File] = useState<File | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStepItem[]>([]);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [forceRefresh, setForceRefresh] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportStatusNote, setExportStatusNote] = useState<string | null>(null);
  const [validationReport, setValidationReport] = useState<LayoutValidationReport | null>(null);

  const [activeModel, setActiveModel] = useState<string>('gemini-3.5-flash-lite');
  const [availableFreeModels, setAvailableFreeModels] = useState<string[]>([]);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionReport, setConnectionReport] = useState<ModelConnectionReport | null>(null);

  const [youtubePlayer, setYoutubePlayer] = useState<YouTubePlayerLike | null>(null);
  const [playerContainerEl, setPlayerContainerEl] = useState<HTMLDivElement | null>(null);
  const [isCaptureExpanded, setIsCaptureExpanded] = useState(false);
  const [captureOverlayInfo, setCaptureOverlayInfo] = useState<CaptureOverlayStatus | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerSectionRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const captureCancelFnRef = useRef<(() => void) | null>(null);
  const lastRunModeRef = useRef<'preview30s' | 'full'>('full');

  useEffect(() => {
    fetch('/api/models')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { activeModel?: string; availableFreeModels?: string[] } | null) => {
        if (data?.activeModel) setActiveModel(data.activeModel);
        if (Array.isArray(data?.availableFreeModels)) {
          setAvailableFreeModels(data.availableFreeModels);
        }
      })
      .catch(() => {});

    listProjects().then((projects) => {
      if (projects.length > 0 && !analysis) {
        const latest = projects[0];
        setProjectId(latest.id);
        setYoutubeUrl(latest.youtubeUrl || DEFAULT_YOUTUBE_URL);
        if (latest.config) setConfig({ ...DEFAULT_LECTURE_CONFIG, ...latest.config });
        if (latest.analysis) setAnalysis(sanitizeAnalysis(latest.analysis));
        if (latest.capturedFrames) {
          const { unique } = dedupeCapturedFrames(Object.values(latest.capturedFrames));
          const dedupedRecord: Record<string, CapturedFrame> = {};
          for (const f of unique) dedupedRecord[f.id] = f;
          setCapturedFrames(dedupedRecord);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore quota errors
    }
  }, [config]);

  useEffect(() => {
    if (!analysis) return;
    const project: LectureProject = {
      id: projectId,
      name: `${config.courseName || 'AI응용기술'} — ${analysis.videoMeta.title}`,
      courseName: config.courseName || 'AI응용기술',
      topic: config.lectureTopic || analysis.videoMeta.title,
      createdAt: analysis.videoMeta.analyzedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      youtubeUrl,
      config,
      analysis,
      capturedFrames,
    };
    saveProject(project).catch(() => {});
  }, [analysis, capturedFrames, config, projectId, youtubeUrl]);

  const activeYoutubeId = useMemo(() => {
    if (analysis?.videoMeta?.videoId) return analysis.videoMeta.videoId;
    return extractClientYoutubeId(youtubeUrl);
  }, [analysis, youtubeUrl]);

  useEffect(() => {
    if (!activeYoutubeId) return;
    if (Object.keys(capturedFrames).length > 0) {
      saveFramesCache(activeYoutubeId, capturedFrames);
    }
  }, [activeYoutubeId, capturedFrames]);

  const handleYoutubePlayerReady = useCallback(
    (player: YouTubePlayerLike | null, containerEl: HTMLDivElement | null) => {
      setYoutubePlayer(player);
      setPlayerContainerEl(containerEl);
    },
    [],
  );

  const handleTestConnection = async () => {
    if (isTestingConnection) return;
    setIsTestingConnection(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredModel: config.preferredModel }),
      });
      const data = (await res.json()) as ModelConnectionReport & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `연결 테스트 실패 (${res.status})`);
      }
      setConnectionReport(data);
      if (data.activeModel) setActiveModel(data.activeModel);
      if (Array.isArray(data.availableFreeModels)) {
        setAvailableFreeModels(data.availableFreeModels);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'API 연결 테스트 중 오류가 발생했습니다.');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const mergeFramesAndMatchSlides = (newFrames: CapturedFrame[]) => {
    if (newFrames.length === 0) return;

    setCapturedFrames((prevFrames) => {
      const combined = { ...prevFrames };
      for (const f of newFrames) {
        combined[f.id] = f;
      }
      const { unique } = dedupeCapturedFrames(Object.values(combined));
      const nextFrames: Record<string, CapturedFrame> = {};
      for (const f of unique) nextFrames[f.id] = f;

      setAnalysis((prevAnalysis) => {
        if (!prevAnalysis) return prevAnalysis;
        const matchedSlides = matchFramesToSlides(
          prevAnalysis.slides,
          unique,
          prevAnalysis.scenes,
        );
        return {
          ...prevAnalysis,
          videoMeta: { ...prevAnalysis.videoMeta, hasRealFrames: true },
          slides: matchedSlides,
        };
      });

      return nextFrames;
    });
  };

  const handleApplyInspectedFrames = (insights: FrameVisionInsightItem[]) => {
    if (insights.length === 0) return;
    const byId = new Map(insights.map((it) => [it.id, it]));

    setCapturedFrames((prevFrames) => {
      const nextFrames: Record<string, CapturedFrame> = {};
      for (const [id, frame] of Object.entries(prevFrames)) {
        const insight = byId.get(id);
        if (insight) {
          nextFrames[id] = {
            ...frame,
            visionObservedText: `${insight.observedVisual} ${insight.detectedText}`.trim(),
            visionTags: insight.visionTags,
            visionProvider: insight.visionProvider,
          };
        } else {
          nextFrames[id] = frame;
        }
      }

      const frameList = Object.values(nextFrames);
      setAnalysis((prevAnalysis) => {
        if (!prevAnalysis) return prevAnalysis;
        const matchedSlides = matchFramesToSlides(
          prevAnalysis.slides,
          frameList,
          prevAnalysis.scenes,
        );
        return {
          ...prevAnalysis,
          videoMeta: { ...prevAnalysis.videoMeta, hasRealFrames: frameList.length > 0 },
          slides: matchedSlides.map((sl) => {
            const matchedFid = sl.capturedFrameIds?.[0];
            const matchedFrame = matchedFid ? nextFrames[matchedFid] : undefined;
            if (!matchedFrame?.visionObservedText) return sl;
            return {
              ...sl,
              visionMatchNote: `Vision 판독: ${matchedFrame.visionObservedText}`,
            };
          }),
        };
      });

      return nextFrames;
    });
  };

  const handleDedupeFrames = (): number => {
    const all = Object.values(capturedFrames);
    const { unique, removedCount } = dedupeCapturedFrames(all);
    if (removedCount === 0) return 0;

    const nextFrames: Record<string, CapturedFrame> = {};
    for (const f of unique) nextFrames[f.id] = f;
    setCapturedFrames(nextFrames);

    setAnalysis((prevAnalysis) => {
      if (!prevAnalysis) return prevAnalysis;
      return {
        ...prevAnalysis,
        slides: matchFramesToSlides(prevAnalysis.slides, unique, prevAnalysis.scenes),
      };
    });
    return removedCount;
  };

  const consumeSseStream = async (response: Response) => {
    if (!response.body) {
      throw new Error('서버 응답 스트림을 열 수 없습니다.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonPart = trimmed.slice(5).trim();
        if (!jsonPart) continue;

        const evt = JSON.parse(jsonPart) as AnalysisProgressEvent;
        setProgressMessage(evt.message);
        if (evt.activeModel) setActiveModel(evt.activeModel);
        if (evt.pipelineSteps) setPipelineSteps(evt.pipelineSteps);
        if (evt.extractedFrames && evt.extractedFrames.length > 0) {
          mergeFramesAndMatchSlides(evt.extractedFrames);
        }

        if ((evt.stage === 'stage1_complete' || evt.stage === 'phase1_complete') && evt.partialResult) {
          setAnalysis((prev) => ({
            videoMeta: evt.partialResult!.videoMeta!,
            executiveSummary: evt.partialResult!.executiveSummary ?? '',
            storyline: evt.partialResult!.storyline,
            scenes: evt.partialResult!.scenes ?? [],
            concepts: evt.partialResult!.concepts ?? [],
            slides: prev?.slides ?? [],
          }));
          setActiveTab('scenes');
        } else if (evt.stage === 'complete' && evt.result) {
          const clean = sanitizeAnalysis(evt.result);
          const vid = clean.videoMeta?.videoId || extractClientYoutubeId(youtubeUrl);
          const cachedVideoFrames = vid ? await loadFramesCache(vid) : null;
          if (cachedVideoFrames && Object.keys(cachedVideoFrames).length > 0) {
            const rawMerged = { ...cachedVideoFrames, ...capturedFrames };
            const { unique } = dedupeCapturedFrames(Object.values(rawMerged));
            const dedupedMerged: Record<string, CapturedFrame> = {};
            for (const f of unique) dedupedMerged[f.id] = f;
            setCapturedFrames(dedupedMerged);
            const matchedSlides = matchFramesToSlides(
              clean.slides,
              unique,
              clean.scenes,
            );
            setAnalysis({
              ...clean,
              videoMeta: { ...clean.videoMeta, hasRealFrames: true },
              slides: matchedSlides,
            });
          } else {
            setAnalysis(clean);
          }
          if (clean.videoMeta?.modelUsed) {
            setActiveModel(clean.videoMeta.modelUsed);
          }
          if (clean.slides.length > 0) {
            setActiveTab('slides');
          }
        } else if (evt.stage === 'error') {
          throw new Error(evt.error || evt.message || '영상 분석에 실패했습니다.');
        }
      }
    }
  };

  const runYoutubeAnalysis = async (mode: 'preview30s' | 'full') => {
    if (isAnalyzing) return;
    lastRunModeRef.current = mode;

    const id = extractClientYoutubeId(youtubeUrl);
    if (!id) {
      setErrorMessage('올바른 YouTube URL을 입력해주세요. (예: https://www.youtube.com/watch?v=YXLWe_pqmjU)');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorMessage(null);
    setExportStatusNote(null);
    setValidationReport(null);
    setIsAnalyzing(true);
    setPipelineSteps([]);
    setProgressMessage(
      mode === 'preview30s'
        ? 'API 연결 확인 후 처음 30초(00:00~00:30)만 테스트 분석을 시작합니다...'
        : 'API 연결 및 30초 검증 후 전체 영상·다중 레이아웃 PPTX 단계별 분석을 시작합니다...',
    );

    try {
      const response = await fetch('/api/analyze-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          youtubeUrl: youtubeUrl.trim(),
          mode,
          config,
          forceRefresh,
        }),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `요청 실패 (${response.status})`);
      }

      await consumeSseStream(response);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgressMessage('사용자에 의해 분석이 중단되었습니다.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : '영상 분석 중 오류가 발생했습니다.');
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort();
  };

  const handleAnalyzeYoutube = async (e?: FormEvent) => {
    e?.preventDefault();
    await runYoutubeAnalysis('full');
  };

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isAnalyzing) return;

    setMp4File(file);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorMessage(null);
    setExportStatusNote(null);
    setValidationReport(null);
    setIsAnalyzing(true);
    setPipelineSteps([]);
    setProgressMessage(`로컬 강의 MP4(${file.name}) 업로드 및 실제 프레임 자동 추출 포함 분석 시작...`);

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('config', JSON.stringify(config));
      const response = await fetch('/api/analyze-upload', {
        method: 'POST',
        signal: controller.signal,
        body: formData,
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `업로드 분석 실패 (${response.status})`);
      }

      await consumeSseStream(response);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgressMessage('사용자에 의해 분석이 중단되었습니다.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : '로컬 영상 분석 중 오류가 발생했습니다.');
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const handleUpdateSlide = (slideNumber: number, updated: LectureSlide) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        slides: prev.slides.map((s) => (s.slideNumber === slideNumber ? updated : s)),
      };
    });
  };

  const handleSetSlides = (nextSlides: LectureSlide[]) => {
    setAnalysis((prev) => (prev ? { ...prev, slides: nextSlides } : prev));
  };

  const handleUpdateSingleFrame = (frame: CapturedFrame) => {
    setCapturedFrames((prev) => ({ ...prev, [frame.id]: frame }));
  };

  const handleDeleteFrame = (frameId: string) => {
    setCapturedFrames((prev) => {
      const next = { ...prev };
      delete next[frameId];
      return next;
    });
  };

  const handleJumpToTimestamp = (seconds: number) => {
    const target = Math.max(0, Math.floor(seconds));
    if (youtubePlayer) {
      try {
        youtubePlayer.seekTo(target, true);
        youtubePlayer.playVideo();
      } catch {
        // ignore
      }
    }
    playerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const handleApplyVisionResults = (results: VisionVerificationResultItem[]) => {
    if (results.length === 0) return;
    const bySlide = new Map(results.map((r) => [r.slideNumber, r]));
    setAnalysis((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        slides: prev.slides.map((s) => {
          const hit = bySlide.get(s.slideNumber);
          if (!hit) return s;
          return {
            ...s,
            visionVerified: hit.status,
            visionMatchNote: hit.reason || hit.observedVisual,
          };
        }),
      };
    });
  };

  const exportPptxSnapshot = async (
    snapshot: LectureAnalysisResult,
    frameSnapshot: Record<string, CapturedFrame>,
    automatic = false,
  ) => {
    if (snapshot.slides.length === 0 || isExporting) return;
    setIsExporting(true);
    setExportStatusNote(null);
    setErrorMessage(null);
    try {
      const res = await buildLecturePptx(snapshot, frameSnapshot, config);
      setValidationReport(res.validationReport);
      if (automatic && (!res.zipVerified || (res.validationReport.missingFrameSlides?.length ?? 0) > 0)) {
        setExportStatusNote('자동 다운로드 보류: PPTX 내부 검증 또는 영상 이미지 삽입을 확인하세요. 필요하면 수동으로 초안을 다운로드할 수 있습니다.');
        return;
      }
      triggerBlobDownload(res.blob, res.fileName);
      const missingCount = res.validationReport.missingFrameSlides?.length ?? 0;
      const audit = res.validationReport.zipAudit;
      const auditText = audit
        ? ` · 슬라이드 ${audit.slideCount}장 · 내장 이미지 ${audit.mediaImageCount}개(${Math.round(audit.totalMediaBytes / 1024)}KB) · 발표자 노트 ${audit.notesSlideCount}장`
        : '';
      setExportStatusNote(
        `${res.fileName} 생성 완료 (ZIP XML 검증: ${res.zipVerified ? '정상' : '확인 필요'}${auditText} · 레이아웃: ${res.validationReport.passed ? '겹침 없음' : `${res.validationReport.issues.length}건 조정/주의`} · 캡처 미확보 슬라이드: ${missingCount}장)`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'PPTX 내보내기 중 오류가 발생했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPptx = async () => {
    if (!analysis) return;
    await exportPptxSnapshot(analysis, capturedFrames);
  };

  const handleAutoExportCapturedFrames = async (frames: CapturedFrame[]) => {
    if (!analysis) return;
    const { unique } = dedupeCapturedFrames(frames);
    const frameSnapshot = Object.fromEntries(unique.map((frame) => [frame.id, frame]));
    const snapshot: LectureAnalysisResult = {
      ...analysis,
      videoMeta: { ...analysis.videoMeta, hasRealFrames: unique.length > 0 },
      slides: matchFramesToSlides(analysis.slides, unique, analysis.scenes),
    };
    setCapturedFrames(frameSnapshot);
    setAnalysis(snapshot);
    await exportPptxSnapshot(snapshot, frameSnapshot, true);
  };

  const handleExportDocx = async () => {
    if (!analysis || isExporting) return;
    setIsExporting(true);
    try {
      const blob = await exportScriptToDocx(analysis, config);
      const name = `${(analysis.videoMeta.title || 'lecture_script').replace(/[^\w\u3131-\uD79D-]+/g, '_').slice(0, 40)}_교수자대본.docx`;
      triggerBlobDownload(blob, name);
      setExportStatusNote(`${name} 다운로드 완료`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'DOCX 대본 생성 실패');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!analysis || isExporting) return;
    setIsExporting(true);
    try {
      const blob = await exportHandoutToPdf(analysis, capturedFrames, config);
      const name = `${(analysis.videoMeta.title || 'lecture_handout').replace(/[^\w\u3131-\uD79D-]+/g, '_').slice(0, 40)}_학생배포용.pdf`;
      triggerBlobDownload(blob, name);
      setExportStatusNote(`${name} 다운로드 완료`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'PDF 생성 실패');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportBundleZip = async () => {
    if (!analysis || isExporting) return;
    setIsExporting(true);
    try {
      const pptxRes = await buildLecturePptx(analysis, capturedFrames, config);
      setValidationReport(pptxRes.validationReport);
      const bundle = await exportBundleZip(
        analysis,
        capturedFrames,
        config,
        pptxRes.blob,
        pptxRes.fileName,
      );
      const name = `${(config.courseName || 'LectureLens').replace(/[^\w\u3131-\uD79D-]+/g, '_')}_강의패키지.zip`;
      triggerBlobDownload(bundle, name);
      setExportStatusNote(`${name} (PPTX + DOCX + PDF + MD + JSON + 캡처 이미지) 일괄 다운로드 완료`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '일괄 ZIP 패키지 생성 실패');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!analysis) return;
    const md = buildMarkdownReport(analysis, config);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const name = `${(analysis.videoMeta.title || 'lecture_analysis').replace(/[^\w\u3131-\uD79D-]+/g, '_').slice(0, 40)}.md`;
    triggerBlobDownload(blob, name);
  };

  const handleResetWorkspace = () => {
    setProjectId(createProjectId());
    setAnalysis(null);
    setCapturedFrames({});
    setMp4File(null);
    setPipelineSteps([]);
    setValidationReport(null);
    setErrorMessage(null);
    setExportStatusNote(null);
    setYoutubeUrl(DEFAULT_YOUTUBE_URL);
  };

  const handleLoadProject = (proj: LectureProject) => {
    setProjectId(proj.id);
    setYoutubeUrl(proj.youtubeUrl || DEFAULT_YOUTUBE_URL);
    setConfig({ ...DEFAULT_LECTURE_CONFIG, ...proj.config });
    setAnalysis(proj.analysis ? sanitizeAnalysis(proj.analysis) : null);
    setCapturedFrames(proj.capturedFrames || {});
    setValidationReport(null);
    setExportStatusNote(`프로젝트 "${proj.name}"를 불러왔습니다.`);
  };

  const currentProjectObj: LectureProject | null = analysis
    ? {
        id: projectId,
        name: `${config.courseName || 'AI응용기술'} — ${analysis.videoMeta.title}`,
        courseName: config.courseName || 'AI응용기술',
        topic: config.lectureTopic || analysis.videoMeta.title,
        createdAt: analysis.videoMeta.analyzedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        youtubeUrl,
        config,
        analysis,
        capturedFrames,
      }
    : null;

  const hasSlides = Boolean(analysis && analysis.slides.length > 0);
  const frameCount = Object.keys(capturedFrames).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0 font-display"
          >
            LectureLens AI 2.0
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {(
              [
                { id: 'scenes', label: '장면·스토리라인' },
                { id: 'concepts', label: '개념·수식' },
                { id: 'slides', label: `슬라이드 (${analysis?.slides.length || config.targetSlideCount}장)` },
                { id: 'captures', label: `캡처 (${frameCount}장)` },
              ] as const
            ).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'border-[#1E3A8A] text-[#1E3A8A] font-semibold'
                      : 'border-transparent text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              disabled={!hasSlides || isExporting}
              onClick={handleExportPptx}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] rounded-lg hover:bg-[#1E40AF] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {isExporting ? 'PPTX 생성 중...' : 'PPTX 내보내기'}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8 space-y-6">
        <WorkbenchErrorBoundary onReset={handleResetWorkspace}>
          {/* Intake, Config & Video Verification Workbench */}
          <section
            ref={playerSectionRef}
            className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
          >
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div className="space-y-1 max-w-3xl">
                <p className="text-xs font-medium text-slate-500">
                  대학 전공 교수자 전용 강의 제작 시스템 · YouTube 탭 자동 캡처 · MP4 프레임 삽입 · KaTeX 수식 · 출처 A/B/C
                </p>
                <h1 className="text-2xl md:text-3xl font-bold text-[#0F172A] tracking-tight text-balance">
                  영상 화면·음성 종합 분석 및 강의용 PPTX 자동 생성 스튜디오
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsProjectModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#0F766E]" />
                  프로젝트 보관함
                </button>
                <button
                  type="button"
                  disabled={isTestingConnection || isAnalyzing}
                  onClick={handleTestConnection}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isTestingConnection ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Activity className="w-3.5 h-3.5 text-[#0284C7]" />
                  )}
                  {isTestingConnection ? '연결 확인 중...' : 'API 연결 테스트'}
                </button>
                <a
                  href="/api/export-source-zip"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  <Code2 className="w-3.5 h-3.5 text-[#1E3A8A]" />
                  소스코드 ZIP
                </a>
                {analysis && (
                  <button
                    type="button"
                    onClick={handleResetWorkspace}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-[#F8FAFC] border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    새 강의
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>현재 활성 모델:</span>
              <span className="font-mono font-semibold text-[#1E3A8A]">{activeModel}</span>
              <span aria-hidden="true">·</span>
              <span>무료 Flash 계열 전용 (유료 모델 자동 전환 차단)</span>
              <span aria-hidden="true">·</span>
              <span>503 오류 시 지수 백오프 최대 3회 재시도</span>
            </div>

            <LectureConfigPanel
              config={config}
              onChange={setConfig}
              availableFreeModels={availableFreeModels}
              disabled={isAnalyzing}
            />

            <form
              onSubmit={handleAnalyzeYoutube}
              className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3"
            >
              <div className="flex-1 flex items-center rounded-lg border border-slate-300 bg-[#F8FAFC] px-3.5 py-2.5 focus-within:border-[#1E3A8A] focus-within:bg-white transition-colors">
                <Film className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=YXLWe_pqmjU"
                  aria-label="분석할 유튜브 영상 URL"
                  className="w-full bg-transparent text-sm font-mono text-[#0F172A] focus:outline-none"
                />
              </div>

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => runYoutubeAnalysis('preview30s')}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[#1E3A8A] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Clock className="w-4 h-4" />
                처음 30초 검증
              </button>

              <button
                type="submit"
                disabled={isAnalyzing}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1E3A8A] rounded-lg hover:bg-[#1E40AF] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {isAnalyzing ? '단계별 분석 중...' : '실제 영상 이미지 포함 강의자료 자동 생성'}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={handleUploadFile}
                className="hidden"
              />
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[#0F766E] bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                MP4 업로드·프레임 자동 분석
              </button>
            </form>

            {connectionReport && (
              <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-700">
                    <span className="font-semibold text-[#0F172A]">API 연결 및 무료 모델 점검 결과</span>
                    <span className="mx-2 text-slate-400">·</span>
                    <span>활성 모델: </span>
                    <span className="font-mono font-bold text-[#1E3A8A]">
                      {connectionReport.activeModel}
                    </span>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    무료 호환 {connectionReport.availableFreeModels.length}개 / 전체 Gemini{' '}
                    {connectionReport.allGeminiModels.length}개
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {connectionReport.testedCandidates.map((entry) => (
                    <div
                      key={entry.model}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#0F172A]">{entry.model}</span>
                        <span
                          className={`font-mono font-semibold ${
                            entry.status === 'ok'
                              ? 'text-emerald-700'
                              : entry.status === 'unavailable'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {entry.status === 'ok' ? `OK · ${entry.latencyMs}ms` : entry.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-snug break-all">
                        {entry.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <PipelineTracker
              steps={pipelineSteps}
              isAnalyzing={isAnalyzing}
              activeModel={activeModel}
              progressMessage={progressMessage}
              forceRefresh={forceRefresh}
              onToggleForceRefresh={setForceRefresh}
              onCancel={handleCancelAnalysis}
              onRetry={() => runYoutubeAnalysis(lastRunModeRef.current)}
            />

            {errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-sm text-red-900 space-y-1">
                  <p className="font-semibold">분석 또는 API 연결 중 오류가 발생했습니다</p>
                  <p className="text-xs text-red-800 leading-relaxed break-all">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Export Toolbar */}
            {hasSlides && (
              <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-[#0F172A]">강의자료 내보내기 센터:</span>{' '}
                  <span>
                    16:9 PPTX(실제 영상 프레임·KaTeX 수식·발표자 노트), DOCX 대본, 학생용 PDF, 일괄 ZIP 지원
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleExportPptx}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A8A] rounded-md hover:bg-[#1E40AF] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    PPTX 다운로드
                  </button>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleExportDocx}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#1E3A8A]" />
                    대본 (.docx)
                  </button>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleExportPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#0F766E]" />
                    학생용 (.pdf)
                  </button>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleDownloadMarkdown}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    분석리포트 (.md)
                  </button>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleExportBundleZip}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0F766E] bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    전체 패키지 (.zip)
                  </button>
                </div>
              </div>
            )}

            {exportStatusNote && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 space-y-2 text-xs text-emerald-900">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{exportStatusNote}</span>
                </div>
                {validationReport && (
                  <div className="text-[11px] text-slate-700 space-y-1 pl-6">
                    <p>{validationReport.verificationDisclaimer}</p>
                    {validationReport.missingFrameSlides &&
                      validationReport.missingFrameSlides.length > 0 && (
                        <p className="text-amber-800 font-medium">
                          캡처 이미지 미확보 슬라이드 (도식/가이드 대체): Slide{' '}
                          {validationReport.missingFrameSlides.join(', ')}
                        </p>
                      )}
                    {validationReport.issues.length > 0 && (
                      <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                        {validationReport.issues.slice(0, 6).map((iss, idx) => (
                          <li key={idx}>
                            Slide {iss.slideNumber} ({iss.severity === 'adjusted' ? '자동조정' : '주의'}):{' '}
                            {iss.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* YouTube IFrame Player API Stage + Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch pt-1">
              <div className="lg:col-span-6">
                <YoutubePlayerStage
                  videoId={activeYoutubeId}
                  onPlayerReady={handleYoutubePlayerReady}
                  isCaptureExpanded={isCaptureExpanded}
                  captureOverlayInfo={captureOverlayInfo}
                  onCancelCapture={() => captureCancelFnRef.current?.()}
                />
              </div>

              <div className="lg:col-span-6 flex flex-col justify-between rounded-lg border border-slate-200 bg-[#F8FAFC] p-5 space-y-4">
                {analysis ? (
                  <>
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-semibold text-[#0F172A]">
                          {analysis.videoMeta.channelOrAuthor}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          총 길이 {analysis.videoMeta.durationFormatted}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>음성: {analysis.videoMeta.language}</span>
                      </div>
                      <h2 className="text-lg font-bold text-[#0F172A] leading-snug">
                        {analysis.videoMeta.title}
                      </h2>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {analysis.executiveSummary}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-slate-200 space-y-2">
                      <div className="grid grid-cols-4 gap-2.5 text-center">
                        <div className="rounded-lg bg-white border border-slate-200 py-2 px-2">
                          <p className="font-mono text-lg font-bold tabular-nums text-[#1E3A8A]">
                            {analysis.scenes.length}
                          </p>
                          <p className="text-[11px] text-slate-500">장면 구간</p>
                        </div>
                        <div className="rounded-lg bg-white border border-slate-200 py-2 px-2">
                          <p className="font-mono text-lg font-bold tabular-nums text-[#0284C7]">
                            {analysis.concepts.length}
                          </p>
                          <p className="text-[11px] text-slate-500">개념·수식</p>
                        </div>
                        <div className="rounded-lg bg-white border border-slate-200 py-2 px-2">
                          <p className="font-mono text-lg font-bold tabular-nums text-[#4F46E5]">
                            {analysis.slides.length}
                          </p>
                          <p className="text-[11px] text-slate-500">슬라이드</p>
                        </div>
                        <div className="rounded-lg bg-white border border-slate-200 py-2 px-2">
                          <p className="font-mono text-lg font-bold tabular-nums text-[#0F766E]">
                            {frameCount}
                          </p>
                          <p className="text-[11px] text-slate-500">실제 캡처</p>
                        </div>
                      </div>
                      {analysis.videoMeta.verificationNote && (
                        <p className="text-xs text-slate-500 leading-relaxed">
                          검증 범위: {analysis.videoMeta.verificationNote}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="my-auto space-y-3">
                    <h2 className="text-lg font-bold text-[#0F172A]">
                      분석 대기 중 — YouTube 탭 자동 캡처 및 MP4 프레임을 통합해 강의안을 생성합니다
                    </h2>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      유튜브 URL 분석 후 <strong>전체 장면 자동 캡처</strong>를 실행하면 1회의 화면
                      공유 허용만으로 필요한 장면을 자동 캡처(PNG)하여 슬라이드와 PPTX에 삽입합니다.
                    </p>
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      <li>01. 00:00~00:30 사전 검증 후 전체 화면·음성·자막·도식·코드 종합 분석</li>
                      <li>02. YouTube IFrame API + getDisplayMedia로 영상 영역만 정밀 크롭 캡처</li>
                      <li>03. 20종 교육 레이아웃 + 출처 A(영상)·B(학부보충)·C(학술추가) 엄격 구분</li>
                      <li>04. PowerPoint(.pptx), 교수자 대본(.docx), 학생 배포용(.pdf) 원클릭 내보내기</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile Tab Switcher */}
            <div className="flex md:hidden items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {(
                [
                  { id: 'scenes', label: '장면·스토리라인' },
                  { id: 'concepts', label: '개념·수식' },
                  { id: 'slides', label: `슬라이드 (${analysis?.slides.length || config.targetSlideCount}장)` },
                  { id: 'captures', label: `캡처 (${frameCount}장)` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tab.id ? 'bg-white text-[#0F172A] shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          {/* Real Video Frame Auto-Capture Studio */}
          <FrameCapturePanel
            aiProvider={config.aiProvider || 'gemini'}
            analysis={analysis}
            capturedFrames={capturedFrames}
            mp4File={mp4File}
            youtubeVideoId={activeYoutubeId}
            youtubePlayer={youtubePlayer}
            playerContainerEl={playerContainerEl}
            onMp4FileSelected={setMp4File}
            onFramesExtracted={mergeFramesAndMatchSlides}
            onUpdateFrame={handleUpdateSingleFrame}
            onDeleteFrame={handleDeleteFrame}
            onApplyInspectedFrames={handleApplyInspectedFrames}
            onApplyVisionResults={handleApplyVisionResults}
            onDedupeFrames={handleDedupeFrames}
            onSetCaptureExpanded={setIsCaptureExpanded}
            onCaptureOverlayUpdate={setCaptureOverlayInfo}
            onRegisterCancelCapture={(fn) => {
              captureCancelFnRef.current = fn;
            }}
            onTriggerPptxExport={handleAutoExportCapturedFrames}
          />

          {/* Active Workbench View */}
          {analysis && (
            <section aria-label="강의 분석 워크벤치 본문">
              {activeTab === 'scenes' && (
                <SceneTimelineView
                  scenes={analysis.scenes}
                  storyline={analysis.storyline}
                  capturedFrames={capturedFrames}
                  hasYoutubePlayer={Boolean(activeYoutubeId)}
                  onJumpToTimestamp={handleJumpToTimestamp}
                />
              )}
              {activeTab === 'concepts' && <ConceptsMatrixView concepts={analysis.concepts} />}
              {activeTab === 'slides' && (
                <SlideDeckStudioView
                  slides={analysis.slides}
                  capturedFrames={capturedFrames}
                  contextSummary={`${analysis.videoMeta.title} — ${analysis.executiveSummary}`}
                  courseName={config.courseName}
                  hasYoutubePlayer={Boolean(activeYoutubeId)}
                  mp4File={mp4File}
                  onUpdateSlide={handleUpdateSlide}
                  onSetSlides={handleSetSlides}
                  onJumpToTimestamp={handleJumpToTimestamp}
                  onUpdateFrame={handleUpdateSingleFrame}
                />
              )}
              {activeTab === 'captures' && (
                <CaptureIndexView
                  analysis={analysis}
                  capturedFrames={capturedFrames}
                  mp4File={mp4File}
                  hasYoutubePlayer={Boolean(activeYoutubeId)}
                  onJumpToTimestamp={handleJumpToTimestamp}
                  onUpdateFrame={handleUpdateSingleFrame}
                />
              )}
            </section>
          )}
        </WorkbenchErrorBoundary>
      </main>

      <ProjectManagerModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        currentProject={currentProjectObj}
        onLoadProject={handleLoadProject}
      />
    </div>
  );
}
