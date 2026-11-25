import type { CapturedFrame, LectureSlide, SceneAnalysis } from '../types/lecture';
import { hammingDistanceHex } from './youtubeTabCapture';

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\u3131-\uD79D\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function keywordOverlapScore(slideText: string, frameText: string): number {
  const a = new Set(tokenize(slideText));
  const b = new Set(tokenize(frameText));
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const token of a) {
    if (b.has(token)) hits++;
  }
  return hits / Math.max(1, Math.min(a.size, b.size));
}

/**
 * Deduplicates captured frames by:
 * 1) Timestamp proximity (<= 3s) for the same video/source
 * 2) Perceptual 64-bit dHash Hamming distance (<= 6)
 * Keeps the highest-resolution & sharpest frame when duplicates collide.
 */
export function dedupeCapturedFrames(frames: CapturedFrame[]): {
  unique: CapturedFrame[];
  removedCount: number;
} {
  if (frames.length <= 1) return { unique: frames, removedCount: 0 };

  const sortedByQuality = [...frames].sort((a, b) => {
    const areaDiff = b.width * b.height - a.width * a.height;
    if (Math.abs(areaDiff) > 50_000) return areaDiff;
    return (b.sharpnessScore || 0) - (a.sharpnessScore || 0);
  });

  const kept: CapturedFrame[] = [];
  let removedCount = 0;

  for (const candidate of sortedByQuality) {
    const isDuplicate = kept.some((existing) => {
      const sameTime = Math.abs(existing.timestampSeconds - candidate.timestampSeconds) <= 3;
      const similarHash =
        Boolean(existing.imageHash && candidate.imageHash) &&
        hammingDistanceHex(existing.imageHash, candidate.imageHash) <= 6;
      return sameTime || similarHash;
    });

    if (isDuplicate) {
      removedCount++;
    } else {
      kept.push(candidate);
    }
  }

  kept.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  return { unique: kept, removedCount };
}

/**
 * Matches captured real video frames to slides based on:
 * 1) Gemini Vision observed text & tags when available (highest semantic authority)
 * 2) Timestamp proximity to slide.captureSeconds
 * 3) Semantic/keyword overlap between slide content and frame/scene descriptions
 * 4) Diversity penalty to avoid repeating the exact same image across consecutive slides
 * 5) Multi-capture selection (2-4 frames) for 'multi-capture-compare' slides
 * 6) Preserving diagram-only slides when captureTimestamp is '해당 없음'
 */
export function matchFramesToSlides(
  slides: LectureSlide[],
  frames: CapturedFrame[],
  scenes: SceneAnalysis[],
): LectureSlide[] {
  if (frames.length === 0) return slides;

  const usageCounts = new Map<string, number>();

  return slides.map((slide) => {
    const hasExplicitTimestamp =
      Boolean(slide.captureTimestamp) && slide.captureTimestamp !== '해당 없음';

    const slideQueryText = [
      slide.titleKo || '',
      slide.titleEn || '',
      slide.captureGuideText || '',
      slide.videoBasedPoints || '',
      ...(Array.isArray(slide.bullets) ? slide.bullets : []),
    ].join(' ');

    // Pure theory/conceptual slides with no video capture reference keep diagrams unless multi-capture
    if (!hasExplicitTimestamp && slide.slideType !== 'multi-capture-compare') {
      return {
        ...slide,
        capturedFrameIds: [],
      };
    }

    const scored = frames.map((frame) => {
      const nearestScene = scenes.reduce<SceneAnalysis | null>((best, sc) => {
        if (!best) return sc;
        return Math.abs(sc.captureSeconds - frame.timestampSeconds) <
          Math.abs(best.captureSeconds - frame.timestampSeconds)
          ? sc
          : best;
      }, null);

      const visionText = [
        frame.visionObservedText || '',
        ...(frame.visionTags || []),
      ]
        .join(' ')
        .trim();

      const frameContextText = [
        frame.visualSummary,
        nearestScene?.title || '',
        nearestScene?.visualDiagramsAndEquations || '',
        nearestScene?.screenComposition || '',
      ].join(' ');

      const timeDiff = hasExplicitTimestamp
        ? Math.abs(frame.timestampSeconds - slide.captureSeconds)
        : 999;

      const timeScore = hasExplicitTimestamp ? Math.max(0, 1 - timeDiff / 24) : 0;
      const contextScore = keywordOverlapScore(slideQueryText, frameContextText);
      const visionScore = visionText ? keywordOverlapScore(slideQueryText, visionText) : null;
      const sharpnessBonus = Math.min(0.15, (frame.sharpnessScore || 0) * 0.02);
      const repeatPenalty = (usageCounts.get(frame.id) || 0) * 0.25;

      // When Gemini Vision inspected the actual frame, heavily prioritize actual visual content over raw timestamp
      const totalScore =
        visionScore !== null
          ? visionScore * 0.55 + contextScore * 0.2 + timeScore * 0.25 + sharpnessBonus - repeatPenalty
          : timeScore * 0.5 + contextScore * 0.5 + sharpnessBonus - repeatPenalty;

      return { frame, timeDiff, totalScore, visionScore };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    if (slide.slideType === 'multi-capture-compare') {
      const picked = scored.slice(0, Math.min(4, scored.length)).map((x) => x.frame.id);
      picked.forEach((id) => usageCounts.set(id, (usageCounts.get(id) || 0) + 1));
      return {
        ...slide,
        capturedFrameIds: picked,
      };
    }

    const best = scored[0];
    if (!best || (best.timeDiff > 28 && best.totalScore < 0.14)) {
      return {
        ...slide,
        capturedFrameIds: [],
      };
    }

    usageCounts.set(best.frame.id, (usageCounts.get(best.frame.id) || 0) + 1);
    return {
      ...slide,
      capturedFrameIds: [best.frame.id],
    };
  });
}
