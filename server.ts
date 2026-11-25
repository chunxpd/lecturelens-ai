import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import { Type } from '@google/genai';
import {
  DEFAULT_LECTURE_CONFIG,
  type LectureConfig,
  type LectureSlide,
  type ReferenceThemeProfile,
} from './src/types/lecture.ts';
import { extractBestFramesFromMp4 } from './server/frameExtractor.ts';
import {
  FREE_FLASH_CANDIDATES,
  callGenerateContentWithRetry,
  formatGeminiError,
  getCachedActiveModel,
  getGeminiClient,
  listAvailableModels,
  runConnectionAndModelProbe,
  runMultimodalAnalysisPipeline,
  sendSse,
} from './server/geminiPipeline.ts';

const PORT = 3000;

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
]);

function extractYoutubeVideoId(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  let candidateId: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    candidateId = seg ?? null;
  } else if (parsed.pathname === '/watch') {
    candidateId = parsed.searchParams.get('v');
  } else if (
    parsed.pathname.startsWith('/embed/') ||
    parsed.pathname.startsWith('/shorts/') ||
    parsed.pathname.startsWith('/live/')
  ) {
    const seg = parsed.pathname.split('/').filter(Boolean)[1];
    candidateId = seg ?? null;
  }

  if (!candidateId || !/^[a-zA-Z0-9_-]{11}$/.test(candidateId)) {
    return null;
  }

  return candidateId;
}

async function fetchYoutubeOembed(
  canonicalUrl: string,
): Promise<{ title?: string; author_name?: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    return {
      title: typeof data.title === 'string' ? data.title : undefined,
      author_name: typeof data.author_name === 'string' ? data.author_name : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mergeConfig(raw: unknown): LectureConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_LECTURE_CONFIG;
  return {
    ...DEFAULT_LECTURE_CONFIG,
    ...(raw as Partial<LectureConfig>),
  };
}

async function parsePptxTemplateBuffer(buf: Buffer, fileName: string): Promise<ReferenceThemeProfile> {
  const zip = await JSZip.loadAsync(buf);

  let primaryColor = '1E3A8A';
  let accentColor = '0F766E';
  let backgroundColor = 'FFFFFF';
  let headingFont = '맑은 고딕';
  let bodyFont = '맑은 고딕';

  const themeFile = zip.file('ppt/theme/theme1.xml');
  if (themeFile) {
    const themeXml = await themeFile.async('text');
    const dk1Match = themeXml.match(/<a:dk1>[\s\S]*?val="([A-Fa-f0-9]{6})"/);
    const lt1Match = themeXml.match(/<a:lt1>[\s\S]*?val="([A-Fa-f0-9]{6})"/);
    const acc1Match = themeXml.match(/<a:accent1>[\s\S]*?val="([A-Fa-f0-9]{6})"/);
    const acc2Match = themeXml.match(/<a:accent2>[\s\S]*?val="([A-Fa-f0-9]{6})"/);
    const majorFontMatch = themeXml.match(/<a:majorFont>[\s\S]*?typeface="([^"]+)"/);
    const minorFontMatch = themeXml.match(/<a:minorFont>[\s\S]*?typeface="([^"]+)"/);

    if (acc1Match?.[1]) primaryColor = acc1Match[1];
    else if (dk1Match?.[1]) primaryColor = dk1Match[1];
    if (acc2Match?.[1]) accentColor = acc2Match[1];
    if (lt1Match?.[1]) backgroundColor = lt1Match[1];
    if (majorFontMatch?.[1]) headingFont = majorFontMatch[1];
    if (minorFontMatch?.[1]) bodyFont = minorFontMatch[1];
  }

  const slideFiles = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const notesFiles = Object.keys(zip.files).filter((k) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(k),
  );

  const layoutPatterns = new Set<string>();
  for (const sf of slideFiles.slice(0, 15)) {
    const xml = await zip.file(sf)!.async('text');
    if (xml.includes('<a:tbl>')) layoutPatterns.add('비교표(Table)');
    if (xml.includes('<p:pic>')) layoutPatterns.add('이미지 배치(Picture)');
    if (xml.includes('<p:sp>')) layoutPatterns.add('구조 도형(Shape)');
  }
  if (notesFiles.length > 0) layoutPatterns.add(`발표자 노트(${notesFiles.length}장)`);

  return {
    fileName,
    primaryColor,
    accentColor,
    backgroundColor,
    headingFont,
    bodyFont,
    slideCount: slideFiles.length,
    layoutPatterns: Array.from(layoutPatterns),
    notesSummary: `슬라이드 ${slideFiles.length}장 · 발표자 노트 ${notesFiles.length}개 · 주요 색상 #${primaryColor} / #${accentColor}`,
  };
}

interface CachedVisionFrameInsight {
  observedVisual: string;
  detectedText: string;
  visionTags: string[];
}

const visionFrameCache = new Map<string, CachedVisionFrameInsight>();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '24mb' }));

  const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  app.get('/api/models', async (_req: Request, res: Response) => {
    try {
      const ai = getGeminiClient();
      const lists = await listAvailableModels(ai);
      const preferred =
        FREE_FLASH_CANDIDATES.find((c) => lists.availableFreeModels.includes(c)) ||
        lists.availableFreeModels[0] ||
        'gemini-3.5-flash-lite';
      res.json({
        activeModel: getCachedActiveModel() || preferred,
        ...lists,
      });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  app.post('/api/test-connection', async (req: Request, res: Response) => {
    try {
      const ai = getGeminiClient();
      const preferred =
        typeof req.body?.preferredModel === 'string' ? req.body.preferredModel : undefined;
      const report = await runConnectionAndModelProbe(ai, preferred);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  app.post('/api/analyze-video', async (req: Request, res: Response) => {
    const rawUrl = typeof req.body?.youtubeUrl === 'string' ? req.body.youtubeUrl : '';
    const mode = req.body?.mode === 'preview30s' ? 'preview30s' : 'full';
    const forceRefresh = Boolean(req.body?.forceRefresh);
    const config = mergeConfig(req.body?.config);
    const videoId = extractYoutubeVideoId(rawUrl);

    if (!videoId) {
      res.status(400).json({
        error: '유효한 YouTube URL이 아닙니다. (예: https://www.youtube.com/watch?v=YXLWe_pqmjU)',
      });
      return;
    }

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const ai = getGeminiClient();
      sendSse(res, {
        stage: 'validating',
        message: `YouTube 영상(${videoId}) 메타데이터 확인 중...`,
      });

      const oembed = await fetchYoutubeOembed(canonicalUrl);
      await runMultimodalAnalysisPipeline(
        ai,
        {
          sourceType: 'youtube',
          url: canonicalUrl,
          videoId,
          titleHint: oembed?.title,
          authorHint: oembed?.author_name,
          mode,
          config,
          forceRefresh,
        },
        res,
        abortController.signal,
      );
      res.end();
    } catch (err) {
      sendSse(res, {
        stage: 'error',
        message: '영상 분석 중 오류가 발생했습니다.',
        error: formatGeminiError(err),
      });
      res.end();
    }
  });

  app.post('/api/analyze-upload', upload.single('video'), async (req: Request, res: Response) => {
    const file = req.file;
    const mode = req.body?.mode === 'preview30s' ? 'preview30s' : 'full';
    let parsedConfig = DEFAULT_LECTURE_CONFIG;
    try {
      if (typeof req.body?.config === 'string') {
        parsedConfig = mergeConfig(JSON.parse(req.body.config));
      }
    } catch {
      parsedConfig = DEFAULT_LECTURE_CONFIG;
    }

    if (!file) {
      res.status(400).json({ error: '업로드된 영상 파일이 없습니다.' });
      return;
    }

    if (!ALLOWED_VIDEO_MIMES.has(file.mimetype)) {
      fs.promises.unlink(file.path).catch(() => {});
      res.status(400).json({
        error: '지원되지 않는 동영상 형식입니다. MP4, WebM, MOV 파일만 업로드할 수 있습니다.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    let ai: ReturnType<typeof getGeminiClient> | null = null;
    let uploadedFileName: string | null = null;

    try {
      ai = getGeminiClient();
      sendSse(res, {
        stage: 'validating',
        message: `로컬 강의 영상(${file.originalname})을 분석 엔진에 업로드 중...`,
      });

      const uploaded = await ai.files.upload({
        file: file.path,
        config: { mimeType: file.mimetype, displayName: file.originalname },
      });
      uploadedFileName = uploaded.name ?? null;

      let activeFile = uploaded;
      const started = Date.now();
      while (activeFile.state === 'PROCESSING') {
        if (abortController.signal.aborted) {
          throw new Error('사용자에 의해 분석이 취소되었습니다.');
        }
        if (Date.now() - started > 120_000) {
          throw new Error('업로드된 영상 처리 시간이 초과되었습니다.');
        }
        await new Promise((r) => setTimeout(r, 2500));
        if (!uploadedFileName) break;
        activeFile = await ai.files.get({ name: uploadedFileName });
      }

      if (activeFile.state === 'FAILED' || !activeFile.uri) {
        throw new Error('업로드된 영상의 프레임/오디오 처리에 실패했습니다.');
      }

      await runMultimodalAnalysisPipeline(
        ai,
        {
          sourceType: 'upload',
          url: '',
          videoId: '',
          uploadedFileUri: activeFile.uri,
          uploadedMimeType: activeFile.mimeType || file.mimetype,
          localMp4Path: file.path,
          titleHint: file.originalname.replace(/\.[^.]+$/, ''),
          mode,
          config: parsedConfig,
          onExtractMp4Frames: extractBestFramesFromMp4,
        },
        res,
        abortController.signal,
      );
      res.end();
    } catch (err) {
      sendSse(res, {
        stage: 'error',
        message: '로컬 영상 분석 중 오류가 발생했습니다.',
        error: formatGeminiError(err),
      });
      res.end();
    } finally {
      fs.promises.unlink(file.path).catch(() => {});
      if (ai && uploadedFileName) {
        ai.files.delete({ name: uploadedFileName }).catch(() => {});
      }
    }
  });

  // Standalone FFmpeg frame extractor endpoint for authorized MP4 files
  app.post('/api/extract-frames', upload.single('video'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '프레임을 추출할 MP4 영상 파일이 필요합니다.' });
      return;
    }

    if (!ALLOWED_VIDEO_MIMES.has(file.mimetype)) {
      fs.promises.unlink(file.path).catch(() => {});
      res.status(400).json({ error: '지원되지 않는 동영상 형식입니다. MP4/WebM/MOV만 지원됩니다.' });
      return;
    }

    try {
      const rawTargets = typeof req.body?.targets === 'string' ? JSON.parse(req.body.targets) : [];
      const targets = Array.isArray(rawTargets)
        ? rawTargets
            .map((t: { timestampSeconds?: number; label?: string }) => ({
              timestampSeconds: Number(t.timestampSeconds) || 0,
              label: typeof t.label === 'string' ? t.label : '장면 캡처',
            }))
            .slice(0, 40)
        : [];

      const sourceLabel =
        typeof req.body?.sourceLabel === 'string' && req.body.sourceLabel.trim()
          ? req.body.sourceLabel.trim()
          : file.originalname;

      const frames = await extractBestFramesFromMp4(file.path, targets, sourceLabel);
      res.json({ frames });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'FFmpeg 프레임 추출 중 오류가 발생했습니다.',
      });
    } finally {
      fs.promises.unlink(file.path).catch(() => {});
    }
  });

  // Parse uploaded reference PPTX template (e.g. Transformer_강의자료_개선본.pptx)
  app.post('/api/parse-pptx-template', upload.single('template'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '참고 PPTX 파일이 업로드되지 않았습니다.' });
      return;
    }
    try {
      const buf = await fs.promises.readFile(file.path);
      const profile = await parsePptxTemplateBuffer(buf, file.originalname);
      res.json({ profile });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'PPTX 템플릿 분석 중 오류가 발생했습니다.',
      });
    } finally {
      fs.promises.unlink(file.path).catch(() => {});
    }
  });

  // Parse reference PDF summary via Gemini document understanding
  app.post('/api/parse-pdf', upload.single('pdf'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '참고 PDF 파일이 없습니다.' });
      return;
    }
    try {
      const ai = getGeminiClient();
      const buf = await fs.promises.readFile(file.path);
      const activeModel = getCachedActiveModel() || 'gemini-3.5-flash-lite';
      const { response } = await callGenerateContentWithRetry(
        ai,
        activeModel,
        ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter((m) => m !== activeModel),
        (modelId) => ({
          model: modelId,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: buf.toString('base64'),
                  },
                },
                {
                  text: '이 참고 PDF 강의자료의 핵심 주제, 목차, 주요 수식/용어를 한국어 1,000자 이내로 요약해주세요.',
                },
              ],
            },
          ],
        }),
      );
      res.json({ summary: (response.text ?? '').trim(), fileName: file.originalname });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    } finally {
      fs.promises.unlink(file.path).catch(() => {});
    }
  });

  app.post('/api/refine-slide', async (req: Request, res: Response) => {
    try {
      const ai = getGeminiClient();
      const slide = req.body?.slide as LectureSlide | undefined;
      const instruction =
        typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';

      if (!slide || !instruction) {
        res.status(400).json({ error: '슬라이드 정보와 보완 요청 내용이 필요합니다.' });
        return;
      }

      const activeModel = getCachedActiveModel() || 'gemini-3.5-flash-lite';
      const { response } = await callGenerateContentWithRetry(
        ai,
        activeModel,
        ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter((m) => m !== activeModel),
        (modelId) => ({
          model: modelId,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `다음 대학 AI/SW 전공 학부생용 강의 슬라이드를 교수자의 요청에 맞게 보완하세요.
한국어 설명 + 영문 기술 용어 병기 원칙을 지키고, 기존 영상 근거("videoBasedPoints")와 추가 보충 설명("supplementaryPoints"), 출처 등급("sourceTier": A/B/C)을 훼손하거나 영상에 없던 내용을 지어내지 마세요.

[현재 슬라이드]
${JSON.stringify(slide)}

[교수자 보완 요청]
${instruction}`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                titleKo: { type: Type.STRING },
                titleEn: { type: Type.STRING },
                bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                equationLatex: { type: Type.STRING },
                matrixNote: { type: Type.STRING },
                speakerScript: { type: Type.STRING },
                supplementaryPoints: { type: Type.STRING },
                keyHighlight: { type: Type.STRING },
              },
              required: [
                'titleKo',
                'titleEn',
                'bullets',
                'equationLatex',
                'matrixNote',
                'speakerScript',
                'supplementaryPoints',
              ],
            },
          },
        }),
      );

      const refined = JSON.parse((response.text ?? '{}').trim()) as Partial<LectureSlide>;
      res.json({
        slide: {
          ...slide,
          ...refined,
        },
      });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  app.post('/api/regenerate-slide', async (req: Request, res: Response) => {
    try {
      const ai = getGeminiClient();
      const slide = req.body?.slide as LectureSlide | undefined;
      const contextSummary =
        typeof req.body?.contextSummary === 'string' ? req.body.contextSummary : '';
      const mode = req.body?.mode === 'design-only' ? 'design-only' : 'full';

      if (!slide) {
        res.status(400).json({ error: '재생성할 슬라이드 데이터가 필요합니다.' });
        return;
      }

      const activeModel = getCachedActiveModel() || 'gemini-3.5-flash-lite';
      const { response } = await callGenerateContentWithRetry(
        ai,
        activeModel,
        ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter((m) => m !== activeModel),
        (modelId) => ({
          model: modelId,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    mode === 'design-only'
                      ? `다음 슬라이드의 내용과 사실은 유지하면서 레이아웃 유형("slideType": video-hero, image-left-text, image-right-text, comparison-table, equation-focus, matrix-stepwise, code-lab, key-concept, timeline, process-steps 중 최적 선택)과 도식("diagramPreset"), 불릿 간결화(넘침 방지)를 개선하세요.\n\n[슬라이드]\n${JSON.stringify(slide)}`
                      : `기존 영상 분석 문맥을 바탕으로 이 단일 슬라이드(${slide.slideNumber}번)만 새롭게 재구성하세요. 영상 근거를 유지하며 교수자 스크립트, 수식, 표/코드/도식 구성을 한층 풍부하게 개선하세요.\n\n[영상 문맥]\n${contextSummary}\n\n[기존 슬라이드]\n${JSON.stringify(slide)}`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                titleKo: { type: Type.STRING },
                titleEn: { type: Type.STRING },
                slideType: { type: Type.STRING },
                bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                keyHighlight: { type: Type.STRING },
                equationLatex: { type: Type.STRING },
                matrixNote: { type: Type.STRING },
                diagramPreset: { type: Type.STRING },
                diagramCaption: { type: Type.STRING },
                speakerScript: { type: Type.STRING },
              },
              required: [
                'titleKo',
                'titleEn',
                'slideType',
                'bullets',
                'equationLatex',
                'matrixNote',
                'diagramPreset',
                'speakerScript',
              ],
            },
          },
        }),
      );

      const updated = JSON.parse((response.text ?? '{}').trim()) as Partial<LectureSlide>;
      res.json({
        slide: {
          ...slide,
          ...updated,
        },
      });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Gemini Vision semantic check: verify captured PNG frames match slide topic & content (Requirement 4)
  app.post('/api/verify-slide-frames', async (req: Request, res: Response) => {
    try {
      const ai = getGeminiClient();
      interface VerifyFrameItem {
        slideNumber: number;
        titleKo: string;
        titleEn?: string;
        summary: string;
        captureTimestamp?: string;
        imageDataUrl: string;
      }
      const rawItems = Array.isArray(req.body?.items) ? (req.body.items as unknown[]) : [];
      const items: VerifyFrameItem[] = rawItems
        .filter((it): it is VerifyFrameItem => {
          if (!it || typeof it !== 'object') return false;
          const obj = it as Record<string, unknown>;
          return (
            typeof obj.slideNumber === 'number' &&
            typeof obj.titleKo === 'string' &&
            typeof obj.imageDataUrl === 'string' &&
            obj.imageDataUrl.startsWith('data:image/')
          );
        })
        .slice(0, 8);

      if (items.length === 0) {
        res.status(400).json({ error: '검증할 슬라이드와 캡처 이미지 데이터가 필요합니다.' });
        return;
      }

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      const metaList: string[] = [];

      items.forEach((item: VerifyFrameItem, idx: number) => {
        const match = item.imageDataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!match) return;
        metaList.push(
          `[이미지 ${idx + 1} -> Slide ${item.slideNumber}] 제목: "${item.titleKo}" (${item.titleEn || ''}) | 캡처 시점: ${item.captureTimestamp || ''} | 슬라이드 핵심 요약: ${item.summary}`,
        );
        parts.push({
          text: `아래 이미지 ${idx + 1}은 Slide ${item.slideNumber} ("${item.titleKo}")에 매칭된 실제 영상 캡처입니다:`,
        });
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      });

      parts.push({
        text: `각 슬라이드에 배정된 실제 영상 캡처 이미지가 해당 슬라이드 제목 및 설명과 실제로 일치하는지 시각적으로 검증하세요.
- 이미지 안에 슬라이드 주제와 관련된 도식·수식·코드·설명·장면이 실제로 보이면 status="verified", matched=true로 판정하세요.
- 검은 화면, 관계없는 인터뷰 인물만 있는 화면, 로딩 화면, 혹은 슬라이드 주제와 무관한 장면이면 status="needs-review", matched=false로 판정하고 reason에 검토 사유(예: 다른 타임스탬프 재캡처 또는 도식 전환 권장)를 적으세요.

[검증 대상 목록]
${metaList.join('\n')}`,
      });

      const activeModel = getCachedActiveModel() || 'gemini-3.5-flash-lite';
      const { response, modelUsed } = await callGenerateContentWithRetry(
        ai,
        activeModel,
        ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter((m) => m !== activeModel),
        (modelId) => ({
          model: modelId,
          contents: [{ role: 'user', parts }],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                results: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      slideNumber: { type: Type.INTEGER },
                      matched: { type: Type.BOOLEAN },
                      status: { type: Type.STRING },
                      observedVisual: { type: Type.STRING },
                      reason: { type: Type.STRING },
                    },
                    required: ['slideNumber', 'matched', 'status', 'observedVisual', 'reason'],
                  },
                },
              },
              required: ['results'],
            },
          },
        }),
      );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        results?: Array<{
          slideNumber: number;
          matched: boolean;
          status: string;
          observedVisual: string;
          reason: string;
        }>;
      };

      res.json({
        modelUsed,
        results: (parsed.results ?? []).map((r) => ({
          slideNumber: r.slideNumber,
          matched: Boolean(r.matched),
          status: r.matched && r.status !== 'needs-review' ? 'verified' : 'needs-review',
          observedVisual: r.observedVisual || '',
          reason: r.reason || '',
        })),
      });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Gemini Vision frame inspector: extracts actual visual text & concepts once per unique imageHash
  app.post('/api/inspect-captured-frames', async (req: Request, res: Response) => {
    try {
      interface InspectFrameInput {
        id: string;
        imageHash?: string;
        timestampFormatted?: string;
        visualSummary?: string;
        imageDataUrl: string;
      }

      const rawFrames = Array.isArray(req.body?.frames) ? (req.body.frames as unknown[]) : [];
      const frames: InspectFrameInput[] = rawFrames
        .filter((f): f is InspectFrameInput => {
          if (!f || typeof f !== 'object') return false;
          const obj = f as Record<string, unknown>;
          return (
            typeof obj.id === 'string' &&
            typeof obj.imageDataUrl === 'string' &&
            obj.imageDataUrl.startsWith('data:image/')
          );
        })
        .slice(0, 32);

      if (frames.length === 0) {
        res.status(400).json({ error: '분석할 캡처 이미지 데이터가 없습니다.' });
        return;
      }

      const resolved = new Map<string, CachedVisionFrameInsight & { cacheKey: string }>();
      const uncached: Array<InspectFrameInput & { cacheKey: string; mimeType: string; base64: string }> = [];

      for (const frame of frames) {
        const match = frame.imageDataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!match) continue;
        const sha = crypto.createHash('sha256').update(match[2].slice(0, 4096)).digest('hex').slice(0, 16);
        const cacheKey = frame.imageHash ? `${frame.imageHash}:${sha}` : sha;
        const hit = visionFrameCache.get(cacheKey);
        if (hit) {
          resolved.set(frame.id, { ...hit, cacheKey });
        } else {
          uncached.push({
            ...frame,
            cacheKey,
            mimeType: match[1],
            base64: match[2],
          });
        }
      }

      let modelUsed = getCachedActiveModel() || 'cached';
      if (uncached.length > 0) {
        const ai = getGeminiClient();
        const activeModel = getCachedActiveModel() || 'gemini-3.5-flash-lite';

        for (let i = 0; i < uncached.length; i += 8) {
          const batch = uncached.slice(i, i + 8);
          const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
          const metaLines: string[] = [];

          batch.forEach((item, idx) => {
            metaLines.push(
              `[프레임 ${idx + 1}] id="${item.id}", 타임스탬프=${item.timestampFormatted || ''}, 기존설명="${item.visualSummary || ''}"`,
            );
            parts.push({ text: `프레임 ${idx + 1} (id="${item.id}"):` });
            parts.push({ inlineData: { mimeType: item.mimeType, data: item.base64 } });
          });

          parts.push({
            text: `각 영상 캡처 이미지에 실제로 보이는 핵심 시각 내용과 화면 속 텍스트/수식/다이어그램을 정확히 판독하세요.
- observedVisual: 화면에 실제로 그려진 내용 요약 (예: "Attention Is All You Need 논문 표지", "Transformer Encoder-Decoder 블록 다이어그램", "Scaled Dot-Product Attention 수식 Q, K, V 및 sqrt(d_k)")
- detectedText: 화면 내 제목, 영문 키워드, 축 레이블, 수식 기호 등 실제로 읽히는 핵심 텍스트
- visionTags: 슬라이드 매칭에 쓸 수 있는 4~8개 핵심 기술 키워드 배열(영문+한국어)

[분석 대상 프레임]
${metaLines.join('\n')}`,
          });

          const callRes = await callGenerateContentWithRetry(
            ai,
            activeModel,
            ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter((m) => m !== activeModel),
            (modelId) => ({
              model: modelId,
              contents: [{ role: 'user', parts }],
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    results: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          observedVisual: { type: Type.STRING },
                          detectedText: { type: Type.STRING },
                          visionTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ['id', 'observedVisual', 'detectedText', 'visionTags'],
                      },
                    },
                  },
                  required: ['results'],
                },
              },
            }),
          );

          modelUsed = callRes.modelUsed;
          const parsed = JSON.parse((callRes.response.text ?? '{}').trim()) as {
            results?: Array<{
              id: string;
              observedVisual: string;
              detectedText: string;
              visionTags: string[];
            }>;
          };

          for (const r of parsed.results ?? []) {
            const target = batch.find((b) => b.id === r.id);
            if (!target) continue;
            const insight: CachedVisionFrameInsight = {
              observedVisual: r.observedVisual || '',
              detectedText: r.detectedText || '',
              visionTags: Array.isArray(r.visionTags) ? r.visionTags : [],
            };
            visionFrameCache.set(target.cacheKey, insight);
            resolved.set(target.id, { ...insight, cacheKey: target.cacheKey });
          }
        }
      }

      res.json({
        modelUsed,
        cachedHits: frames.length - uncached.length,
        inspectedCount: uncached.length,
        results: frames.map((f) => {
          const info = resolved.get(f.id);
          return {
            id: f.id,
            observedVisual: info?.observedVisual || '',
            detectedText: info?.detectedText || '',
            visionTags: info?.visionTags || [],
          };
        }),
      });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Download clean source code ZIP for GitHub / Windows local deployment (Section 20)
  app.get('/api/export-source-zip', async (_req: Request, res: Response) => {
    try {
      const zip = new JSZip();
      const rootDir = process.cwd();
      const excludeDirs = new Set(['node_modules', '.git', 'dist', '.next', '.cache']);
      const excludeFiles = new Set(['.env', '.env.local']);

      async function addDir(dir: string, relBase: string) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (excludeDirs.has(entry.name)) continue;
            await addDir(path.join(dir, entry.name), path.join(relBase, entry.name));
          } else {
            if (excludeFiles.has(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            const relPath = path.join(relBase, entry.name).replace(/\\/g, '/');
            const content = await fs.promises.readFile(fullPath);
            zip.file(relPath, content);
          }
        }
      }

      await addDir(rootDir, '');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="lecturelens-ai-2.0-source.zip"');
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '소스코드 ZIP 생성에 실패했습니다.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
