import { GoogleGenAI, Type } from '@google/genai';
import { isHybrid, openAIModel, requireOpenAIKey, callOpenAIJson } from './openaiProvider.ts';
import type { Part } from '@google/genai';
import type { Response } from 'express';
import type {
  LectureAnalysisResult,
  LectureConfig,
  LectureSlide,
  ModelConnectionReport,
  ModelProbeEntry,
  PipelineStepItem,
  SceneAnalysis,
  TechnicalConcept,
  VideoMeta,
  VideoStoryline,
} from '../src/types/lecture.ts';

export const FREE_FLASH_CANDIDATES = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
] as const;

const PAID_OR_NON_TEXT_KEYWORDS = [
  'carbon',
  'neon',
  'argon',
  'pro',
  'image',
  'nano-banana',
  'omni',
  'veo',
  'genie',
  'lyria',
  'tts',
  'transcribe',
  'live',
  'embedding',
  'decision',
  '1.5',
  '2.0',
];

let cachedActiveModel: string | null = null;

// In-memory server cache to avoid duplicate Gemini calls for identical video + config
const analysisCache = new Map<string, LectureAnalysisResult>();

export function getCachedActiveModel(): string | null {
  return cachedActiveModel;
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY가 설정되지 않았습니다. AI Studio의 Settings > Secrets 패널 또는 .env 파일에 유효한 API 키를 설정해주세요.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function parseTimeToSeconds(mmss: string): number {
  const parts = String(mmss || '0:00')
    .trim()
    .split(':')
    .map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return 0;
}

export function sendSse(res: Response, payload: Record<string, unknown>) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

export function isRetryable503Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    msg.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('service unavailable') ||
    msg.includes('502') ||
    msg.includes('504') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  );
}

export function isNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('404') || msg.includes('NOT_FOUND') || msg.toLowerCase().includes('not found');
}

export function formatGeminiError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('OpenAI')) return message;
  if (
    message.includes('PERMISSION_DENIED') ||
    message.includes('API_KEY_INVALID') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return `API 키 및 권한 오류(401/403): GEMINI_API_KEY가 유효한지, 해당 프로젝트에서 Gemini API가 활성화되어 있는지 확인해주세요. (${message})`;
  }
  if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
    return `사용량/요청 한도 초과(429): 현재 API 프로젝트의 분당/일일 요청 제한에 도달했습니다. 잠시 후 재시도하거나 프로젝트 할당량을 확인해주세요. (${message})`;
  }
  if (message.includes('504') || message.toLowerCase().includes('deadline')) {
    return `요청 시간 초과(504): 영상이 길어 분할 분석 또는 처음 30초 검증 모드로 재실행을 권장합니다. (${message})`;
  }
  if (isRetryable503Error(err)) {
    return `503 UNAVAILABLE: Gemini 서버의 일시적인 트래픽 과부하로 최대 3회 자동 재시도 후에도 응답받지 못했습니다. 호환되는 다른 무료 Flash 모델로 변경하거나 로컬 MP4 업로드 후 재시도해주세요. [원본 오류: ${message}]`;
  }
  return message;
}

export function isEligibleFreeFlashModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (!lower.includes('gemini')) return false;
  if (PAID_OR_NON_TEXT_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  return lower.includes('flash') || lower.includes('hydrogen');
}

export async function listAvailableModels(ai: GoogleGenAI): Promise<{
  allGeminiModels: string[];
  availableFreeModels: string[];
}> {
  const allGeminiModels: string[] = [];
  const availableFreeModels: string[] = [];

  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      const shortName = (m.name ?? '').replace(/^models\//, '');
      if (!shortName || !shortName.toLowerCase().includes('gemini')) continue;
      allGeminiModels.push(shortName);
      if (isEligibleFreeFlashModel(shortName)) {
        availableFreeModels.push(shortName);
      }
    }
  } catch {
    // Fallback if models.list is restricted on a scoped key
  }

  return { allGeminiModels, availableFreeModels };
}

export async function probeTextConnection(
  ai: GoogleGenAI,
  modelId: string,
): Promise<ModelProbeEntry> {
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }],
    });
    const text = (response.text ?? '').trim();
    return {
      model: modelId,
      status: 'ok',
      latencyMs: Date.now() - started,
      detail: text ? `응답 정상 (${text.slice(0, 24)})` : '응답 정상',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNotFoundError(err)) {
      return {
        model: modelId,
        status: 'not_found',
        latencyMs: Date.now() - started,
        detail: `모델 미지원(404 NOT_FOUND): ${msg}`,
      };
    }
    if (isRetryable503Error(err)) {
      return {
        model: modelId,
        status: 'unavailable',
        latencyMs: Date.now() - started,
        detail: `일시적 과부하(503 UNAVAILABLE): ${msg}`,
      };
    }
    return {
      model: modelId,
      status: 'error',
      latencyMs: Date.now() - started,
      detail: msg,
    };
  }
}

export async function runConnectionAndModelProbe(
  ai: GoogleGenAI,
  preferredModel?: string,
): Promise<ModelConnectionReport> {
  const { allGeminiModels, availableFreeModels } = await listAvailableModels(ai);

  const orderedCandidates: string[] = [];
  if (preferredModel && preferredModel !== 'auto' && isEligibleFreeFlashModel(preferredModel)) {
    orderedCandidates.push(preferredModel);
  }
  for (const m of FREE_FLASH_CANDIDATES) {
    if (!orderedCandidates.includes(m)) orderedCandidates.push(m);
  }
  for (const m of availableFreeModels) {
    if (!orderedCandidates.includes(m)) orderedCandidates.push(m);
  }

  const testedCandidates: ModelProbeEntry[] = [];
  let activeModel = '';

  for (const candidate of orderedCandidates) {
    const probe = await probeTextConnection(ai, candidate);
    testedCandidates.push(probe);
    if (probe.status === 'ok' && !activeModel) {
      activeModel = candidate;
      break;
    }
  }

  if (!activeModel) {
    activeModel = orderedCandidates[0] || 'gemini-3.5-flash-lite';
  } else {
    cachedActiveModel = activeModel;
  }

  return {
    activeModel,
    testedCandidates,
    availableFreeModels,
    allGeminiModels,
    testedAt: new Date().toISOString(),
  };
}

export async function callGenerateContentWithRetry(
  ai: GoogleGenAI,
  primaryModel: string,
  backupModels: string[],
  buildRequest: (modelId: string) => Parameters<GoogleGenAI['models']['generateContent']>[0],
  onStatus?: (msg: string, activeModel?: string) => void,
  signal?: AbortSignal,
) {
  const modelsToTry = Array.from(new Set([primaryModel, ...backupModels].filter(Boolean)));
  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const modelId = modelsToTry[mIdx];
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error('사용자에 의해 분석이 취소되었습니다.');
      }
      try {
        if (attempt > 0) {
          // Exponential backoff + jitter (2s, 4s, 8s + 0~600ms)
          const jitterMs = Math.floor(Math.random() * 600);
          const waitMs = 2000 * Math.pow(2, attempt - 1) + jitterMs;
          onStatus?.(
            `[${modelId}] 503 일시적 과부하 감지 — ${(waitMs / 1000).toFixed(1)}초 대기 후 자동 재시도 (${attempt}/${maxRetries})...`,
            modelId,
          );
          await new Promise((r) => setTimeout(r, waitMs));
        }
        const response = await ai.models.generateContent(buildRequest(modelId));
        cachedActiveModel = modelId;
        return { response, modelUsed: modelId };
      } catch (err) {
        lastError = err;
        if (isNotFoundError(err)) {
          onStatus?.(`[${modelId}] 모델 미지원(404) — 다음 호환 Flash 모델로 전환합니다...`, modelId);
          break;
        }
        if (isRetryable503Error(err) && attempt < maxRetries) {
          continue;
        }
        if (isRetryable503Error(err) && mIdx < modelsToTry.length - 1) {
          onStatus?.(
            `[${modelId}] 3회 재시도 후에도 503 응답 — 호환 모델(${modelsToTry[mIdx + 1]})로 전환합니다...`,
            modelsToTry[mIdx + 1],
          );
          break;
        }
        throw err;
      }
    }
  }

  throw lastError ?? new Error('사용 가능한 Flash 계열 모델에서 응답을 받지 못했습니다.');
}

export function buildYoutubeMediaPart(
  canonicalUrl: string,
  startOffset?: string,
  endOffset?: string,
): Part {
  const part: Part = {
    fileData: {
      fileUri: canonicalUrl,
      mimeType: 'video/mp4',
    },
  };
  if (startOffset || endOffset) {
    part.videoMetadata = {
      ...(startOffset ? { startOffset } : {}),
      ...(endOffset ? { endOffset } : {}),
    };
  }
  return part;
}

const stage1PreviewSchema = {
  type: Type.OBJECT,
  properties: {
    videoMeta: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        channelOrAuthor: { type: Type.STRING },
        durationFormatted: { type: Type.STRING },
        language: { type: Type.STRING },
        verificationNote: { type: Type.STRING },
      },
      required: ['title', 'channelOrAuthor', 'durationFormatted', 'language', 'verificationNote'],
    },
    executiveSummary: { type: Type.STRING },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sceneNumber: { type: Type.INTEGER },
          startTime: { type: Type.STRING },
          endTime: { type: Type.STRING },
          title: { type: Type.STRING },
          screenComposition: { type: Type.STRING },
          visualDiagramsAndEquations: { type: Type.STRING },
          onScreenTextAndSubtitles: { type: Type.STRING },
          audioCoreSummary: { type: Type.STRING },
          captureTimestamp: { type: Type.STRING },
          captureGuide: { type: Type.STRING },
          capturePriority: { type: Type.STRING },
          observedInVideo: { type: Type.ARRAY, items: { type: Type.STRING } },
          supplementaryForStudents: { type: Type.ARRAY, items: { type: Type.STRING } },
          unverifiedOrAmbiguous: { type: Type.STRING },
        },
        required: [
          'sceneNumber',
          'startTime',
          'endTime',
          'title',
          'screenComposition',
          'visualDiagramsAndEquations',
          'onScreenTextAndSubtitles',
          'audioCoreSummary',
          'captureTimestamp',
          'captureGuide',
          'capturePriority',
          'observedInVideo',
          'supplementaryForStudents',
          'unverifiedOrAmbiguous',
        ],
      },
    },
  },
  required: ['videoMeta', 'executiveSummary', 'scenes'],
};

const phase1Schema = {
  type: Type.OBJECT,
  properties: {
    videoMeta: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        channelOrAuthor: { type: Type.STRING },
        durationFormatted: { type: Type.STRING },
        language: { type: Type.STRING },
        verificationNote: { type: Type.STRING },
      },
      required: ['title', 'channelOrAuthor', 'durationFormatted', 'language', 'verificationNote'],
    },
    executiveSummary: { type: Type.STRING },
    storyline: {
      type: Type.OBJECT,
      properties: {
        coreMessage: { type: Type.STRING },
        introSummary: { type: Type.STRING },
        bodySummary: { type: Type.STRING },
        conclusionSummary: { type: Type.STRING },
        pedagogicalReorderNote: { type: Type.STRING },
        domainType: { type: Type.STRING },
      },
      required: [
        'coreMessage',
        'introSummary',
        'bodySummary',
        'conclusionSummary',
        'pedagogicalReorderNote',
        'domainType',
      ],
    },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sceneNumber: { type: Type.INTEGER },
          startTime: { type: Type.STRING },
          endTime: { type: Type.STRING },
          title: { type: Type.STRING },
          screenComposition: { type: Type.STRING },
          visualDiagramsAndEquations: { type: Type.STRING },
          onScreenTextAndSubtitles: { type: Type.STRING },
          audioCoreSummary: { type: Type.STRING },
          captureTimestamp: { type: Type.STRING },
          captureGuide: { type: Type.STRING },
          capturePriority: { type: Type.STRING },
          observedInVideo: { type: Type.ARRAY, items: { type: Type.STRING } },
          supplementaryForStudents: { type: Type.ARRAY, items: { type: Type.STRING } },
          unverifiedOrAmbiguous: { type: Type.STRING },
        },
        required: [
          'sceneNumber',
          'startTime',
          'endTime',
          'title',
          'screenComposition',
          'visualDiagramsAndEquations',
          'onScreenTextAndSubtitles',
          'audioCoreSummary',
          'captureTimestamp',
          'captureGuide',
          'capturePriority',
          'observedInVideo',
          'supplementaryForStudents',
          'unverifiedOrAmbiguous',
        ],
      },
    },
    concepts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nameKo: { type: Type.STRING },
          nameEn: { type: Type.STRING },
          category: { type: Type.STRING },
          appearedInVideo: { type: Type.BOOLEAN },
          videoTimestampRef: { type: Type.STRING },
          matrixDimensions: { type: Type.STRING },
          formulaLatex: { type: Type.STRING },
          videoExplanation: { type: Type.STRING },
          studentSupplementary: { type: Type.STRING },
          academicReference: { type: Type.STRING },
        },
        required: [
          'nameKo',
          'nameEn',
          'category',
          'appearedInVideo',
          'videoTimestampRef',
          'matrixDimensions',
          'formulaLatex',
          'videoExplanation',
          'studentSupplementary',
          'academicReference',
        ],
      },
    },
  },
  required: ['videoMeta', 'executiveSummary', 'storyline', 'scenes', 'concepts'],
};

const phase2Schema = {
  type: Type.OBJECT,
  properties: {
    slides: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slideNumber: { type: Type.INTEGER },
          section: { type: Type.STRING },
          titleKo: { type: Type.STRING },
          titleEn: { type: Type.STRING },
          slideType: { type: Type.STRING },
          estimatedMinutes: { type: Type.NUMBER },
          bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
          keyHighlight: { type: Type.STRING },
          equationLatex: { type: Type.STRING },
          matrixNote: { type: Type.STRING },
          equationVariables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                symbol: { type: Type.STRING },
                meaning: { type: Type.STRING },
              },
              required: ['symbol', 'meaning'],
            },
          },
          numericExample: { type: Type.STRING },
          comparisonTable: {
            type: Type.OBJECT,
            properties: {
              headers: { type: Type.ARRAY, items: { type: Type.STRING } },
              rows: {
                type: Type.ARRAY,
                items: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
            required: ['headers', 'rows'],
          },
          codeBlock: {
            type: Type.OBJECT,
            properties: {
              language: { type: Type.STRING },
              code: { type: Type.STRING },
              explanation: { type: Type.STRING },
            },
            required: ['language', 'code', 'explanation'],
          },
          timelineSteps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                title: { type: Type.STRING },
                detail: { type: Type.STRING },
              },
              required: ['label', 'title', 'detail'],
            },
          },
          quizItem: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              answerIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
            },
            required: ['question', 'options', 'answerIndex', 'explanation'],
          },
          diagramPreset: { type: Type.STRING },
          diagramCaption: { type: Type.STRING },
          captureTimestamp: { type: Type.STRING },
          captureGuideText: { type: Type.STRING },
          sourceBoundary: { type: Type.STRING },
          sourceTier: { type: Type.STRING },
          videoBasedPoints: { type: Type.STRING },
          supplementaryPoints: { type: Type.STRING },
          academicReferences: { type: Type.ARRAY, items: { type: Type.STRING } },
          speakerScript: { type: Type.STRING },
        },
        required: [
          'slideNumber',
          'section',
          'titleKo',
          'titleEn',
          'slideType',
          'estimatedMinutes',
          'bullets',
          'keyHighlight',
          'equationLatex',
          'matrixNote',
          'diagramPreset',
          'diagramCaption',
          'captureTimestamp',
          'captureGuideText',
          'sourceBoundary',
          'sourceTier',
          'videoBasedPoints',
          'supplementaryPoints',
          'academicReferences',
          'speakerScript',
        ],
      },
    },
  },
  required: ['slides'],
};

function createInitialPipelineSteps(): PipelineStepItem[] {
  return [
    { step: 1, label: '입력 영상 및 접근 권한 확인', status: 'pending' },
    { step: 2, label: 'Gemini API 연결 및 모델 확인', status: 'pending' },
    { step: 3, label: '처음 30초(00:00~00:30) 화면·음성 검증', status: 'pending' },
    { step: 4, label: '전체 영상 문맥·화면·음성·자막 분석', status: 'pending' },
    { step: 5, label: '실제 영상 프레임 추출 및 품질 검증', status: 'pending' },
    { step: 6, label: '강의 스토리라인 및 다중 레이아웃 슬라이드 설계', status: 'pending' },
    { step: 7, label: '학술적 사실 검증 및 교수자 대본 완성', status: 'pending' },
  ];
}

function resolveTargetSlideCount(config: LectureConfig): number {
  if (config.slideCountMode === 'custom') {
    return Math.min(60, Math.max(8, Math.round(config.targetSlideCount || 25)));
  }
  const mins = Math.max(10, Math.round(config.durationMinutes || 25));
  if (mins <= 30) return Math.min(25, Math.max(20, mins));
  if (mins <= 60) return Math.min(40, Math.max(30, Math.round(mins * 0.7)));
  return Math.min(60, Math.max(40, Math.round(mins * 0.65)));
}

function buildConfigInstruction(config: LectureConfig): string {
  const slideTarget = resolveTargetSlideCount(config);
  const levelMap: Record<LectureConfig['studentLevel'], string> = {
    intro: '입문/교양 대학생 (직관과 일상 비유 중심, 수식 최소화)',
    'undergrad-basic': '대학 1~2학년 전공 기초생 (핵심 개념과 기본 수식 소개)',
    'undergrad-mid': '대학 AI·소프트웨어 전공 학부생 (행렬 차원, 수식, 구현 직관 균형)',
    'undergrad-adv': '대학 3~4학년 심화 전공생 (논문 수식 유도, 복잡도 증명, 코드 매핑)',
    grad: '대학원 연구 세미나 수준 (엄밀한 수학적 정식화 및 논문 비교)',
  };
  const langMap: Record<LectureConfig['languageMode'], string> = {
    'ko-en': '한국어 설명 중심 + 핵심 기술 용어 영문 병기 (예: 스케일드 닷-프로덕트 어텐션(Scaled Dot-Product Attention))',
    ko: '한국어 중심 설명 (꼭 필요한 기호/약어만 영문 유지)',
    en: '영문 슬라이드 본문 및 학술 용어 중심 (교수자 스크립트는 한국어+영문 설명)',
  };
  const scriptMap: Record<LectureConfig['scriptDetail'], string> = {
    brief: '슬라이드당 2~3문장 핵심 요점 중심 발표자 노트',
    standard: '슬라이드당 4~5문장 표준 강의 멘트',
    detailed: '슬라이드당 6~8문장 상세 설명 + 예시/질문 포함',
    verbatim: '실제 대학 강의실 대본 수준(도입 연결-핵심 설명-화면/이미지 지시-용어/비유-수식/차원 설명-혼동 포인트-질문/답변-다음 전환-예상 시간)',
  };

  return `[교수자 강의 설정]
- 교과목명: ${config.courseName || 'AI응용기술'}
- 강의 주제 지정: ${config.lectureTopic || '영상 내용에 맞춰 자동 도출'}
- 담당 교수명: ${config.professorName || '미지정'}
- 목표 강의시간: ${config.durationMinutes}분
- 목표 슬라이드 수: ${
    config.slideCountMode === 'auto'
      ? `정확히 ${slideTarget}장 (강의시간 ${config.durationMinutes}분 기준: 25분→20~25장, 50분→30~40장, 75분→40~60장)`
      : `정확히 ${slideTarget}장 (사용자 지정 수량 우선)`
  }
- 대상 학생 수준: ${levelMap[config.studentLevel]}
- 강의 유형: ${config.lectureType === 'theory' ? '이론 중심' : config.lectureType === 'practice' ? '실습/코드 중심' : '이론 및 실습 혼합'}
- 영상 이미지 활용 비중: ${config.videoImageWeight}
- 언어 표기: ${langMap[config.languageMode]}
- 포함 옵션: 수식(${config.includeEquations ? 'O' : 'X'}), 행렬 계산 예제(${config.includeMatrixExamples ? 'O' : 'X'}), 실습 코드(${config.includeCodeExamples ? 'O' : 'X'}), 활용 사례(${config.includeUseCases ? 'O' : 'X'}), 산업 현장 사례(${config.includeIndustryCases ? 'O' : 'X'}), 학생 평가문제(${config.includeQuiz ? 'O' : 'X'}), 교수자 스크립트(${config.includeSpeakerScript ? 'O' : 'X'} - ${scriptMap[config.scriptDetail]})
${config.referenceTemplate ? `- 참고 PPTX 디자인 패턴(${config.referenceTemplate.fileName}): ${config.referenceTemplate.layoutPatterns.join(', ')}` : ''}
${config.referencePdfSummary ? `- 참고 PDF 강의자료 요약:\n${config.referencePdfSummary.slice(0, 1500)}` : ''}`;
}

export async function runMultimodalAnalysisPipeline(
  ai: GoogleGenAI,
  options: {
    sourceType: 'youtube' | 'upload';
    url: string;
    videoId: string;
    uploadedFileUri?: string;
    uploadedMimeType?: string;
    localMp4Path?: string;
    titleHint?: string;
    authorHint?: string;
    mode: 'preview30s' | 'full';
    config: LectureConfig;
    forceRefresh?: boolean;
    onExtractMp4Frames?: (
      filePath: string,
      targets: Array<{ timestampSeconds: number; label: string }>,
      sourceLabel: string,
    ) => Promise<import('../src/types/lecture.ts').CapturedFrame[]>;
  },
  res: Response,
  signal: AbortSignal,
) {
  const steps = createInitialPipelineSteps();
  const updateStep = (stepNum: number, status: PipelineStepItem['status'], detail?: string) => {
    const idx = steps.findIndex((s) => s.step === stepNum);
    if (idx >= 0) {
      steps[idx] = { ...steps[idx], status, detail };
    }
  };

  updateStep(1, 'completed', options.sourceType === 'youtube' ? `YouTube (${options.videoId})` : '로컬 MP4');

  const hybrid = options.mode === 'full' && isHybrid(options.config.aiProvider);
  if (hybrid) requireOpenAIKey();
  const cacheKey = JSON.stringify([options.sourceType, options.videoId || options.titleHint, options.mode, options.config, hybrid ? openAIModel('slides') : 'gemini']);
  if (!options.forceRefresh && options.sourceType === 'youtube' && analysisCache.has(cacheKey)) {
    const cached = analysisCache.get(cacheKey)!;
    steps.forEach((s) => (s.status = 'completed'));
    sendSse(res, {
      stage: 'complete',
      activeModel: cached.videoMeta.modelUsed || 'cached',
      pipelineSteps: steps,
      message: '동일 영상·설정 분석 캐시를 재사용하여 즉시 불러왔습니다 (중복 API 호출 절감).',
      result: cached,
    });
    return;
  }

  // Step 2: Pre-flight API text connection test & free-tier model probe
  updateStep(2, 'running');
  sendSse(res, {
    stage: 'text_check',
    pipelineSteps: steps,
    message: '영상 분석 전, 무료 지원 Flash 계열 모델로 텍스트 API 연결 상태를 확인 중입니다...',
  });

  const connReport = await runConnectionAndModelProbe(ai, options.config.preferredModel);
  const primaryModel = connReport.activeModel;
  const backupModels = [
    ...connReport.availableFreeModels,
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-4-hydrogen',
  ].filter((m) => m !== primaryModel);

  const primaryProbe = connReport.testedCandidates.find((c) => c.model === primaryModel);
  if (!primaryProbe || primaryProbe.status !== 'ok') {
    updateStep(2, 'failed', '텍스트 연결 실패');
    const summaryErrors = connReport.testedCandidates.map((c) => `${c.model}: ${c.detail}`).join(' | ');
    throw new Error(`텍스트 API 연결 사전 테스트 실패 — ${summaryErrors}`);
  }
  updateStep(2, 'completed', `${primaryModel} (${primaryProbe.latencyMs}ms)`);

  // Step 3: First 30 seconds probe (0s - 30s)
  updateStep(3, 'running');
  sendSse(res, {
    stage: 'stage1_30s',
    activeModel: primaryModel,
    pipelineSteps: steps,
    message: `API 연결 정상 (${primaryModel}). 1단계: 영상 처음 30초(00:00~00:30) 화면·음성·자막 검증 분석 중...`,
  });

  const initial30sPart: Part =
    options.sourceType === 'youtube'
      ? buildYoutubeMediaPart(options.url, '0s', '30s')
      : {
          fileData: {
            fileUri: options.uploadedFileUri!,
            mimeType: options.uploadedMimeType || 'video/mp4',
          },
          videoMetadata: { startOffset: '0s', endOffset: '30s' },
        };

  const stage1Prompt = `당신은 한국폴리텍대학 등 대학 AI·소프트웨어 전공 교수의 강의안 제작을 돕는 멀티모달 교육 분석 전문가입니다.
이 초기 검증 단계에서는 영상의 **처음 30초 구간(00:00 ~ 00:30)** 만을 정밀 분석하세요. 25장 PPT 생성은 아직 수행하지 마세요.
- 화면에 보이는 인물, 자막, 슬라이드/도식/수식/코드를 구체적으로 기록하세요.
- 영상에서 실제로 확인된 사실("observedInVideo")과 학부생 보충 설명("supplementaryForStudents")을 구분하고, 확인되지 않은 내용은 추측하지 마세요.
${options.titleHint ? `참고 영상 제목: ${options.titleHint}` : ''}
${options.authorHint ? `참고 채널/저자: ${options.authorHint}` : ''}`;

  const stage1Call = await callGenerateContentWithRetry(
    ai,
    primaryModel,
    backupModels,
    (modelId) => ({
      model: modelId,
      contents: [{ role: 'user', parts: [initial30sPart, { text: stage1Prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: stage1PreviewSchema,
        systemInstruction:
          'Analyze ONLY the first 30 seconds (00:00-00:30) of the video in Korean JSON. Never fabricate details.',
      },
    }),
    (msg, modelId) =>
      sendSse(res, {
        stage: 'stage1_30s',
        activeModel: modelId,
        pipelineSteps: steps,
        message: msg,
      }),
    signal,
  );

  const stage1Data = JSON.parse((stage1Call.response.text ?? '{}').trim()) as {
    videoMeta: Omit<VideoMeta, 'sourceType' | 'url' | 'videoId' | 'analyzedAt' | 'modelUsed'>;
    executiveSummary: string;
    scenes: Array<Omit<SceneAnalysis, 'id' | 'startSeconds' | 'captureSeconds'>>;
  };

  const previewMeta: VideoMeta = {
    sourceType: options.sourceType,
    url: options.url,
    videoId: options.videoId,
    title: stage1Data.videoMeta?.title || options.titleHint || '제목 확인 불가',
    channelOrAuthor: stage1Data.videoMeta?.channelOrAuthor || options.authorHint || '확인 불가',
    durationFormatted: stage1Data.videoMeta?.durationFormatted || '00:30',
    language: stage1Data.videoMeta?.language || '확인 불가',
    analyzedAt: new Date().toISOString(),
    verificationNote: stage1Data.videoMeta?.verificationNote || '00:00~00:30 초기 검증 완료',
    modelUsed: stage1Call.modelUsed,
    hasRealFrames: false,
  };

  const previewScenes: SceneAnalysis[] = (stage1Data.scenes ?? []).map((scene, idx) => ({
    id: `scene-preview-${idx + 1}`,
    sceneNumber: scene.sceneNumber ?? idx + 1,
    startTime: scene.startTime || '00:00',
    endTime: scene.endTime || '00:30',
    startSeconds: parseTimeToSeconds(scene.startTime),
    title: scene.title || `초기 구간 장면 ${idx + 1}`,
    screenComposition: scene.screenComposition || '',
    visualDiagramsAndEquations: scene.visualDiagramsAndEquations || '',
    onScreenTextAndSubtitles: scene.onScreenTextAndSubtitles || '',
    audioCoreSummary: scene.audioCoreSummary || '',
    captureTimestamp: scene.captureTimestamp || scene.startTime || '00:00',
    captureSeconds: parseTimeToSeconds(scene.captureTimestamp || scene.startTime),
    captureGuide: scene.captureGuide || '',
    capturePriority: (() => {
      const p = String(scene.capturePriority || 'medium').trim().toLowerCase();
      return p === 'high' ? 'high' : p === 'low' ? 'low' : 'medium';
    })(),
    observedInVideo: Array.isArray(scene.observedInVideo) ? scene.observedInVideo : [],
    supplementaryForStudents: Array.isArray(scene.supplementaryForStudents)
      ? scene.supplementaryForStudents
      : [],
    unverifiedOrAmbiguous: scene.unverifiedOrAmbiguous || '확인되지 않은 모호한 요소 없음',
  }));

  updateStep(3, 'completed', `${previewScenes.length}개 초기 장면 확인`);

  const previewPartial: LectureAnalysisResult = {
    videoMeta: previewMeta,
    executiveSummary: stage1Data.executiveSummary || '',
    scenes: previewScenes,
    concepts: [],
    slides: [],
  };

  if (options.mode === 'preview30s') {
    sendSse(res, {
      stage: 'complete',
      activeModel: stage1Call.modelUsed,
      pipelineSteps: steps,
      message: `처음 30초(00:00~00:30) 검증 분석 완료 (사용 모델: ${stage1Call.modelUsed})`,
      result: previewPartial,
    });
    return;
  }

  // Step 4: Full Video Context, Storyline, Scenes & Concepts
  updateStep(4, 'running');
  sendSse(res, {
    stage: 'stage1_complete',
    activeModel: stage1Call.modelUsed,
    pipelineSteps: steps,
    message: `처음 30초 검증 성공. 2단계: 전체 영상 문맥·화면·음성·자막·수식·코드 종합 분석을 진행합니다...`,
    partialResult: previewPartial,
  });

  const fullMediaPart: Part =
    options.sourceType === 'youtube'
      ? buildYoutubeMediaPart(options.url)
      : {
          fileData: {
            fileUri: options.uploadedFileUri!,
            mimeType: options.uploadedMimeType || 'video/mp4',
          },
        };

  const phase1Prompt = `당신은 대학 인공지능·소프트웨어 전공 교수의 강의안 제작을 돕는 멀티모달 교육 분석 전문가입니다.
첨부된 전체 영상의 화면, 음성, 자막, 화면 텍스트, 도식, 그래프, 표, 수식, 아키텍처, 소스코드 및 전체 설명 흐름을 시간 순서대로 종합 분석하세요.

${buildConfigInstruction(options.config)}

[분석 및 사실 검증 원칙]
1. 단순 자막 요약이 아니라 실제 화면에 나타나는 시각 요소(인물, 인터뷰, 자막, 그래프, 수식, 아키텍처 도식, IDE/코드 실습 화면 등)와 음성을 통합 분석하세요.
2. "storyline" 항목에 영상 전체의 핵심 메시지, 도입/전개/결론 구조, 교육적 재구성 방향, 영상 성격(theory-heavy | practice-heavy | balanced)을 설계하세요.
3. 전체 영상을 시간 순서대로 **12~20개의 구별되는 고가치 주요 장면("scenes")** 으로 촘촘하게 분할하세요(영상 전반 00:00부터 후반 결론까지 고르게 분포).
   - 반드시 포함할 유형: 개념 설명, 기존 방식의 한계(순차 처리 vs 병렬 처리 비교), 전체 아키텍처 다이어그램, 단어/토큰 정렬(alignment)·어텐션 시각화, 수식·그래프, 성능 비교 차트, 실제 응용 사례, 결론.
   - 각 장면의 "captureTimestamp"(MM:SS)는 서로 최소 15초 이상 구별되고 실제 시각 자료(다이어그램/수식/그래프/코드/핵심 자막)가 화면에 뚜렷이 보이는 시점으로 선택하세요. 동일한 화면이나 단순 인물 클로즈업을 중복 추출하지 마세요.
4. 검은 화면, 흐릿한 전환 화면이 아닌 핵심 정보가 명확히 보이는 시점을 캡처 추천 시점으로 고르세요.
5. "observedInVideo"에는 영상에서 실제로 본 것/들은 것만 적고, "supplementaryForStudents"에는 학부생 이해를 위한 보충 설명을 적으세요. 확인되지 않은 정보는 "unverifiedOrAmbiguous"에 명시하세요.
6. "concepts"에는 영상 주제(예: Transformer/Attention 또는 해당 영상의 핵심 기술)와 관련된 8~14개 핵심 개념을 정리하고, Transformer 관련 주제일 경우 Vaswani et al. (2017) "Attention Is All You Need" (https://arxiv.org/abs/1706.03762) 등 신뢰할 수 있는 공식 출처를 "academicReference"에 정확히 기재하세요. 확인하지 못한 논문/수치는 절대 지어내지 마세요.
${options.titleHint ? `참고 영상 제목: ${options.titleHint}` : ''}
${options.authorHint ? `참고 채널/저자: ${options.authorHint}` : ''}`;

  const stage2Call = await callGenerateContentWithRetry(
    ai,
    stage1Call.modelUsed,
    backupModels,
    (modelId) => ({
      model: modelId,
      contents: [{ role: 'user', parts: [fullMediaPart, { text: phase1Prompt }] }],
      config: {
        maxOutputTokens: 24576,
        responseMimeType: 'application/json',
        responseSchema: phase1Schema,
        systemInstruction:
          'Return valid JSON matching phase1Schema with 12-20 distinct scenes across the entire video timeline. Strictly separate video-observed facts from supplementary academic context. Never fabricate citations or observations.',
      },
    }),
    (msg, modelId) =>
      sendSse(res, {
        stage: 'phase1_scenes',
        activeModel: modelId,
        pipelineSteps: steps,
        message: msg,
      }),
    signal,
  );

  const phase1Data = JSON.parse((stage2Call.response.text ?? '{}').trim()) as {
    videoMeta: Omit<VideoMeta, 'sourceType' | 'url' | 'videoId' | 'analyzedAt' | 'modelUsed'>;
    executiveSummary: string;
    storyline: VideoStoryline;
    scenes: Array<Omit<SceneAnalysis, 'id' | 'startSeconds' | 'captureSeconds'>>;
    concepts: Array<Omit<TechnicalConcept, 'id'>>;
  };

  const scenes: SceneAnalysis[] = (phase1Data.scenes ?? []).map((scene, idx) => ({
    id: `scene-${idx + 1}`,
    sceneNumber: scene.sceneNumber ?? idx + 1,
    startTime: scene.startTime || '00:00',
    endTime: scene.endTime || '00:00',
    startSeconds: parseTimeToSeconds(scene.startTime),
    title: scene.title || `장면 ${idx + 1}`,
    screenComposition: scene.screenComposition || '',
    visualDiagramsAndEquations: scene.visualDiagramsAndEquations || '',
    onScreenTextAndSubtitles: scene.onScreenTextAndSubtitles || '',
    audioCoreSummary: scene.audioCoreSummary || '',
    captureTimestamp: scene.captureTimestamp || scene.startTime || '00:00',
    captureSeconds: parseTimeToSeconds(scene.captureTimestamp || scene.startTime),
    captureGuide: scene.captureGuide || '',
    capturePriority: (() => {
      const p = String(scene.capturePriority || 'medium').trim().toLowerCase();
      return p === 'high' ? 'high' : p === 'low' ? 'low' : 'medium';
    })(),
    observedInVideo: Array.isArray(scene.observedInVideo) ? scene.observedInVideo : [],
    supplementaryForStudents: Array.isArray(scene.supplementaryForStudents)
      ? scene.supplementaryForStudents
      : [],
    unverifiedOrAmbiguous: scene.unverifiedOrAmbiguous || '확인되지 않은 모호한 요소 없음',
  }));

  const concepts: TechnicalConcept[] = (phase1Data.concepts ?? []).map((c, idx) => ({
    id: `concept-${idx + 1}`,
    nameKo: c.nameKo || '',
    nameEn: c.nameEn || '',
    category: (c.category as TechnicalConcept['category']) || 'Other',
    appearedInVideo: Boolean(c.appearedInVideo),
    videoTimestampRef:
      c.videoTimestampRef || (c.appearedInVideo ? '시점 확인 필요' : '영상 미언급 (학부 보충 개념)'),
    matrixDimensions: c.matrixDimensions || '',
    formulaLatex: c.formulaLatex || '',
    videoExplanation: c.videoExplanation || '',
    studentSupplementary: c.studentSupplementary || '',
    academicReference: c.academicReference || (c.appearedInVideo ? '영상 내 설명 근거' : '확인 필요'),
  }));

  updateStep(4, 'completed', `장면 ${scenes.length}개 · 개념 ${concepts.length}개 추출`);

  // Step 5: Real Video Frame Extraction (when authorized MP4 file is available)
  let extractedFrames: import('../src/types/lecture.ts').CapturedFrame[] = [];
  if (options.localMp4Path && options.onExtractMp4Frames && options.config.autoInsertVideoFrames) {
    updateStep(5, 'running');
    sendSse(res, {
      stage: 'frame_extraction',
      activeModel: stage2Call.modelUsed,
      pipelineSteps: steps,
      message: `업로드된 MP4 파일에서 FFmpeg로 주요 장면(${scenes.length}개)의 실제 고선명 프레임을 자동 추출 중입니다...`,
    });
    const targets = scenes.map((s) => ({
      timestampSeconds: s.captureSeconds,
      label: `${s.title} (${s.visualDiagramsAndEquations || s.screenComposition})`,
    }));
    extractedFrames = await options.onExtractMp4Frames(
      options.localMp4Path,
      targets,
      phase1Data.videoMeta?.title || options.titleHint || '로컬 강의 영상',
    );
    updateStep(5, 'completed', `실제 프레임 ${extractedFrames.length}장 추출 완료`);
  } else {
    updateStep(
      5,
      'skipped',
      options.sourceType === 'youtube'
        ? 'YouTube 정책 준수: 로컬 MP4 연결 시 자동 프레임 추출 가능'
        : '자동 프레임 추출 비활성화',
    );
  }

  const videoMeta: VideoMeta = {
    sourceType: options.sourceType,
    url: options.url,
    videoId: options.videoId,
    title: phase1Data.videoMeta?.title || previewMeta.title,
    channelOrAuthor: phase1Data.videoMeta?.channelOrAuthor || previewMeta.channelOrAuthor,
    durationFormatted: phase1Data.videoMeta?.durationFormatted || previewMeta.durationFormatted,
    language: phase1Data.videoMeta?.language || previewMeta.language,
    analyzedAt: new Date().toISOString(),
    verificationNote: phase1Data.videoMeta?.verificationNote || '',
    modelUsed: stage2Call.modelUsed,
    hasRealFrames: extractedFrames.length > 0,
  };

  const slideTarget = resolveTargetSlideCount(options.config);

  sendSse(res, {
    stage: 'phase1_complete',
    activeModel: stage2Call.modelUsed,
    pipelineSteps: steps,
    extractedFrames,
    message: `전체 문맥·장면(${scenes.length}개)·개념(${concepts.length}개) 분석 완료. 3단계: 총 ${slideTarget}장 다중 레이아웃 슬라이드 및 교수자 대본을 분할 생성 중입니다...`,
    partialResult: {
      videoMeta,
      executiveSummary: phase1Data.executiveSummary || '',
      storyline: phase1Data.storyline,
      scenes,
      concepts,
    },
  });

  // Step 6 & 7: Batched Storyline-driven Multi-Layout Slide Deck (12-13 slides per batch so 25-60 slides are never truncated)
  updateStep(6, 'running');
  const batchSize = 13;
  const collectedRawSlides: Array<Omit<LectureSlide, 'captureSeconds'>> = [];
  let activeSlideModel = hybrid ? openAIModel('slides') : stage2Call.modelUsed;
  const phase1ContextJson = JSON.stringify({
    videoMeta,
    executiveSummary: phase1Data.executiveSummary,
    storyline: phase1Data.storyline,
    scenes,
    concepts,
  });

  const totalBatches = Math.ceil(slideTarget / batchSize);
  for (let b = 0; b < totalBatches; b++) {
    const startNum = b * batchSize + 1;
    const endNum = Math.min(slideTarget, (b + 1) * batchSize);
    const batchCount = endNum - startNum + 1;

    sendSse(res, {
      stage: 'phase2_slides',
      activeModel: stage2Call.modelUsed,
      pipelineSteps: steps,
      message: `3단계 [${activeSlideModel}]: 전체 ${slideTarget}장 중 ${startNum}~${endNum}번 슬라이드 배치 생성 중 (${b + 1}/${totalBatches})...`,
    });

    const prevSummary =
      collectedRawSlides.length > 0
        ? `[이전 배치 연속성 정보]
- 직전 생성 완료 슬라이드: ${collectedRawSlides.slice(-3).map((sl) => `Slide ${sl.slideNumber} [${sl.section}] "${sl.titleKo}" (captureTimestamp=${sl.captureTimestamp})`).join(' -> ')}
- 이미 사용된 주요 captureTimestamp: ${Array.from(new Set(collectedRawSlides.map((sl) => sl.captureTimestamp).filter((ts) => ts && ts !== '해당 없음'))).join(', ') || '없음'}
- 위 슬라이드에 이어 Slide ${startNum}부터 자연스럽게 강의를 계속 이어가고, 같은 캡처 시점을 불필요하게 중복 배정하지 마세요.`
        : `[첫 번째 배치 안내] Slide 1은 반드시 cover(강의 표지), Slide 2는 objectives(학습목표), Slide 3은 agenda(전체 목차)로 시작하세요.`;

    const batchClosingRule =
      b === totalBatches - 1
        ? `[마지막 배치 마무리 안내] 마지막 3장은 반드시 summary(핵심 요약), quiz(학습 확인 퀴즈 — includeQuiz=${options.config.includeQuiz ? 'true' : 'false'}), references(참고문헌 및 영상 출처)로 완결하세요.`
        : `[중간 배치 연결 안내] 이번 배치는 Slide ${endNum}까지 생성하고 이후 Slide ${endNum + 1}~${slideTarget}이 이어질 예정이므로 결론/요약/퀴즈로 조기 종료하지 마세요.`;

    const batchPrompt = `검증된 영상 전체 분석 결과(스토리라인, 장면 ${scenes.length}개, 개념 ${concepts.length}개)를 바탕으로, 전체 **${slideTarget}장** 대학 전공 강의 덱 중 **정확히 ${batchCount}장(Slide ${startNum} ~ Slide ${endNum})** 을 생성하세요.
배열 "slides"의 원소 개수는 반드시 **${batchCount}개**여야 하며, 각 슬라이드의 "slideNumber"는 ${startNum}부터 ${endNum}까지 1씩 증가해야 합니다. 10장 내외로 임의 축약하지 마세요.

${buildConfigInstruction(options.config)}

${prevSummary}
${batchClosingRule}

[슬라이드 레이아웃 다양화 규칙 — 절대 모든 슬라이드를 같은 레이아웃으로 만들지 마세요]
각 슬라이드의 "slideType"은 목적에 따라 다음 중 가장 적합한 것을 다양하게 배정하세요:
- cover (표지 — Slide 1)
- objectives (학습목표 — Slide 2)
- agenda (학습 목차 — Slide 3)
- video-hero (영상 실제 캡처 화면을 55~70% 크게 배치하는 핵심 장면 슬라이드)
- image-left-text / image-right-text (영상 캡처/도식 + 핵심 키워드 2단)
- multi-capture-compare (2~4개 영상 장면을 비교·시간순 배치)
- timeline (기술 발전 타임라인 — "timelineSteps" 배열 필수 입력)
- comparison-table (기존 기술 vs 신규 기술 비교표 — "comparisonTable" headers/rows 필수 입력)
- architecture-diagram (시스템 아키텍처 도식 — 적절한 "diagramPreset" 선택)
- process-steps (단계별 데이터/연산 흐름 — "timelineSteps" 활용)
- equation-focus (수학적 원리·수식 집중 — "equationLatex", "equationVariables", "matrixNote" 필수)
- matrix-stepwise (행렬 연산 및 차원 변화·구체적 숫자 예제 — "numericExample" 포함)
- code-lab (프로그래밍 실습 및 소스코드 — "codeBlock" language/code/explanation 필수)
- case-study (실제 활용 및 산업 현장 사례)
- key-concept (핵심 개념 강조 callout — "keyHighlight" 필수)
- summary (핵심 내용 요약)
- quiz (학생 학습 확인 문제 및 해설 — "quizItem" 필수)
- references (참고문헌 및 영상 출처)

[대학 전공 강의 전체 흐름 편성(총 ${slideTarget}장 기준)]
- 도입(1~3): 표지 → 학습목표 → 강의 목차
- 배경/동기(4~6): 기존 기술(RNN/Seq2Seq 등)의 한계, 순차 vs 병렬 처리, 영상 핵심 도입 장면
- 핵심 원리 및 아키텍처(7~14): 전체 구조, 어텐션/정렬 직관, Encoder/Decoder 세부 블록, 실제 영상 장면별 해설
- 수식·행렬·구현(15~19): 핵심 수식 유도, 행렬 차원 추적 및 수치 예제, Python/PyTorch 실습 코드
- 심화/비교/활용(20~${Math.max(22, slideTarget - 3)}): 성능/복잡도 비교표, 산업/실제 활용 사례, 장단점 심화
- 마무리(${Math.max(23, slideTarget - 2)}~${slideTarget}): 핵심 요약 → 학습 확인 퀴즈·해설 → 참고문헌

[텍스트 넘침 방지 및 교수자 스크립트 규칙]
1. 슬라이드 본문("bullets")은 3~4개 이내, 각 불릿은 강의실 프로젝터에서 20~26pt로 선명하게 읽히는 핵심 키워드/짧은 문장(42자 내외)으로 압축하고, 구체적 설명·비유·유도 과정은 모두 "speakerScript"(발표자 노트)로 옮기세요.
2. "sourceTier"를 엄격히 분류하세요:
   - "A": 영상에서 직접 확인된 내용 중심
   - "B": 영상 내용과 연계된 학부 보충 설명
   - "C": 영상에 등장하지 않지만 전공 교육을 위해 추가한 학술적 설명
3. 실제 영상 장면과 슬라이드 주제가 정확히 일치하는 "captureTimestamp"(MM:SS)만 매칭하세요. 관련 화면이 없으면 "captureTimestamp": "해당 없음"으로 두고 적절한 "diagramPreset"을 고르세요.
4. Transformer 관련 주제인 경우 Vaswani et al. (2017) "Attention Is All You Need" (https://arxiv.org/abs/1706.03762) 등 실제 검증된 논문만 "academicReferences"에 넣고, RNN vs Self-Attention 복잡도/순차연산, Q/K/V 차원, Scaling(√d_k) 분산 유지 목적, Positional Encoding, Residual+LayerNorm, 학습 병렬화 vs 추론 자기회귀 차이를 정확히 구분하세요.
5. "speakerScript"는 실제 대학 강의실에서 교수가 말하듯 자연스러운 한국어 구어체로 작성하세요: 이전 슬라이드 연결 멘트 → 핵심 개념 및 화면/이미지 설명 → 쉬운 비유/수식 → 학생 혼동 포인트 → 다음 슬라이드 전환 멘트 → [예상 시간: X분]. 단, 실제 영상 프레임이 아직 확보되지 않았다면 "영상 해당 구간(MM:SS) 참고" 형태로 작성하세요.

[검증된 2단계 분석 데이터]
${phase1ContextJson}`;

    const batchCall = hybrid
      ? await callOpenAIJson({
          purpose: 'slides',
          parts: [{ text: batchPrompt + '\n[추가 필수 조건] 영상 분석 데이터에 없는 사실은 보충 설명으로만 분류하고, 출처를 확인할 수 없으면 미검증으로 표시하세요. 수식이 없으면 빈 문자열을 사용하세요. 실습 슬라이드는 실제 실행 가능한 코드와 예상 출력 또는 차원 정보를 포함하세요. 총 강의시간을 고려해 구체적이고 읽기 쉬운 교수자 대본을 작성하세요.' }],
          schema: phase2Schema,
          instructions: `Return exactly ${batchCount} slides numbered ${startNum}–${endNum}. Keep video evidence and academic supplementation separate.`,
          maxOutputTokens: 24576,
          signal,
        })
      : await callGenerateContentWithRetry(
      ai,
      activeSlideModel,
      backupModels,
      (modelId) => ({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: batchPrompt }] }],
        config: {
          maxOutputTokens: 24576,
          responseMimeType: 'application/json',
          responseSchema: phase2Schema,
          systemInstruction: `Generate EXACTLY ${batchCount} slides (slideNumber ${startNum} through ${endNum} out of ${slideTarget}) in valid JSON. Never truncate or combine slides below ${batchCount}.`,
        },
      }),
      (msg, modelId) =>
        sendSse(res, {
          stage: 'phase2_slides',
          activeModel: modelId,
          pipelineSteps: steps,
          message: msg,
        }),
      signal,
    );

    activeSlideModel = batchCall.modelUsed;
    const batchData = JSON.parse((batchCall.response.text ?? '{}').trim()) as {
      slides?: Array<Omit<LectureSlide, 'captureSeconds'>>;
    };
    if (!Array.isArray(batchData.slides) || batchData.slides.length !== batchCount ||
        batchData.slides.some((slide, i) => slide.slideNumber !== startNum + i ||
          typeof slide.titleKo !== 'string' || !Array.isArray(slide.bullets) || typeof slide.speakerScript !== 'string')) {
      throw new Error(`${activeSlideModel} 슬라이드 배치 ${startNum}~${endNum} 응답의 장수 또는 구조가 올바르지 않습니다. 불완전한 PPTX 생성을 중단합니다.`);
    }
    collectedRawSlides.push(...batchData.slides);
  }

  const slides: LectureSlide[] = collectedRawSlides.map((slide, idx) => {
    const capSec =
      slide.captureTimestamp && slide.captureTimestamp !== '해당 없음'
        ? parseTimeToSeconds(slide.captureTimestamp)
        : 0;

    // Auto-match closest extracted real frames if MP4 was provided
    const matchedIds: string[] = [];
    if (extractedFrames.length > 0 && slide.captureTimestamp && slide.captureTimestamp !== '해당 없음') {
      const sorted = [...extractedFrames]
        .map((f) => ({ id: f.id, diff: Math.abs(f.timestampSeconds - capSec) }))
        .sort((a, b) => a.diff - b.diff);
      if (sorted[0] && sorted[0].diff <= 15) {
        matchedIds.push(sorted[0].id);
        if (slide.slideType === 'multi-capture-compare' && sorted[1]) {
          matchedIds.push(sorted[1].id);
        }
      }
    }

    return {
      slideNumber: idx + 1,
      section: slide.section || '01. 강의 본론',
      titleKo: slide.titleKo || `슬라이드 ${idx + 1}`,
      titleEn: slide.titleEn || '',
      slideType: slide.slideType || 'image-right-text',
      estimatedMinutes: Number(slide.estimatedMinutes) || 1,
      bullets: Array.isArray(slide.bullets) ? slide.bullets : [],
      keyHighlight: slide.keyHighlight || '',
      equationLatex: slide.equationLatex || '',
      matrixNote: slide.matrixNote || '',
      equationVariables: Array.isArray(slide.equationVariables) ? slide.equationVariables : [],
      numericExample: slide.numericExample || '',
      comparisonTable: slide.comparisonTable,
      codeBlock: slide.codeBlock,
      timelineSteps: Array.isArray(slide.timelineSteps) ? slide.timelineSteps : [],
      quizItem: slide.quizItem,
      diagramPreset: slide.diagramPreset || 'none',
      diagramCaption: slide.diagramCaption || '',
      captureTimestamp: slide.captureTimestamp || '해당 없음',
      captureSeconds: capSec,
      captureGuideText: slide.captureGuideText || '',
      capturedFrameIds: matchedIds,
      sourceBoundary: slide.sourceBoundary || 'video-plus-supplementary',
      sourceTier: (() => {
        const t = String(slide.sourceTier || 'B').trim().toUpperCase();
        return t === 'A' ? 'A' : t === 'C' ? 'C' : 'B';
      })(),
      videoBasedPoints: slide.videoBasedPoints || '',
      supplementaryPoints: slide.supplementaryPoints || '',
      academicReferences: Array.isArray(slide.academicReferences) ? slide.academicReferences : [],
      speakerScript: slide.speakerScript || '',
    };
  });

  videoMeta.slideModelUsed = activeSlideModel;
  updateStep(6, 'completed', `${slides.length}장 다중 레이아웃 설계 (${activeSlideModel})`);
  updateStep(7, 'completed', '출처 A/B/C 분류 및 발표자 노트 생성');

  const fullResult: LectureAnalysisResult = {
    videoMeta,
    executiveSummary: phase1Data.executiveSummary || '',
    storyline: phase1Data.storyline,
    scenes,
    concepts,
    slides,
  };

  if (options.sourceType === 'youtube') {
    analysisCache.set(cacheKey, fullResult);
  }

  sendSse(res, {
    stage: 'complete',
    activeModel: stage2Call.modelUsed,
    pipelineSteps: steps,
    extractedFrames,
    message: `전체 강의자료 생성 완료 (영상 ${stage2Call.modelUsed} / 슬라이드 ${activeSlideModel}) — 장면 ${scenes.length}개, 개념 ${concepts.length}개, 슬라이드 ${slides.length}장`,
    result: fullResult,
  });
}
