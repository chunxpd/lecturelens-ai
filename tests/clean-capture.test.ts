import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CapturedFrame } from '../src/types/lecture';
import { youtubeCaptureProfile, isReusableYoutubeFrame, YOUTUBE_CAPTURE_QUALITY_VERSION } from '../src/utils/youtubeTabCapture';

const frame = {
  id: 'frame-yt-example1234-15',
  sourceType: 'youtube-tab-capture',
  captureQualityVersion: YOUTUBE_CAPTURE_QUALITY_VERSION,
  captureProfile: youtubeCaptureProfile(true, true),
} as CapturedFrame;

test('clean capture cache is used only for the matching video and settings', () => {
  assert.equal(isReusableYoutubeFrame(frame, 'example1234', true, true), true);
  assert.equal(isReusableYoutubeFrame(frame, 'example1234', false, true), false);
  assert.equal(isReusableYoutubeFrame(frame, 'example1234', true, false), false);
  assert.equal(isReusableYoutubeFrame(frame, 'different12', true, true), false);
});

test('legacy frames with old UI overlays cannot be reused', () => {
  assert.equal(isReusableYoutubeFrame({ ...frame, captureQualityVersion: 2 }, 'example1234', true, true), false);
  assert.equal(isReusableYoutubeFrame({ ...frame, captureProfile: undefined }, 'example1234', true, true), false);
});
