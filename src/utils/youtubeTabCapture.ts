import type { CapturedFrame } from '../types/lecture';

export interface DisplayCaptureSupportInfo {
  supported: boolean;
  isSecureContext: boolean;
  isInIframe: boolean;
  policyAllowed: boolean | null;
  supportsRegionCapture: boolean;
  reason?: string;
}

export interface CaptureTargetItem {
  timestampSeconds: number;
  label: string;
  keywords?: string;
}

export interface TabCaptureProgress {
  total: number;
  processed: number;
  successCount: number;
  failedCount: number;
  currentTimestamp: string;
  progressPercent: number;
  statusMessage: string;
}

export interface ActiveTabCaptureSession {
  stream: MediaStream;
  videoEl: HTMLVideoElement;
  isCroppedByRegionApi: boolean;
  displaySurface: string;
  stop: () => void;
}

export interface YouTubePlayerLike {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setPlaybackQuality?: (suggestedQuality: string) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVideoData?: () => { video_id?: string; title?: string };
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YouTubePlayerLike }) => void;
            onStateChange?: (e: { data: number; target: YouTubePlayerLike }) => void;
            onError?: (e: { data: number }) => void;
          };
        },
      ) => YouTubePlayerLike;
      PlayerState?: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

export function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('브라우저 환경에서만 YouTube Player API를 사용할 수 있습니다.'));
  }
  if (window.YT && typeof window.YT.Player === 'function') {
    return Promise.resolve();
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve, reject) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube IFrame Player API 로드 시간이 초과되었습니다.'));
    }, 10000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (typeof prevCallback === 'function') {
        try {
          prevCallback();
        } catch {
          // ignore
        }
      }
      resolve();
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        ytApiPromise = null;
        reject(new Error('YouTube IFrame Player API 스크립트를 불러오지 못했습니다.'));
      };
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

export function checkDisplayCaptureSupport(): DisplayCaptureSupportInfo {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      isSecureContext: false,
      isInIframe: false,
      policyAllowed: false,
      supportsRegionCapture: false,
      reason: '브라우저 환경이 아닙니다.',
    };
  }

  const isSecureContext = Boolean(window.isSecureContext);
  const isInIframe = window.self !== window.top;
  const hasApi = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

  let policyAllowed: boolean | null = null;
  try {
    const docAny = document as unknown as {
      permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
      featurePolicy?: { allowsFeature?: (feature: string) => boolean };
    };
    const checker = docAny.permissionsPolicy?.allowsFeature
      ? docAny.permissionsPolicy
      : docAny.featurePolicy;
    if (checker?.allowsFeature) {
      policyAllowed = checker.allowsFeature('display-capture');
    }
  } catch {
    policyAllowed = null;
  }

  const supportsRegionCapture =
    typeof (window as unknown as { CropTarget?: { fromElement?: unknown } }).CropTarget?.fromElement ===
    'function';

  let reason: string | undefined;
  if (!isSecureContext) {
    reason = '보안 컨텍스트(HTTPS 또는 localhost)가 아니어서 화면 공유(getDisplayMedia)가 차단되었습니다.';
  } else if (!hasApi) {
    reason = '현재 브라우저가 화면 공유 API(getDisplayMedia)를 지원하지 않습니다. Chrome 또는 Edge 최신 버전을 권장합니다.';
  } else if (policyAllowed === false) {
    reason = isInIframe
      ? '현재 미리보기 iframe의 Permissions Policy에서 display-capture 권한이 비활성화되어 있습니다. 새 독립 브라우저 탭에서 열거나 로컬(localhost:3000)에서 실행해 주세요.'
      : '브라우저 Permissions Policy에서 display-capture가 차단되어 있습니다.';
  }

  return {
    supported: isSecureContext && hasApi && policyAllowed !== false,
    isSecureContext,
    isInIframe,
    policyAllowed,
    supportsRegionCapture,
    reason,
  };
}

function formatSecondsToMmSs(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function hammingDistanceHex(a?: string, b?: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return dist;
}

function analyzeCanvasMetrics(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  let sumLum = 0;

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    gray[i] = lum;
    sumLum += lum;
  }
  const luminanceAvg = sumLum / (w * h);

  let gradSum = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const idx = y * w + x;
      gradSum += Math.abs(gray[idx + 1] - gray[idx]) + Math.abs(gray[idx + w] - gray[idx]);
    }
  }
  const sharpnessScore = gradSum / ((w - 1) * (h - 1));

  // 8x8 perceptual signature
  const signature: number[] = [];
  const cellW = Math.max(1, Math.floor(w / 8));
  const cellH = Math.max(1, Math.floor(h / 8));
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      let cellSum = 0;
      let count = 0;
      for (let dy = 0; dy < cellH; dy++) {
        for (let dx = 0; dx < cellW; dx++) {
          const py = cy * cellH + dy;
          const px = cx * cellW + dx;
          if (py < h && px < w) {
            cellSum += gray[py * w + px];
            count++;
          }
        }
      }
      signature.push(count > 0 ? cellSum / count : 0);
    }
  }

  // 9x8 difference hash (64-bit hex) for fast duplicate detection
  const gridW = 9;
  const gridH = 8;
  const stepX = Math.max(1, Math.floor(w / gridW));
  const stepY = Math.max(1, Math.floor(h / gridH));
  const gridVals: number[] = [];
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const px = Math.min(w - 1, gx * stepX + Math.floor(stepX / 2));
      const py = Math.min(h - 1, gy * stepY + Math.floor(stepY / 2));
      gridVals.push(gray[py * w + px]);
    }
  }
  let hex = '';
  for (let gy = 0; gy < gridH; gy++) {
    let byte = 0;
    for (let gx = 0; gx < 8; gx++) {
      const left = gridVals[gy * gridW + gx];
      const right = gridVals[gy * gridW + gx + 1];
      if (left > right) byte |= 1 << (7 - gx);
    }
    hex += byte.toString(16).padStart(2, '0');
  }

  return { luminanceAvg, sharpnessScore, signature, dHash: hex };
}

function signatureDistance(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 999;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / a.length;
}

export async function startTabCaptureSession(
  playerContainer: HTMLElement | null,
  onEnded?: () => void,
): Promise<ActiveTabCaptureSession> {
  const support = checkDisplayCaptureSupport();
  if (!support.supported) {
    throw new Error(support.reason || '화면 공유(getDisplayMedia)를 시작할 수 없습니다.');
  }

  const constraints: MediaStreamConstraints & {
    preferCurrentTab?: boolean;
    selfBrowserSurface?: string;
    surfaceSwitching?: string;
  } = {
    video: {
      displaySurface: 'browser',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    } as MediaTrackConstraints,
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permissions policy') || msg.toLowerCase().includes('disallowed')) {
      throw new Error(
        '현재 실행 환경(AI Studio 미리보기 iframe)의 Permissions Policy로 인해 화면 공유가 차단되었습니다. 우측 "독립 브라우저 탭에서 열기"로 실행하거나 로컬(localhost:3000) 환경에서 실행해주세요.',
      );
    }
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new Error(
        '화면 공유 권한이 취소되었거나 브라우저/iframe 정책으로 거부되었습니다. 현재 브라우저 탭 공유를 선택하고 허용해주세요.',
      );
    }
    throw new Error(`화면 공유 시작 실패: ${msg}`);
  }

  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('공유된 화면에서 비디오 트랙을 찾을 수 없습니다.');
  }

  const settings = videoTrack.getSettings() as MediaTrackSettings & { displaySurface?: string };
  const displaySurface = settings.displaySurface || 'unknown';

  // Apply Region Capture (CropTarget) when sharing current browser tab so ONLY the YouTube player is captured
  let isCroppedByRegionApi = false;
  if (playerContainer && (displaySurface === 'browser' || displaySurface === 'unknown')) {
    try {
      const winAny = window as unknown as {
        CropTarget?: { fromElement: (el: Element) => Promise<unknown> };
      };
      const trackAny = videoTrack as unknown as {
        cropTo?: (target: unknown) => Promise<void>;
      };
      if (winAny.CropTarget?.fromElement && typeof trackAny.cropTo === 'function') {
        const cropTarget = await winAny.CropTarget.fromElement(playerContainer);
        await trackAny.cropTo(cropTarget);
        isCroppedByRegionApi = true;
      }
    } catch {
      isCroppedByRegionApi = false;
    }
  }

  const videoEl = document.createElement('video');
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(), 3000);
    videoEl.onloadedmetadata = () => {
      window.clearTimeout(timer);
      videoEl
        .play()
        .then(() => resolve())
        .catch(() => resolve());
    };
    videoEl.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('화면 공유 비디오 스트림을 초기화하지 못했습니다.'));
    };
  });

  const stop = () => {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    try {
      videoEl.srcObject = null;
    } catch {
      // ignore
    }
  };

  videoTrack.addEventListener('ended', () => {
    stop();
    onEnded?.();
  });

  return {
    stream,
    videoEl,
    isCroppedByRegionApi,
    displaySurface,
    stop,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function waitForYoutubeSeekAndPlay(
  player: YouTubePlayerLike,
  targetSeconds: number,
  targetVideoId: string,
  signal: AbortSignal,
  onStatus?: (msg: string) => void,
  overlayFadeWaitMs = 3500,
): Promise<{ ok: boolean; actualSeconds: number; skipReason?: string }> {
  if (signal.aborted) return { ok: false, actualSeconds: targetSeconds, skipReason: '사용자 중단' };

  const duration = player.getDuration?.() || 0;
  const clampedTarget =
    duration > 1 ? Math.min(duration - 0.5, Math.max(0.2, targetSeconds)) : Math.max(0.2, targetSeconds);

  try {
    player.setPlaybackQuality?.('hd1080');
  } catch {
    // ignore quality hint failure
  }

  // Seek ~3s earlier so that by the time the YouTube control bar/title fades out (~3.5s)
  // while playing, the video lands cleanly right on the target moment without pausing!
  const leadInSec = Math.max(0.2, clampedTarget - overlayFadeWaitMs / 1000);
  player.seekTo(leadInSec, true);
  player.playVideo();

  const startedAt = Date.now();
  const maxWaitMs = 16000;

  while (Date.now() - startedAt < maxWaitMs) {
    if (signal.aborted) {
      return { ok: false, actualSeconds: clampedTarget, skipReason: '사용자 중단' };
    }

    // Check if an ad is playing (never block ads; patiently wait)
    const videoData = player.getVideoData?.();
    if (videoData?.video_id && targetVideoId && videoData.video_id !== targetVideoId) {
      onStatus?.('YouTube 광고 재생 감지 — 광고 종료 대기 중 (광고 차단/우회 없음)...');
      await sleep(1000);
      continue;
    }

    const state = player.getPlayerState?.();
    const cur = player.getCurrentTime?.() ?? 0;

    // Confirm PLAYING (state === 1) near leadIn/target, then wait cleanly for player UI overlay to fade out
    if (state === 1 && cur >= leadInSec - 1.5 && cur <= clampedTarget + 4.0) {
      onStatus?.(`버퍼링 완료 · 플레이어 UI 오버레이 소멸 대기 중 (${(overlayFadeWaitMs / 1000).toFixed(1)}초)...`);
      await sleep(overlayFadeWaitMs);
      if (signal.aborted) {
        return { ok: false, actualSeconds: cur, skipReason: '사용자 중단' };
      }
      // Verify still playing smoothly after overlay fade wait (no pause icon!)
      const finalState = player.getPlayerState?.();
      const settledCur = player.getCurrentTime?.() ?? cur;
      const finalVideoId = player.getVideoData?.()?.video_id;
      if (finalState !== 1 || settledCur <= cur + 0.15 ||
          Math.abs(settledCur - clampedTarget) > 3 ||
          (finalVideoId && targetVideoId && finalVideoId !== targetVideoId)) {
        return { ok: false, actualSeconds: settledCur, skipReason: '정상 재생·시점 확인 실패' };
      }
      return { ok: true, actualSeconds: settledCur };
    }

    await sleep(250);
  }

  const finalCur = player.getCurrentTime?.() ?? clampedTarget;
  return { ok: false, actualSeconds: finalCur, skipReason: '정상 재생 확인 시간 초과' };
}

function grabPlayerCropCanvas(
  session: ActiveTabCaptureSession,
  playerContainer: HTMLElement,
): { canvas: HTMLCanvasElement; width: number; height: number } | null {
  const v = session.videoEl;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return null;

  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (!session.isCroppedByRegionApi) {
    const rect = playerContainer.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return null;

    if (session.displaySurface === 'browser' || session.displaySurface === 'unknown') {
      const scaleX = vw / Math.max(1, window.innerWidth);
      const scaleY = vh / Math.max(1, window.innerHeight);
      sx = Math.max(0, Math.round(rect.left * scaleX));
      sy = Math.max(0, Math.round(rect.top * scaleY));
      sw = Math.max(1, Math.min(vw - sx, Math.round(rect.width * scaleX)));
      sh = Math.max(1, Math.min(vh - sy, Math.round(rect.height * scaleY)));
    } else {
      const chromeOffsetX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
      const chromeOffsetY = Math.max(0, window.outerHeight - window.innerHeight - chromeOffsetX);
      const absX = rect.left + chromeOffsetX;
      const absY = rect.top + chromeOffsetY;
      const scaleX = vw / Math.max(1, window.outerWidth);
      const scaleY = vh / Math.max(1, window.outerHeight);
      sx = Math.max(0, Math.round(absX * scaleX));
      sy = Math.max(0, Math.round(absY * scaleY));
      sw = Math.max(1, Math.min(vw - sx, Math.round(rect.width * scaleX)));
      sh = Math.max(1, Math.min(vh - sy, Math.round(rect.height * scaleY)));
    }
  }

  // Never artificially upscale! Keep exact captured resolution up to 1920x1080 while preserving aspect ratio.
  const outW = Math.min(1920, sw);
  const outH = Math.max(1, Math.round((outW * sh) / sw));
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
  return { canvas: outCanvas, width: outW, height: outH };
}

export async function captureYoutubeTargetsFromSession(opts: {
  session: ActiveTabCaptureSession;
  player: YouTubePlayerLike;
  playerContainer: HTMLElement;
  youtubeVideoId: string;
  videoTitle: string;
  targets: CaptureTargetItem[];
  existingFrames?: CapturedFrame[];
  forceRecapture?: boolean;
  signal: AbortSignal;
  onExpandStage?: (expanded: boolean) => void;
  onProgress: (progress: TabCaptureProgress) => void;
  onFrameCaptured: (frame: CapturedFrame) => void;
}): Promise<{ captured: CapturedFrame[]; failedCount: number; reusedCount: number; duplicateSkippedCount: number }> {
  const {
    session,
    player,
    playerContainer,
    youtubeVideoId,
    videoTitle,
    targets,
    existingFrames = [],
    forceRecapture = false,
    signal,
    onExpandStage,
    onProgress,
    onFrameCaptured,
  } = opts;

  const metricCanvas = document.createElement('canvas');
  metricCanvas.width = 160;
  metricCanvas.height = 90;
  const metricCtx = metricCanvas.getContext('2d', { willReadFrequently: true });

  const captured: CapturedFrame[] = [];
  const acceptedSignatures: number[][] = [];
  const acceptedHashes: string[] = existingFrames
    .map((f) => f.imageHash)
    .filter((h): h is string => Boolean(h));

  let failedCount = 0;
  let reusedCount = 0;
  let duplicateSkippedCount = 0;

  const wasMuted = player.isMuted?.() ?? false;
  try {
    player.mute?.();
  } catch {
    // ignore
  }

  // Expand the player stage to large theater viewport (>=1280x720 / up to 1920x1080) BEFORE grabbing frames
  onExpandStage?.(true);
  await sleep(450);

  if (!session.isCroppedByRegionApi) {
    playerContainer.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(200);
  }

  try {
    for (let i = 0; i < targets.length; i++) {
      if (signal.aborted) break;
      const target = targets[i];
      const targetLabelTs = formatSecondsToMmSs(target.timestampSeconds);

      // Reuse already-captured crisp frame from current state or IndexedDB cache if same timestamp (<= 3s)
      if (!forceRecapture) {
        const cachedHit = existingFrames.find(
          (f) =>
            Math.abs(f.timestampSeconds - target.timestampSeconds) <= 3 &&
            (f.sourceUrl?.includes(youtubeVideoId) || f.id.includes(youtubeVideoId)) &&
            f.width >= 960,
        );
        if (cachedHit) {
          reusedCount++;
          onProgress({
            total: targets.length,
            processed: i + 1,
            successCount: captured.length + reusedCount,
            failedCount,
            currentTimestamp: cachedHit.timestampFormatted,
            progressPercent:
              targets.length > 0
                ? Math.round(((captured.length + reusedCount) / targets.length) * 100)
                : 0,
            statusMessage: `시점 ${targetLabelTs}: 기존 고화질 캐시(${cachedHit.width}×${cachedHit.height}) 재사용 — 중복 캡처 생략`,
          });
          continue;
        }
      }

      onProgress({
        total: targets.length,
        processed: i,
        successCount: captured.length + reusedCount,
        failedCount,
        currentTimestamp: targetLabelTs,
        progressPercent:
          targets.length > 0
            ? Math.round(((captured.length + reusedCount) / targets.length) * 100)
            : 0,
        statusMessage: `시점 ${targetLabelTs}로 플레이어 이동 및 고해상도 로딩 확인 중...`,
      });

      const candidateOffsets = [0, 1.5, -1.5];
      let best: {
        actualSeconds: number;
        dataUrl: string;
        width: number;
        height: number;
        luminanceAvg: number;
        sharpnessScore: number;
        signature: number[];
        dHash: string;
      } | null = null;

      for (let oIdx = 0; oIdx < candidateOffsets.length; oIdx++) {
        const offset = candidateOffsets[oIdx];
        if (signal.aborted) break;
        const seekTarget = Math.max(0.2, target.timestampSeconds + offset);
        const seekRes = await waitForYoutubeSeekAndPlay(
          player,
          seekTarget,
          youtubeVideoId,
          signal,
          (msg) =>
            onProgress({
              total: targets.length,
              processed: i,
              successCount: captured.length + reusedCount,
              failedCount,
              currentTimestamp: targetLabelTs,
              progressPercent:
                targets.length > 0
                  ? Math.round(((captured.length + reusedCount) / targets.length) * 100)
                  : 0,
              statusMessage: msg,
            }),
          3500,
        );

        if (!seekRes.ok) continue;

        const grabbed = grabPlayerCropCanvas(session, playerContainer);
        if (!grabbed || !metricCtx) continue;

        metricCtx.drawImage(grabbed.canvas, 0, 0, 160, 90);
        const m = analyzeCanvasMetrics(metricCtx, 160, 90);

        // Reject black screen, white flash, or extremely blurry/loading frames
        if (m.luminanceAvg < 12 || m.luminanceAvg > 246 || m.sharpnessScore < 1.5) {
          continue;
        }

        const dataUrl = grabbed.canvas.toDataURL('image/png');
        if (!best || m.sharpnessScore > best.sharpnessScore) {
          best = {
            actualSeconds: seekRes.actualSeconds,
            dataUrl,
            width: grabbed.width,
            height: grabbed.height,
            luminanceAvg: m.luminanceAvg,
            sharpnessScore: m.sharpnessScore,
            signature: m.signature,
            dHash: m.dHash,
          };
        }

        const isDupFirst =
          acceptedSignatures.some((sig) => signatureDistance(sig, m.signature) < 6.5) ||
          acceptedHashes.some((h) => hammingDistanceHex(h, m.dHash) <= 6);
        if (oIdx === 0 && m.sharpnessScore >= 3.5 && !isDupFirst) {
          break;
        }
      }

      if (!best) {
        failedCount++;
        onProgress({
          total: targets.length,
          processed: i + 1,
          successCount: captured.length + reusedCount,
          failedCount,
          currentTimestamp: targetLabelTs,
          progressPercent:
            targets.length > 0
              ? Math.round(((captured.length + reusedCount) / targets.length) * 100)
              : 0,
          statusMessage: `시점 ${targetLabelTs}: 검은 화면/흐림/로딩으로 제외되었습니다.`,
        });
        continue;
      }

      const isDuplicate =
        !forceRecapture &&
        (acceptedSignatures.some((sig) => signatureDistance(sig, best!.signature) < 6.5) ||
          acceptedHashes.some((h) => hammingDistanceHex(h, best!.dHash) <= 6));

      if (isDuplicate && (captured.length > 0 || acceptedHashes.length > 0)) {
        duplicateSkippedCount++;
        failedCount++;
        onProgress({
          total: targets.length,
          processed: i + 1,
          successCount: captured.length + reusedCount,
          failedCount,
          currentTimestamp: targetLabelTs,
          progressPercent:
            targets.length > 0
              ? Math.round(((captured.length + reusedCount) / targets.length) * 100)
              : 0,
          statusMessage: `시점 ${targetLabelTs}: 기존 이미지와 유사한 중복 화면이므로 제외했습니다.`,
        });
        continue;
      }

      acceptedSignatures.push(best.signature);
      acceptedHashes.push(best.dHash);
      const actualFormatted = formatSecondsToMmSs(best.actualSeconds);
      const frame: CapturedFrame = {
        id: `frame-yt-${youtubeVideoId}-${Math.round(best.actualSeconds)}`,
        timestampSeconds: Number(best.actualSeconds.toFixed(1)),
        timestampFormatted: actualFormatted,
        imageDataUrl: best.dataUrl,
        width: best.width,
        height: best.height,
        sharpnessScore: Number(best.sharpnessScore.toFixed(2)),
        luminanceAvg: Number(best.luminanceAvg.toFixed(1)),
        imageHash: best.dHash,
        sourceType: 'youtube-tab-capture',
        sourceLabel: `${videoTitle} · ${actualFormatted}`,
        sourceUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}&t=${Math.round(best.actualSeconds)}s`,
        visualSummary: target.label,
      };

      captured.push(frame);
      onFrameCaptured(frame);

      onProgress({
        total: targets.length,
        processed: i + 1,
        successCount: captured.length + reusedCount,
        failedCount,
        currentTimestamp: actualFormatted,
        progressPercent:
          targets.length > 0
            ? Math.round(((captured.length + reusedCount) / targets.length) * 100)
            : 0,
        statusMessage: `시점 ${actualFormatted} PNG 캡처 완료 (${frame.width}×${frame.height})`,
      });
    }
  } finally {
    onExpandStage?.(false);
    try {
      player.pauseVideo?.();
      if (!wasMuted) {
        player.unMute?.();
      }
    } catch {
      // ignore
    }
  }

  return { captured, failedCount, reusedCount, duplicateSkippedCount };
}
