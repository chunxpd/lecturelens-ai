export type DiagramPreset =
  | 'none'
  | 'seq2seq-bottleneck'
  | 'attention-alignment'
  | 'qkv-projection'
  | 'scaled-dot-product'
  | 'multi-head-attention'
  | 'positional-encoding'
  | 'transformer-architecture'
  | 'pipeline-overview';

export type SlideLayoutType =
  | 'cover'
  | 'objectives'
  | 'agenda'
  | 'video-hero'
  | 'image-left-text'
  | 'image-right-text'
  | 'multi-capture-compare'
  | 'timeline'
  | 'comparison-table'
  | 'architecture-diagram'
  | 'process-steps'
  | 'equation-focus'
  | 'matrix-stepwise'
  | 'chart-analysis'
  | 'code-lab'
  | 'case-study'
  | 'key-concept'
  | 'summary'
  | 'quiz'
  | 'references';

export type SourceBoundary =
  | 'video-only'
  | 'video-plus-supplementary'
  | 'supplementary-bridge';

/** Section 12 strict source classification: A=영상 직접 확인, B=영상 연계 학부 보충, C=전공 교육용 학술 추가 */
export type SourceTier = 'A' | 'B' | 'C';

export type ConceptCategory =
  | 'Sequence Modeling'
  | 'Attention Mechanism'
  | 'Transformer Architecture'
  | 'Training & Optimization'
  | 'Programming & Systems'
  | 'Other';

export type StudentLevel =
  | 'intro'
  | 'undergrad-basic'
  | 'undergrad-mid'
  | 'undergrad-adv'
  | 'grad';

export type LectureType = 'theory' | 'practice' | 'hybrid';
export type VideoImageWeight = 'low' | 'medium' | 'high' | 'max';
export type ScriptDetailLevel = 'brief' | 'standard' | 'detailed' | 'verbatim';
export type LanguageMode = 'ko-en' | 'ko' | 'en';
export type DesignThemeId = 'navy-teal' | 'cobalt-slate' | 'charcoal-gold' | 'ivory-academic' | 'custom-template';

export interface ReferenceThemeProfile {
  fileName: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  headingFont: string;
  bodyFont: string;
  slideCount: number;
  layoutPatterns: string[];
  notesSummary: string;
}

export interface LectureConfig {
  courseName: string;
  lectureTopic: string;
  professorName: string;
  durationMinutes: number;
  slideCountMode: 'auto' | 'custom';
  targetSlideCount: number;
  studentLevel: StudentLevel;
  lectureType: LectureType;
  videoImageWeight: VideoImageWeight;
  autoInsertVideoFrames: boolean;
  includeEquations: boolean;
  includeMatrixExamples: boolean;
  includeCodeExamples: boolean;
  includeUseCases: boolean;
  includeIndustryCases: boolean;
  includeQuiz: boolean;
  includeSpeakerScript: boolean;
  scriptDetail: ScriptDetailLevel;
  languageMode: LanguageMode;
  themeId: DesignThemeId;
  preferredModel: string;
  aiProvider: 'gemini' | 'hybrid';
  referenceTemplate?: ReferenceThemeProfile | null;
  referencePdfSummary?: string;
}

export const DEFAULT_LECTURE_CONFIG: LectureConfig = {
  courseName: 'AI응용기술',
  lectureTopic: '',
  professorName: '',
  durationMinutes: 25,
  slideCountMode: 'auto',
  targetSlideCount: 25,
  studentLevel: 'undergrad-mid',
  lectureType: 'hybrid',
  videoImageWeight: 'max',
  autoInsertVideoFrames: true,
  includeEquations: true,
  includeMatrixExamples: true,
  includeCodeExamples: true,
  includeUseCases: true,
  includeIndustryCases: true,
  includeQuiz: true,
  includeSpeakerScript: true,
  scriptDetail: 'verbatim',
  languageMode: 'ko-en',
  themeId: 'navy-teal',
  preferredModel: 'auto',
  aiProvider: 'gemini',
  referenceTemplate: null,
  referencePdfSummary: '',
};

export interface CapturedFrame {
  id: string;
  timestampSeconds: number;
  timestampFormatted: string;
  imageDataUrl: string;
  width: number;
  height: number;
  sharpnessScore: number;
  luminanceAvg: number;
  imageHash?: string;
  /** Capture pipeline revision; legacy captures must be rechecked before reuse. */
  captureQualityVersion?: number;
  sourceType: 'youtube-tab-capture' | 'mp4-local' | 'mp4-ffmpeg' | 'manual-upload';
  sourceLabel: string;
  sourceUrl?: string;
  visualSummary: string;
  visionObservedText?: string;
  visionTags?: string[];
  visionProvider?: 'gemini' | 'hybrid';
}

export interface VideoMeta {
  sourceType: 'youtube' | 'upload';
  url: string;
  videoId: string;
  title: string;
  channelOrAuthor: string;
  durationFormatted: string;
  language: string;
  analyzedAt: string;
  verificationNote: string;
  modelUsed?: string;
  slideModelUsed?: string;
  hasRealFrames?: boolean;
}

export interface VideoStoryline {
  coreMessage: string;
  introSummary: string;
  bodySummary: string;
  conclusionSummary: string;
  pedagogicalReorderNote: string;
  domainType: 'theory-heavy' | 'practice-heavy' | 'balanced';
}

export interface SceneAnalysis {
  id: string;
  sceneNumber: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  title: string;
  screenComposition: string;
  visualDiagramsAndEquations: string;
  onScreenTextAndSubtitles: string;
  audioCoreSummary: string;
  captureTimestamp: string;
  captureSeconds: number;
  captureGuide: string;
  capturePriority: 'high' | 'medium' | 'low';
  observedInVideo: string[];
  supplementaryForStudents: string[];
  unverifiedOrAmbiguous: string;
}

export interface TechnicalConcept {
  id: string;
  nameKo: string;
  nameEn: string;
  category: ConceptCategory;
  appearedInVideo: boolean;
  videoTimestampRef: string;
  matrixDimensions: string;
  formulaLatex: string;
  videoExplanation: string;
  studentSupplementary: string;
  academicReference: string;
}

export interface ComparisonTableData {
  headers: string[];
  rows: string[][];
}

export interface CodeBlockData {
  language: string;
  code: string;
  explanation: string;
}

export interface TimelineStep {
  label: string;
  title: string;
  detail: string;
}

export interface QuizItem {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface EquationVariable {
  symbol: string;
  meaning: string;
}

export interface LectureSlide {
  slideNumber: number;
  section: string;
  titleKo: string;
  titleEn: string;
  slideType: SlideLayoutType;
  estimatedMinutes: number;
  bullets: string[];
  keyHighlight?: string;
  equationLatex: string;
  matrixNote: string;
  equationVariables?: EquationVariable[];
  numericExample?: string;
  comparisonTable?: ComparisonTableData;
  codeBlock?: CodeBlockData;
  timelineSteps?: TimelineStep[];
  quizItem?: QuizItem;
  diagramPreset: DiagramPreset;
  diagramCaption: string;
  captureTimestamp: string;
  captureSeconds: number;
  captureGuideText: string;
  capturedFrameIds?: string[];
  visionVerified?: 'verified' | 'needs-review' | 'unverified';
  visionMatchNote?: string;
  sourceBoundary: SourceBoundary;
  sourceTier: SourceTier;
  videoBasedPoints: string;
  supplementaryPoints: string;
  academicReferences?: string[];
  speakerScript: string;
}

export interface LectureAnalysisResult {
  videoMeta: VideoMeta;
  executiveSummary: string;
  storyline?: VideoStoryline;
  scenes: SceneAnalysis[];
  concepts: TechnicalConcept[];
  slides: LectureSlide[];
}

export interface LectureProject {
  id: string;
  name: string;
  courseName: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  youtubeUrl: string;
  config: LectureConfig;
  analysis: LectureAnalysisResult | null;
  capturedFrames: Record<string, CapturedFrame>;
}

export interface LayoutIssue {
  slideNumber: number;
  severity: 'adjusted' | 'warning';
  message: string;
}

export interface PptxZipAudit {
  slideCount: number;
  mediaImageCount: number;
  notesSlideCount: number;
  totalMediaBytes: number;
  brokenMediaCount: number;
}

export interface LayoutValidationReport {
  totalSlides: number;
  checkedAt: string;
  passed: boolean;
  issues: LayoutIssue[];
  missingFrameSlides?: number[];
  zipAudit?: PptxZipAudit;
  verificationDisclaimer: string;
}

export interface ModelProbeEntry {
  model: string;
  status: 'ok' | 'unavailable' | 'not_found' | 'error';
  latencyMs?: number;
  detail: string;
}

export interface ModelConnectionReport {
  activeModel: string;
  testedCandidates: ModelProbeEntry[];
  availableFreeModels: string[];
  allGeminiModels: string[];
  testedAt: string;
}

export interface PipelineStepItem {
  step: number;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  detail?: string;
}

export interface AnalysisProgressEvent {
  stage:
    | 'validating'
    | 'text_check'
    | 'stage1_30s'
    | 'stage1_complete'
    | 'phase1_scenes'
    | 'phase1_complete'
    | 'frame_extraction'
    | 'phase2_slides'
    | 'complete'
    | 'error';
  message: string;
  activeModel?: string;
  pipelineSteps?: PipelineStepItem[];
  partialResult?: Partial<LectureAnalysisResult>;
  extractedFrames?: CapturedFrame[];
  result?: LectureAnalysisResult;
  error?: string;
  failedStage?: 'text_check' | 'stage1_30s' | 'phase1_scenes' | 'phase2_slides';
}
