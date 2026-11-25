import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import type { CapturedFrame } from '../src/types/lecture.ts';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';

export interface FrameTarget {
  timestampSeconds: number;
  label: string;
}

function formatSecondsToMmSs(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function probeVideoMetadata(filePath: string): Promise<{
  durationSeconds: number;
  width: number;
  height: number;
}> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const duration = Number(parsed.format?.duration ?? 0);
    return {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
      width: stream?.width ?? 1280,
      height: stream?.height ?? 720,
    };
  } catch {
    return { durationSeconds: 0, width: 1280, height: 720 };
  }
}

interface FrameQualityMetrics {
  luminanceAvg: number;
  sharpnessScore: number;
  signature: number[];
}

function parsePpmMetrics(ppmBuf: Buffer): FrameQualityMetrics {
  // Parse P6 binary PPM header: P6\n<w> <h>\n255\n<RGB bytes>
  let offset = 0;
  let tokens: string[] = [];
  let current = '';

  while (offset < ppmBuf.length && tokens.length < 4) {
    const byte = ppmBuf[offset++];
    if (byte === 35) {
      // '#' comment until newline
      while (offset < ppmBuf.length && ppmBuf[offset] !== 10) offset++;
      continue;
    }
    if (byte === 9 || byte === 10 || byte === 13 || byte === 32) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += String.fromCharCode(byte);
    }
  }

  const width = Number(tokens[1]) || 160;
  const height = Number(tokens[2]) || 90;
  const pixelStart = offset;
  const expected = width * height * 3;
  if (pixelStart + expected > ppmBuf.length) {
    return { luminanceAvg: 128, sharpnessScore: 10, signature: [] };
  }

  const gray = new Float32Array(width * height);
  let sumLum = 0;
  for (let i = 0; i < width * height; i++) {
    const idx = pixelStart + i * 3;
    const lum =
      0.299 * ppmBuf[idx] + 0.587 * ppmBuf[idx + 1] + 0.114 * ppmBuf[idx + 2];
    gray[i] = lum;
    sumLum += lum;
  }
  const luminanceAvg = sumLum / (width * height);

  // Spatial gradient sharpness metric
  let gradSum = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      gradSum +=
        Math.abs(gray[idx + 1] - gray[idx]) + Math.abs(gray[idx + width] - gray[idx]);
    }
  }
  const sharpnessScore = gradSum / ((width - 1) * (height - 1));

  // 8x8 pooled signature for near-duplicate rejection
  const signature: number[] = [];
  const cellW = Math.max(1, Math.floor(width / 8));
  const cellH = Math.max(1, Math.floor(height / 8));
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      let cellSum = 0;
      let count = 0;
      for (let dy = 0; dy < cellH; dy++) {
        for (let dx = 0; dx < cellW; dx++) {
          const py = cy * cellH + dy;
          const px = cx * cellW + dx;
          if (py < height && px < width) {
            cellSum += gray[py * width + px];
            count++;
          }
        }
      }
      signature.push(count > 0 ? cellSum / count : 0);
    }
  }

  return { luminanceAvg, sharpnessScore, signature };
}

function signatureDistance(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 999;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / a.length;
}

async function extractSingleFrameFiles(
  videoPath: string,
  timestampSec: number,
  outJpgPath: string,
  outPpmPath: string,
): Promise<boolean> {
  try {
    const safeTs = Math.max(0, Number(timestampSec.toFixed(2)));
    await execFileAsync(
      FFMPEG_BIN,
      [
        '-y',
        '-ss',
        String(safeTs),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-vf',
        'scale=1280:-2',
        outJpgPath,
      ],
      { timeout: 15_000 },
    );

    await execFileAsync(
      FFMPEG_BIN,
      [
        '-y',
        '-ss',
        String(safeTs),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=160:90',
        '-f',
        'image2',
        '-vcodec',
        'ppm',
        outPpmPath,
      ],
      { timeout: 10_000 },
    );

    return fs.existsSync(outJpgPath) && fs.existsSync(outPpmPath);
  } catch {
    return false;
  }
}

export async function extractBestFramesFromMp4(
  videoPath: string,
  targets: FrameTarget[],
  sourceLabelPrefix: string,
): Promise<CapturedFrame[]> {
  const meta = await probeVideoMetadata(videoPath);
  const maxSec = meta.durationSeconds > 1 ? meta.durationSeconds - 0.3 : 3600;

  const tempDir = await fs.promises.mkdtemp(path.join(path.dirname(videoPath), 'frames-'));
  const acceptedFrames: CapturedFrame[] = [];
  const acceptedSignatures: number[][] = [];

  try {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const baseTs = Math.min(maxSec, Math.max(0.2, target.timestampSeconds));
      const candidateOffsets = [0, -1.5, 1.5];

      let bestCandidate: {
        ts: number;
        jpgBuf: Buffer;
        metrics: FrameQualityMetrics;
      } | null = null;

      for (let cIdx = 0; cIdx < candidateOffsets.length; cIdx++) {
        const ts = Math.min(maxSec, Math.max(0.2, baseTs + candidateOffsets[cIdx]));
        const jpgPath = path.join(tempDir, `f_${i}_${cIdx}.jpg`);
        const ppmPath = path.join(tempDir, `f_${i}_${cIdx}.ppm`);

        const ok = await extractSingleFrameFiles(videoPath, ts, jpgPath, ppmPath);
        if (!ok) continue;

        const [jpgBuf, ppmBuf] = await Promise.all([
          fs.promises.readFile(jpgPath),
          fs.promises.readFile(ppmPath),
        ]);
        const metrics = parsePpmMetrics(ppmBuf);

        // Skip pitch-black or overexposed white transition frames
        if (metrics.luminanceAvg < 12 || metrics.luminanceAvg > 246) {
          continue;
        }

        if (!bestCandidate || metrics.sharpnessScore > bestCandidate.metrics.sharpnessScore) {
          bestCandidate = { ts, jpgBuf, metrics };
        }
      }

      if (!bestCandidate) continue;

      // Check near-duplicate against already extracted frames (allow if sharpness is substantially different or > 4.5 L1 diff)
      const isDuplicate = acceptedSignatures.some(
        (sig) => signatureDistance(sig, bestCandidate!.metrics.signature) < 4.0,
      );
      if (isDuplicate && acceptedFrames.length > 0) {
        // Still try +3s offset once to avoid duplicate if possible
        const altTs = Math.min(maxSec, baseTs + 3.0);
        const altJpg = path.join(tempDir, `f_${i}_alt.jpg`);
        const altPpm = path.join(tempDir, `f_${i}_alt.ppm`);
        if (await extractSingleFrameFiles(videoPath, altTs, altJpg, altPpm)) {
          const [jpgBuf, ppmBuf] = await Promise.all([
            fs.promises.readFile(altJpg),
            fs.promises.readFile(altPpm),
          ]);
          const metrics = parsePpmMetrics(ppmBuf);
          if (
            metrics.luminanceAvg >= 12 &&
            metrics.luminanceAvg <= 246 &&
            acceptedSignatures.every((sig) => signatureDistance(sig, metrics.signature) >= 4.0)
          ) {
            bestCandidate = { ts: altTs, jpgBuf, metrics };
          }
        }
      }

      acceptedSignatures.push(bestCandidate.metrics.signature);
      const formatted = formatSecondsToMmSs(bestCandidate.ts);
      acceptedFrames.push({
        id: `frame-ffmpeg-${i + 1}-${Math.round(bestCandidate.ts)}`,
        timestampSeconds: Number(bestCandidate.ts.toFixed(1)),
        timestampFormatted: formatted,
        imageDataUrl: `data:image/jpeg;base64,${bestCandidate.jpgBuf.toString('base64')}`,
        width: meta.width,
        height: meta.height,
        sharpnessScore: Number(bestCandidate.metrics.sharpnessScore.toFixed(2)),
        luminanceAvg: Number(bestCandidate.metrics.luminanceAvg.toFixed(1)),
        sourceType: 'mp4-ffmpeg',
        sourceLabel: `${sourceLabelPrefix} · ${formatted}`,
        visualSummary: target.label,
      });
    }

    return acceptedFrames;
  } finally {
    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
