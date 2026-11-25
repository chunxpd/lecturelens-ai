import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SceneAnalysis } from '../src/types/lecture.ts';
import { buildVideoSlidePlan, isVideoFaithful } from '../server/videoFaithful.ts';

const scene = (n: number): SceneAnalysis => ({
  id: 'scene-' + n, sceneNumber: n, title: '기능 ' + n,
  startTime: '00:00', endTime: '00:30', startSeconds: n * 30,
  captureTimestamp: '00:10', captureSeconds: n * 30 + 10,
  screenComposition: '기능 시연', visualDiagramsAndEquations: '',
  onScreenTextAndSubtitles: '', audioCoreSummary: '기능 설명',
  captureGuide: '시연 화면', capturePriority: 'medium',
  observedInVideo: ['영상 근거'], supplementaryForStudents: [], unverifiedOrAmbiguous: '',
});

test('academic mode remains the default behavior', () => {
  assert.equal(isVideoFaithful({ contentMode: 'academic' }), false);
  assert.equal(isVideoFaithful({ contentMode: 'video-faithful' }), true);
});

test('14 observed scenes produce 17 slides with no fabricated fill slides', () => {
  const scenes = Array.from({ length: 14 }, (_, i) => scene(i + 1)).reverse();
  const plan = buildVideoSlidePlan(scenes, { slideCountMode: 'auto', targetSlideCount: 25 });
  assert.equal(plan.length, 17);
  assert.equal(plan[0].role, 'cover');
  assert.equal(plan.at(-2)?.role, 'summary');
  assert.equal(plan.at(-1)?.role, 'references');
  assert.deepEqual(plan.filter(s => s.role === 'scene').map(s => s.anchor?.sceneNumber), Array.from({ length: 14 }, (_, i) => i + 1));
});

test('a manually specified large count does not invent missing scenes', () => {
  assert.equal(buildVideoSlidePlan([scene(1), scene(2)], { slideCountMode: 'custom', targetSlideCount: 25 }).length, 5);
});

test('a small manual cap groups all source scenes chronologically', () => {
  const plan = buildVideoSlidePlan(Array.from({ length: 14 }, (_, i) => scene(i + 1)), { slideCountMode: 'custom', targetSlideCount: 8 });
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.flatMap(s => s.scenes.map(x => x.sceneNumber)), Array.from({ length: 14 }, (_, i) => i + 1));
});

test('empty scene list cannot produce invented content', () => {
  assert.throws(() => buildVideoSlidePlan([], { slideCountMode: 'auto', targetSlideCount: 25 }));
});
