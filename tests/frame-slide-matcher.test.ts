import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CapturedFrame, LectureSlide } from '../src/types/lecture';
import { dedupeCapturedFrames, matchFramesToSlides, supportsVideoFrame } from '../src/utils/frameSlideMatcher';

function frame(id: string, t: number, tag: string, extra: Partial<CapturedFrame> = {}): CapturedFrame {
  return {
    id, timestampSeconds: t, timestampFormatted: String(t),
    imageDataUrl: 'data:image/png;base64,AA==', // Synthetic matching fixture; not an actual video image.
    width: 1920, height: 1080, sharpnessScore: 20, luminanceAvg: 100,
    sourceType: 'youtube-tab-capture', sourceLabel: 'fixture',
    visualSummary: tag, visionObservedText: tag, visionTags: [tag],
    captureQualityVersion: 2, ...extra,
  };
}

function slide(i: number, t: number, tag: string, extra: Partial<LectureSlide> = {}): LectureSlide {
  return {
    slideNumber: i, section: 'fixture', titleKo: tag, titleEn: '',
    bullets: [tag], captureTimestamp: String(t), captureSeconds: t,
    captureGuideText: tag, videoBasedPoints: tag, slideType: 'image-left-text',
    estimatedMinutes: 1, equationLatex: '', matrixNote: '', diagramPreset: 'none',
    diagramCaption: '', sourceBoundary: 'video-only', sourceTier: 'A',
    supplementaryPoints: '', speakerScript: '', ...extra,
  };
}

test('13 different relevant frame IDs reach 13 slides without duplication', () => {
  const frames = Array.from({ length: 13 }, (_, i) => frame('f' + i, 20 + i * 30, 'concept' + i));
  const slides = frames.map((f, i) => slide(i + 1, f.timestampSeconds, 'concept' + i));
  const result = matchFramesToSlides(slides, frames, []);
  assert.deepEqual(result.map(s => s.capturedFrameIds), frames.map(f => [f.id]));
  assert.equal(new Set(result.flatMap(s => s.capturedFrameIds)).size, 13);
});

test('agenda cannot acquire a video frame', () => {
  const agenda = slide(1, 20, 'concept0', { slideType: 'agenda' });
  assert.equal(supportsVideoFrame(agenda), false);
  assert.deepEqual(matchFramesToSlides([agenda], [frame('f0', 20, 'concept0')], [])[0].capturedFrameIds, []);
});

test('the same frame is not assigned repeatedly', () => {
  const slides = [slide(1, 20, 'concept0'), slide(2, 20, 'concept0')];
  assert.deepEqual(matchFramesToSlides(slides, [frame('f0', 20, 'concept0')], []).map(s => s.capturedFrameIds), [['f0'], []]);
});

test('unrelated inspected frame is not assigned solely by timestamp', () => {
  assert.deepEqual(matchFramesToSlides([slide(1, 20, 'unrelated')], [frame('f0', 20, 'concept0')], [])[0].capturedFrameIds, []);
});

test('empty input removes stale frame references', () => {
  assert.deepEqual(matchFramesToSlides([slide(1, 20, 'concept0', { capturedFrameIds: ['stale'] })], [], [])[0].capturedFrameIds, []);
});

test('revised capture supersedes legacy duplicate', () => {
  const old = frame('old', 20, 'concept0', { captureQualityVersion: undefined, sharpnessScore: 90 });
  const fresh = frame('new', 21, 'concept0', { sharpnessScore: 5 });
  assert.equal(dedupeCapturedFrames([old, fresh]).unique[0].id, 'new');
});
