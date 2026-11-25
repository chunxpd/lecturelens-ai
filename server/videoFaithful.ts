import type { LectureConfig, SceneAnalysis } from '../src/types/lecture.ts';

export type VideoSlideSlot = {
  slideNumber: number;
  role: 'cover' | 'scene' | 'summary' | 'references';
  scenes: SceneAnalysis[];
  anchor?: SceneAnalysis;
};

export function isVideoFaithful(config: Pick<LectureConfig, 'contentMode'>): boolean {
  return config.contentMode === 'video-faithful';
}

/** Keep chronological evidence together, with at most one slide per scene in auto mode.
 * A requested count is a ceiling in this mode; never invent scenes to fill it.
 */
export function buildVideoSlidePlan(scenes: SceneAnalysis[], config: Pick<LectureConfig, 'slideCountMode' | 'targetSlideCount'>): VideoSlideSlot[] {
  const ordered = [...scenes].filter(s => Number.isFinite(s.captureSeconds) && s.captureSeconds >= 0)
    .sort((a, b) => a.startSeconds - b.startSeconds || a.captureSeconds - b.captureSeconds);
  if (!ordered.length) throw new Error('영상에서 확인한 장면이 없어 영상 충실형 강의자료를 생성할 수 없습니다.');
  const requested = config.slideCountMode === 'custom'
    ? Math.min(60, Math.max(8, Math.round(config.targetSlideCount || 25))) : 32;
  const bodyCount = Math.max(1, Math.min(29, ordered.length, requested - 3));
  const slots: VideoSlideSlot[] = [{ slideNumber: 1, role: 'cover', scenes: [] }];
  for (let i = 0; i < bodyCount; i++) {
    const group = ordered.slice(Math.floor(i * ordered.length / bodyCount), Math.floor((i + 1) * ordered.length / bodyCount));
    slots.push({ slideNumber: slots.length + 1, role: 'scene', scenes: group, anchor: group[0] });
  }
  slots.push({ slideNumber: slots.length + 1, role: 'summary', scenes: [] });
  slots.push({ slideNumber: slots.length + 1, role: 'references', scenes: [] });
  return slots;
}
