import type { CapturedFrame } from '../types/lecture';

export interface FrameExtractionTarget {
  timestampSeconds: number;
  label: string;
}

function formatSecondsToMmSs(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
      gradSum +=
        Math.abs(gray[idx + 1] - gray[idx]) + Math.abs(gray[idx + w] - gray[idx]);
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

  // 9x8 difference hash (64-bit hex)
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
  let dHash = '';
  for (let gy = 0; gy < gridH; gy++) {
    let byte = 0;
    for (let gx = 0; gx < 8; gx++) {
      if (gridVals[gy * gridW + gx] > gridVals[gy * gridW + gx + 1]) {
        byte |= 1 << (7 - gx);
      }
    }
    dHash += byte.toString(16).padStart(2, '0');
  }

  return { luminanceAvg, sharpnessScore, signature, dHash };
}

function signatureDistance(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 999;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / a.length;
}

async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(video.duration || timeSec, timeSec));
    if (Math.abs(video.currentTime - target) < 0.04 && video.readyState >= 2) {
      resolve();
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    }, 3500);

    const onSeeked = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('영상 프레임 탐색 중 오류가 발생했습니다.'));
      }
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = target;
  });
}

async function loadVideoElement(file: File): Promise<{ video: HTMLVideoElement; objectUrl: string }> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('브라우저에서 해당 MP4/WebM 코덱을 디코딩할 수 없습니다. 서버 FFmpeg 추출 모드를 이용해주세요.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
  });

  return { video, objectUrl };
}

export async function extractFramesClientSide(
  file: File,
  targets: FrameExtractionTarget[],
  sourceLabelPrefix: string,
  onProgress?: (current: number, total: number) => void,
): Promise<CapturedFrame[]> {
  const { video, objectUrl } = await loadVideoElement(file);
  const natW = video.videoWidth || 1280;
  const natH = video.videoHeight || 720;
  const duration = video.duration || 3600;
  const maxSec = Math.max(0.5, duration - 0.25);

  // Full-aspect export canvas (cap width at 1280px, preserve original aspect ratio)
  const outW = Math.min(1280, natW);
  const outH = Math.max(1, Math.round((outW * natH) / natW));
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');

  const metricCanvas = document.createElement('canvas');
  metricCanvas.width = 160;
  metricCanvas.height = 90;
  const metricCtx = metricCanvas.getContext('2d', { willReadFrequently: true });

  const results: CapturedFrame[] = [];
  const acceptedSignatures: number[][] = [];

  try {
    if (!outCtx || !metricCtx) {
      throw new Error('Canvas 2D 컨텍스트를 초기화할 수 없습니다.');
    }

    for (let i = 0; i < targets.length; i++) {
      onProgress?.(i + 1, targets.length);
      const baseTs = Math.min(maxSec, Math.max(0.2, targets[i].timestampSeconds));
      const candidateOffsets = [0, -1.5, 1.5];

      let best: {
        ts: number;
        dataUrl: string;
        luminanceAvg: number;
        sharpnessScore: number;
        signature: number[];
        dHash: string;
      } | null = null;

      for (const offset of candidateOffsets) {
        const ts = Math.min(maxSec, Math.max(0.2, baseTs + offset));
        await seekVideo(video, ts);
        metricCtx.drawImage(video, 0, 0, 160, 90);
        const m = analyzeCanvasMetrics(metricCtx, 160, 90);

        if (m.luminanceAvg < 12 || m.luminanceAvg > 246) {
          continue;
        }

        if (!best || m.sharpnessScore > best.sharpnessScore) {
          outCtx.drawImage(video, 0, 0, outW, outH);
          const dataUrl = outCanvas.toDataURL('image/png');
          best = {
            ts,
            dataUrl,
            luminanceAvg: m.luminanceAvg,
            sharpnessScore: m.sharpnessScore,
            signature: m.signature,
            dHash: m.dHash,
          };
        }
      }

      if (!best) continue;

      const isDup = acceptedSignatures.some((sig) => signatureDistance(sig, best!.signature) < 6.0);
      if (isDup && results.length > 0) {
        const altTs = Math.min(maxSec, baseTs + 3.0);
        await seekVideo(video, altTs);
        metricCtx.drawImage(video, 0, 0, 160, 90);
        const m = analyzeCanvasMetrics(metricCtx, 160, 90);
        if (
          m.luminanceAvg >= 12 &&
          m.luminanceAvg <= 246 &&
          acceptedSignatures.every((sig) => signatureDistance(sig, m.signature) >= 6.0)
        ) {
          outCtx.drawImage(video, 0, 0, outW, outH);
          best = {
            ts: altTs,
            dataUrl: outCanvas.toDataURL('image/png'),
            luminanceAvg: m.luminanceAvg,
            sharpnessScore: m.sharpnessScore,
            signature: m.signature,
            dHash: m.dHash,
          };
        }
      }

      acceptedSignatures.push(best.signature);
      const formatted = formatSecondsToMmSs(best.ts);
      results.push({
        id: `frame-local-${i + 1}-${Math.round(best.ts)}`,
        timestampSeconds: Number(best.ts.toFixed(1)),
        timestampFormatted: formatted,
        imageDataUrl: best.dataUrl,
        width: outW,
        height: outH,
        sharpnessScore: Number(best.sharpnessScore.toFixed(2)),
        luminanceAvg: Number(best.luminanceAvg.toFixed(1)),
        imageHash: best.dHash,
        sourceType: 'mp4-local',
        sourceLabel: `${sourceLabelPrefix} · ${formatted}`,
        visualSummary: targets[i].label,
      });
    }

    return results;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function extractSingleFrameClientSide(
  file: File,
  timestampSeconds: number,
  sourceLabelPrefix: string,
  visualSummary: string,
): Promise<CapturedFrame | null> {
  const frames = await extractFramesClientSide(
    file,
    [{ timestampSeconds, label: visualSummary }],
    sourceLabelPrefix,
  );
  return frames[0] ?? null;
}
