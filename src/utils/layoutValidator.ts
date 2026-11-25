import type { LayoutIssue, LayoutValidationReport, LectureSlide } from '../types/lecture';

export interface BoxRect {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
export const SAFE_MARGIN = 0.45;

export function estimateTextHeightInches(
  lines: string[],
  boxWidthIn: number,
  fontSizePt: number,
  lineSpacing = 1.3,
): number {
  const usableW = Math.max(1.5, boxWidthIn - 0.35);
  // Approx avg character width in inches at given pt (CJK wider than ASCII)
  const charsPerLine = Math.max(
    14,
    Math.floor((usableW * 72) / (fontSizePt * 0.85)),
  );
  let totalLines = 0;
  for (const line of lines) {
    const visualLen = Array.from(line).reduce(
      (acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 1.35 : 0.72),
      0,
    );
    totalLines += Math.max(1, Math.ceil(visualLen / charsPerLine));
  }
  const lineHeightIn = (fontSizePt * lineSpacing) / 72;
  return totalLines * lineHeightIn + lines.length * 0.08 + 0.25;
}

export function boxesOverlap(a: BoxRect, b: BoxRect, minGap = 0.05): boolean {
  return !(
    a.x + a.w + minGap <= b.x ||
    b.x + b.w + minGap <= a.x ||
    a.y + a.h + minGap <= b.y ||
    b.y + b.h + minGap <= a.y
  );
}

export function validateBoxBounds(slideNumber: number, boxes: BoxRect[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const box of boxes) {
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.w > SLIDE_W + 0.02 ||
      box.y + box.h > SLIDE_H + 0.02
    ) {
      issues.push({
        slideNumber,
        severity: 'warning',
        message: `[${box.label}] 영역이 슬라이드 경계(13.33×7.5in)를 벗어났습니다.`,
      });
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j], 0.02)) {
        issues.push({
          slideNumber,
          severity: 'warning',
          message: `[${boxes[i].label}]와 [${boxes[j].label}] 영역이 겹칩니다.`,
        });
      }
    }
  }
  return issues;
}

export function normalizeSlideForOverflow(slide: LectureSlide): {
  slide: LectureSlide;
  issues: LayoutIssue[];
} {
  const issues: LayoutIssue[] = [];
  let updatedBullets = [...slide.bullets];
  let updatedScript = slide.speakerScript;

  // Enforce concise slide bullets (max 5 bullets, ~72 chars each) while preserving detail in Speaker Notes
  const overflowDetails: string[] = [];
  if (updatedBullets.length > 5) {
    overflowDetails.push(...updatedBullets.slice(5));
    updatedBullets = updatedBullets.slice(0, 5);
    issues.push({
      slideNumber: slide.slideNumber,
      severity: 'adjusted',
      message: '본문 항목이 5개를 초과하여 초과 항목을 발표자 노트로 이동했습니다.',
    });
  }

  updatedBullets = updatedBullets.map((b) => {
    if (b.length > 88) {
      overflowDetails.push(b);
      issues.push({
        slideNumber: slide.slideNumber,
        severity: 'adjusted',
        message: '긴 본문 문장을 슬라이드 요약형으로 압축하고 원문을 발표자 노트에 보존했습니다.',
      });
      return `${b.slice(0, 82).trim()}…`;
    }
    return b;
  });

  if (overflowDetails.length > 0) {
    const appendix = `\n\n[본문 압축 보충 원문]\n${overflowDetails.map((d) => `• ${d}`).join('\n')}`;
    if (!updatedScript.includes('[본문 압축 보충 원문]')) {
      updatedScript = `${updatedScript}${appendix}`;
    }
  }

  return {
    slide: {
      ...slide,
      bullets: updatedBullets,
      speakerScript: updatedScript,
    },
    issues,
  };
}

export function validateDeckLayout(
  slides: LectureSlide[],
  perSlideBoxes: Array<{ slideNumber: number; boxes: BoxRect[] }>,
  preIssues: LayoutIssue[],
  missingFrameSlides: number[] = [],
  zipAudit?: import('../types/lecture').PptxZipAudit,
): LayoutValidationReport {
  const allIssues: LayoutIssue[] = [...preIssues];
  for (const item of perSlideBoxes) {
    allIssues.push(...validateBoxBounds(item.slideNumber, item.boxes));
  }

  const hasWarnings = allIssues.some((i) => i.severity === 'warning');
  return {
    totalSlides: slides.length,
    checkedAt: new Date().toISOString(),
    passed: !hasWarnings,
    issues: allIssues,
    missingFrameSlides,
    zipAudit,
    verificationDisclaimer:
      '개체 좌표(13.333×7.5in 경계), 개체 간 겹침 여부, PPTX 내부 미디어/노트 XML, 캡처 이미지 누락 여부를 프로그램으로 검증했습니다. 실제 PowerPoint 앱에서의 최종 글꼴 줄바꿈 렌더링은 PowerPoint에서 열어 확인하세요.',
  };
}
