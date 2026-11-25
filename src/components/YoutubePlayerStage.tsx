import { useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import { loadYouTubeIframeApi, type YouTubePlayerLike } from '../utils/youtubeTabCapture';

export interface CaptureOverlayStatus {
  currentTimestamp: string;
  progressPercent: number;
  statusMessage: string;
  processed: number;
  total: number;
}

interface YoutubePlayerStageProps {
  videoId: string | null;
  onPlayerReady: (player: YouTubePlayerLike | null, containerEl: HTMLDivElement | null) => void;
  isCaptureExpanded?: boolean;
  hidePlayerUi?: boolean;
  hideYoutubeCaptions?: boolean;
  captureOverlayInfo?: CaptureOverlayStatus | null;
  onCancelCapture?: () => void;
}

export function YoutubePlayerStage({
  videoId,
  onPlayerReady,
  isCaptureExpanded = false,
  hidePlayerUi = true,
  hideYoutubeCaptions = true,
  captureOverlayInfo = null,
  onCancelCapture,
}: YoutubePlayerStageProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerLike | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cleanupPlayer = () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
      onPlayerReady(null, wrapperRef.current);
    };

    if (!videoId) {
      cleanupPlayer();
      return;
    }

    setApiError(null);
    loadYouTubeIframeApi()
      .then(() => {
        if (cancelled || !hostRef.current || !window.YT?.Player) return;

        hostRef.current.innerHTML = '';
        const mountNode = document.createElement('div');
        mountNode.style.width = '100%';
        mountNode.style.height = '100%';
        hostRef.current.appendChild(mountNode);

        const player = new window.YT.Player(mountNode, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            disablekb: 1,
            controls: hidePlayerUi ? 0 : 1,
            ...(hideYoutubeCaptions ? {} : { cc_load_policy: 1 }),
          },
          events: {
            onReady: (e) => {
              if (cancelled) {
                try {
                  e.target.destroy();
                } catch {
                  // ignore
                }
                return;
              }
              try {
                e.target.setPlaybackQuality?.('hd1080');
              } catch {
                // ignore
              }
              playerRef.current = e.target;
              onPlayerReady(e.target, wrapperRef.current);
            },
            onError: (e) => {
              setApiError(`YouTube 플레이어 오류 코드(${e.data}) — 영상 재생 또는 임베드 제한 여부를 확인해주세요.`);
            },
          },
        });
        playerRef.current = player;
      })
      .catch((err) => {
        if (!cancelled) {
          setApiError(err instanceof Error ? err.message : 'YouTube Player API 초기화 실패');
        }
      });

    return () => {
      cancelled = true;
      cleanupPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, hidePlayerUi, hideYoutubeCaptions]);

  return (
    <div
      className={
        isCaptureExpanded
          ? 'fixed inset-0 z-50 bg-slate-950/95 flex flex-col items-center justify-center gap-3 p-3 sm:p-5'
          : ''
      }
    >
      <div
        ref={wrapperRef}
        className={
          isCaptureExpanded
            ? 'relative w-[min(96vw,177.78vh)] max-w-[1920px] aspect-video bg-black overflow-hidden pointer-events-none select-none cursor-none'
            : 'relative rounded-lg overflow-hidden border border-slate-200 bg-slate-900 min-h-[260px] aspect-video'
        }
      >
        {videoId ? (
          <>
            <div ref={hostRef} className="w-full h-full" />
            {apiError && (
              <div className="absolute inset-x-3 bottom-3 rounded-md bg-red-950/90 border border-red-400/50 px-3 py-2 text-xs text-red-100">
                {apiError}
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-300 p-6 text-center">
            로컬 MP4 분석 모드 또는 유효한 YouTube URL을 입력하면 플레이어가 표시됩니다.
          </div>
        )}
      </div>

      {/* Rendered OUTSIDE wrapperRef so Region Capture / player crop never captures our status bar */}
      {isCaptureExpanded && (
        <div className="w-[min(96vw,177.78vh)] max-w-[1920px] rounded-lg bg-slate-900/95 border border-slate-700 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-sky-300">고해상도 자동 캡처 전용 스테이지</span>
            {captureOverlayInfo && (
              <>
                <span className="font-mono tabular-nums text-emerald-300">
                  {captureOverlayInfo.processed}/{captureOverlayInfo.total} ({captureOverlayInfo.progressPercent}%)
                </span>
                <span className="font-mono tabular-nums text-slate-300">
                  시점 {captureOverlayInfo.currentTimestamp}
                </span>
                <span className="text-slate-300">{captureOverlayInfo.statusMessage}</span>
              </>
            )}
          </div>
          {onCancelCapture && (
            <button
              type="button"
              onClick={onCancelCapture}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              캡처 중단
            </button>
          )}
        </div>
      )}
    </div>
  );
}
