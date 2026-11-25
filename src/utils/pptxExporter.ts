import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import type {
  CapturedFrame,
  LayoutIssue,
  LayoutValidationReport,
  LectureAnalysisResult,
  LectureConfig,
  LectureSlide,
  SourceTier,
} from '../types/lecture';
import { renderDiagramToPngDataUrl } from '../components/DiagramCanvas';
import { hasEquation, latexToReadableMath, renderLatexToPng } from './mathToImage';
import { supportsVideoFrame } from './frameSlideMatcher';
import {
  SLIDE_H,
  SLIDE_W,
  normalizeSlideForOverflow,
  validateDeckLayout,
  type BoxRect,
} from './layoutValidator';
import { resolveThemeTokens, type PptxThemeTokens } from './pptxThemeAndTemplate';

const TIER_LABELS: Record<SourceTier, string> = {
  A: '[출처 A: 영상 직접 확인]',
  B: '[출처 B: 영상 연계 학부 보충]',
  C: '[출처 C: 전공 교육 학술 추가]',
};

function findMatchedFrames(
  slide: LectureSlide,
  capturedFrames: Record<string, CapturedFrame>,
): CapturedFrame[] {
  if (!supportsVideoFrame(slide)) return [];
  const uniqueIds = [...new Set(slide.capturedFrameIds || [])];
  return uniqueIds.map((id) => capturedFrames[id]).filter(
    (frame): frame is CapturedFrame => Boolean(frame?.imageDataUrl?.startsWith('data:image/') && frame.width > 0 && frame.height > 0),
  );
}

async function isNonBlankMedia(bytes: Uint8Array, mime: string): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(bitmap.width, 192);
      canvas.height = Math.min(bitmap.height, 192);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || !canvas.width || !canvas.height) return false;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let first: number[] | null = null;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 16) continue;
        const color = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (!first) first = color;
        else if (color.some((v, c) => Math.abs(v - first![c]) > 8)) return true;
      }
      return false;
    } finally {
      bitmap.close();
    }
  } catch {
    return false;
  }
}

function fitAspectBox(
  imgW: number,
  imgH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } {
  const ratio = imgW > 0 && imgH > 0 ? imgW / imgH : 16 / 9;
  let w = boxW;
  let h = w / ratio;
  if (h > boxH) {
    h = boxH;
    w = h * ratio;
  }
  return {
    x: boxX + (boxW - w) / 2,
    y: boxY + (boxH - h) / 2,
    w,
    h,
  };
}

export interface PptxBuildResult {
  fileName: string;
  blob: Blob;
  validationReport: LayoutValidationReport;
  zipVerified: boolean;
}

export async function buildLecturePptx(
  analysis: LectureAnalysisResult,
  capturedFrames: Record<string, CapturedFrame>,
  config: LectureConfig,
): Promise<PptxBuildResult> {
  const theme: PptxThemeTokens = resolveThemeTokens(config.themeId, config.referenceTemplate);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  pptx.author = config.professorName || 'LectureLens AI 2.0';
  pptx.subject = analysis.videoMeta.title;
  pptx.title = `${config.courseName || '전공강의'} — ${analysis.videoMeta.title}`;

  const preIssues: LayoutIssue[] = [];
  const perSlideBoxes: Array<{ slideNumber: number; boxes: BoxRect[] }> = [];
  const missingFrameSlides: number[] = [];
  const expectedVideoFrames: Array<{ slideIndex: number; frames: CapturedFrame[] }> = [];
  const normalizedSlides = analysis.slides.map((raw) => {
    const res = normalizeSlideForOverflow(raw);
    preIssues.push(...res.issues);
    return res.slide;
  });

  for (let i = 0; i < normalizedSlides.length; i++) {
    const s = normalizedSlides[i];
    const pptSlide = pptx.addSlide();
    const boxes: BoxRect[] = [];
    const needsVideoFrame = Boolean(
      config.autoInsertVideoFrames && i !== 0 && supportsVideoFrame(s) &&
      ((s.captureTimestamp && s.captureTimestamp !== '해당 없음') || s.slideType === 'multi-capture-compare'),
    );
    const matchedFrames = needsVideoFrame ? findMatchedFrames(s, capturedFrames) : [];
    const insertedFrames: CapturedFrame[] = [];
    const finalizeSlideNotes = () => {
      if (needsVideoFrame && insertedFrames.length === 0) missingFrameSlides.push(s.slideNumber);
      if (insertedFrames.length) expectedVideoFrames.push({ slideIndex: i + 1, frames: insertedFrames });


    // Speaker Notes (preserve detailed script, raw LaTeX backup, and strict A/B/C attribution)
    const notesLines = [
      `[교수자 강의 스크립트 — Slide ${s.slideNumber} (예상 ${s.estimatedMinutes || 1}분)]`,
      s.speakerScript || '',
      '',
      TIER_LABELS[s.sourceTier] ?? TIER_LABELS.B,
      s.videoBasedPoints ? `• 영상 직접 근거: ${s.videoBasedPoints}` : '',
      s.supplementaryPoints ? `• 학부 보충 심화: ${s.supplementaryPoints}` : '',
      hasEquation(s.equationLatex) ? `• 원본 LaTeX 수식: ${s.equationLatex}` : '',
      insertedFrames.length > 0
        ? `• 삽입된 실제 영상 캡처 (${insertedFrames.map((f) => `${f.timestampFormatted} | ${f.sourceUrl || f.sourceLabel}`).join(', ')}) — 강의 시 슬라이드 이미지 속 핵심 영역을 직접 가리키며 설명하세요.`
        : needsVideoFrame
          ? `• [캡처 미확보 안내] 이 슬라이드에는 아직 실제 캡처 이미지가 삽입되지 않았습니다(권장 시점: ${s.captureTimestamp}). 강의 시 실제 영상을 재생하거나 캡처 후 화면 설명을 진행하세요.`
          : '',
      s.academicReferences && s.academicReferences.length > 0
        ? `• 참고문헌: ${s.academicReferences.join(' / ')}`
        : '',
    ].filter(Boolean);
    pptSlide.addNotes(notesLines.join('\n'));
    };

    // 1. COVER SLIDE
    if (i === 0 || s.slideType === 'cover') {
      pptSlide.background = { color: theme.primary };
      pptSlide.addText(
        `${config.courseName || 'AI응용기술'}  ·  ${config.durationMinutes}분 전공 강의`,
        {
          x: 0.75,
          y: 0.95,
          w: 11.8,
          h: 0.45,
          fontSize: 15,
          bold: true,
          color: 'BAE6FD',
          fontFace: theme.headingFontKo,
        },
      );
      pptSlide.addText(s.titleKo, {
        x: 0.75,
        y: 1.55,
        w: 11.8,
        h: 1.65,
        fontSize: 38,
        bold: true,
        color: 'FFFFFF',
        fontFace: theme.headingFontKo,
        valign: 'top',
      });
      if (s.titleEn) {
        pptSlide.addText(s.titleEn, {
          x: 0.75,
          y: 3.3,
          w: 11.8,
          h: 0.55,
          fontSize: 20,
          color: 'E0F2FE',
          fontFace: theme.englishFont,
        });
      }
      if (s.bullets.length > 0) {
        pptSlide.addText(s.bullets.map((b) => `• ${b}`).join('\n'), {
          x: 0.75,
          y: 4.15,
          w: 11.8,
          h: 1.9,
          fontSize: 18,
          color: 'F1F5F9',
          fontFace: theme.bodyFontKo,
          lineSpacingMultiple: 1.35,
        });
      }
      pptSlide.addText(
        `${config.professorName ? `담당 교수: ${config.professorName}  ·  ` : ''}원본 영상: ${analysis.videoMeta.title} (${analysis.videoMeta.url || '로컬 MP4'})`,
        {
          x: 0.75,
          y: 6.72,
          w: 11.8,
          h: 0.38,
          fontSize: 12,
          color: 'CBD5E1',
          fontFace: theme.bodyFontKo,
        },
      );
      finalizeSlideNotes();
      perSlideBoxes.push({ slideNumber: s.slideNumber, boxes: [] });
      continue;
    }

    // COMMON HEADER & FOOTER CHROME
    pptSlide.background = { color: theme.bg };
    pptSlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: 0.48,
      fill: { color: theme.surface },
      line: { color: theme.border, width: 0.5 },
    });
    pptSlide.addText(
      `${config.courseName || 'AI응용기술'}  ·  ${s.section}  ·  ${TIER_LABELS[s.sourceTier] ?? TIER_LABELS.B}`,
      {
        x: 0.55,
        y: 0.08,
        w: 10.6,
        h: 0.32,
        fontSize: 11,
        color: theme.muted,
        fontFace: theme.bodyFontKo,
      },
    );
    pptSlide.addText(
      `${String(s.slideNumber).padStart(2, '0')} / ${String(normalizedSlides.length).padStart(2, '0')}`,
      {
        x: 11.4,
        y: 0.08,
        w: 1.38,
        h: 0.32,
        align: 'right',
        fontSize: 11,
        bold: true,
        color: theme.primary,
        fontFace: theme.codeFont,
      },
    );

    // Slide Title (28pt) & English Subtitle (16pt)
    pptSlide.addText(s.titleKo, {
      x: 0.55,
      y: 0.58,
      w: 12.2,
      h: 0.55,
      fontSize: 28,
      bold: true,
      color: theme.text,
      fontFace: theme.headingFontKo,
    });
    boxes.push({ label: '제목', x: 0.55, y: 0.58, w: 12.2, h: 0.55 });

    if (s.titleEn) {
      pptSlide.addText(s.titleEn, {
        x: 0.55,
        y: 1.15,
        w: 12.2,
        h: 0.34,
        fontSize: 16,
        color: theme.accent,
        fontFace: theme.englishFont,
      });
      boxes.push({ label: '영문부제', x: 0.55, y: 1.15, w: 12.2, h: 0.34 });
    }

    const contentTop = s.titleEn ? 1.62 : 1.32;
    const footerY = 6.94;
    const contentBottom = 6.82;
    const contentH = contentBottom - contentTop;

    // Pre-render equation PNG if present
    const eqPng =
      hasEquation(s.equationLatex)
        ? await renderLatexToPng(s.equationLatex.trim(), `#${theme.softTint}`)
        : null;
    const diagPng =
      s.diagramPreset !== 'none' ? await renderDiagramToPngDataUrl(s.diagramPreset) : null;

    // Helper: Render visual frame or diagram into a given target box
    const renderVisualPanel = async (
      targetX: number,
      targetY: number,
      targetW: number,
      targetH: number,
    ) => {
      const captionH = 0.36;
      const imgBoxH = Math.max(1.8, targetH - captionH - 0.06);
      boxes.push({ label: '시각자료', x: targetX, y: targetY, w: targetW, h: targetH });

      if (matchedFrames.length > 0) {
        const frame = matchedFrames[0];
        const fitted = fitAspectBox(frame.width, frame.height, targetX, targetY, targetW, imgBoxH);
        pptSlide.addShape(pptx.ShapeType.rect, {
          x: targetX,
          y: targetY,
          w: targetW,
          h: imgBoxH,
          fill: { color: '0F172A' },
          line: { color: theme.border, width: 0.75 },
        });
        pptSlide.addImage({
          data: frame.imageDataUrl,
          x: fitted.x,
          y: fitted.y,
          w: fitted.w,
          h: fitted.h,
        });
        insertedFrames.push(frame);
        pptSlide.addText(
          `실제 영상 캡처 (${frame.timestampFormatted}) · ${frame.sourceUrl || analysis.videoMeta.url || frame.sourceLabel} (${frame.width}×${frame.height})`,
          {
            x: targetX,
            y: targetY + imgBoxH + 0.06,
            w: targetW,
            h: captionH,
            fontSize: 10.5,
            color: theme.muted,
            fontFace: theme.bodyFontKo,
          },
        );
      } else if (diagPng) {
        const fitted = fitAspectBox(960, 540, targetX, targetY, targetW, imgBoxH);
        pptSlide.addImage({
          data: diagPng,
          x: fitted.x,
          y: fitted.y,
          w: fitted.w,
          h: fitted.h,
        });
        pptSlide.addText(
          `AI 생성 교육용 도식 · ${s.diagramCaption || s.titleKo}`,
          {
            x: targetX,
            y: targetY + imgBoxH + 0.06,
            w: targetW,
            h: captionH,
            fontSize: 11,
            color: theme.muted,
            fontFace: theme.bodyFontKo,
          },
        );
      } else if (needsVideoFrame) {
        pptSlide.addShape(pptx.ShapeType.rect, {
          x: targetX,
          y: targetY,
          w: targetW,
          h: targetH,
          fill: { color: theme.amberBg },
          line: { color: theme.amberBorder, width: 1, dashType: 'dash' },
        });
        pptSlide.addText(
          `[실제 영상 캡처 미확보 — YouTube 탭 자동 캡처 또는 MP4 업로드 필요]\n권장 시점: ${s.captureTimestamp}\n\n${s.captureGuideText}\n\n※ 실제 캡처에 실패·미진행된 장면은 가짜 이미지로 대체하지 않으며, 캡처 패널에서 재시도 후 다시 내보내기 할 수 있습니다.`,
          {
            x: targetX + 0.22,
            y: targetY + 0.2,
            w: targetW - 0.44,
            h: targetH - 0.4,
            fontSize: 13.5,
            color: theme.text,
            fontFace: theme.bodyFontKo,
            valign: 'middle',
            lineSpacingMultiple: 1.32,
          },
        );
      }
    };

    // LAYOUT DISPATCH BY SLIDE TYPE (Section 6)
    const safeBullets = Array.isArray(s.bullets) ? s.bullets : [];

    if (s.slideType === 'comparison-table' && s.comparisonTable?.headers?.length) {
      const safeRows = Array.isArray(s.comparisonTable.rows) ? s.comparisonTable.rows : [];
      const tableH = Math.min(3.5, 0.55 + safeRows.length * 0.62);
      const tableRows: PptxGenJS.TableRow[] = [
        s.comparisonTable.headers.map((h) => ({
          text: h,
          options: {
            bold: true,
            fill: { color: theme.primary },
            color: 'FFFFFF',
            fontSize: 16,
            fontFace: theme.headingFontKo,
            align: 'center' as const,
            valign: 'middle' as const,
          },
        })),
        ...safeRows.map((r, rIdx) =>
          (Array.isArray(r) ? r : []).map((cell) => ({
            text: cell,
            options: {
              fill: { color: rIdx % 2 === 0 ? theme.surface : 'FFFFFF' },
              color: theme.text,
              fontSize: 16,
              fontFace: theme.bodyFontKo,
              valign: 'middle' as const,
            },
          })),
        ),
      ];
      pptSlide.addTable(tableRows, {
        x: 0.55,
        y: contentTop,
        w: 12.2,
        h: tableH,
        border: { type: 'solid', color: theme.border, pt: 0.75 },
      });
      boxes.push({ label: '비교표', x: 0.55, y: contentTop, w: 12.2, h: tableH });

      const noteY = contentTop + tableH + 0.22;
      const noteH = contentBottom - noteY;
      if (noteH >= 0.8 && safeBullets.length > 0) {
        pptSlide.addText(
          safeBullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
          {
            x: 0.55,
            y: noteY,
            w: 12.2,
            h: noteH,
            fontSize: 18,
            color: theme.text,
            fontFace: theme.bodyFontKo,
            lineSpacingMultiple: 1.25,
          },
        );
        boxes.push({ label: '하단요약', x: 0.55, y: noteY, w: 12.2, h: noteH });
      }
    } else if (s.slideType === 'code-lab' && s.codeBlock?.code) {
      const codeW = 7.3;
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.55,
        y: contentTop,
        w: codeW,
        h: contentH,
        fill: { color: '0F172A' },
        line: { color: '334155', width: 0.75 },
      });
      pptSlide.addText(`${(s.codeBlock.language || 'python').toUpperCase()} 실습 코드`, {
        x: 0.75,
        y: contentTop + 0.14,
        w: codeW - 0.4,
        h: 0.3,
        fontSize: 12,
        bold: true,
        color: '38BDF8',
        fontFace: theme.codeFont,
      });
      pptSlide.addText(s.codeBlock.code, {
        x: 0.75,
        y: contentTop + 0.5,
        w: codeW - 0.4,
        h: contentH - 0.65,
        fontSize: 13,
        color: 'E2E8F0',
        fontFace: theme.codeFont,
        valign: 'top',
        lineSpacingMultiple: 1.25,
      });
      boxes.push({ label: '코드블록', x: 0.55, y: contentTop, w: codeW, h: contentH });

      const rightX = 8.1;
      const rightW = 4.68;
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: rightX,
        y: contentTop,
        w: rightW,
        h: contentH,
        fill: { color: theme.surface },
        line: { color: theme.border, width: 0.75 },
      });
      const codeBullets = [
        ...s.bullets,
        ...(s.codeBlock.explanation ? [s.codeBlock.explanation] : []),
      ].slice(0, 5);
      pptSlide.addText(
        codeBullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } })),
        {
          x: rightX + 0.2,
          y: contentTop + 0.2,
          w: rightW - 0.4,
          h: contentH - 0.4,
          fontSize: 17,
          color: theme.text,
          fontFace: theme.bodyFontKo,
          valign: 'top',
          lineSpacingMultiple: 1.28,
        },
      );
      boxes.push({ label: '코드해설', x: rightX, y: contentTop, w: rightW, h: contentH });
    } else if (
      (s.slideType === 'timeline' || s.slideType === 'process-steps') &&
      s.timelineSteps &&
      s.timelineSteps.length > 0
    ) {
      const steps = s.timelineSteps.slice(0, 4);
      const gap = 0.25;
      const cardW = (12.2 - gap * (steps.length - 1)) / steps.length;
      const cardH = 3.2;

      steps.forEach((st, idx) => {
        const cx = 0.55 + idx * (cardW + gap);
        pptSlide.addShape(pptx.ShapeType.rect, {
          x: cx,
          y: contentTop,
          w: cardW,
          h: cardH,
          fill: { color: theme.surface },
          line: { color: idx === steps.length - 1 ? theme.accent : theme.border, width: 1 },
        });
        pptSlide.addText(st.label || `STEP ${idx + 1}`, {
          x: cx + 0.16,
          y: contentTop + 0.16,
          w: cardW - 0.32,
          h: 0.32,
          fontSize: 12,
          bold: true,
          color: theme.accent,
          fontFace: theme.codeFont,
        });
        pptSlide.addText(st.title, {
          x: cx + 0.16,
          y: contentTop + 0.52,
          w: cardW - 0.32,
          h: 0.65,
          fontSize: 17,
          bold: true,
          color: theme.text,
          fontFace: theme.headingFontKo,
          valign: 'top',
        });
        pptSlide.addText(st.detail, {
          x: cx + 0.16,
          y: contentTop + 1.24,
          w: cardW - 0.32,
          h: cardH - 1.4,
          fontSize: 15,
          color: theme.muted,
          fontFace: theme.bodyFontKo,
          valign: 'top',
          lineSpacingMultiple: 1.25,
        });
        boxes.push({ label: `단계카드${idx + 1}`, x: cx, y: contentTop, w: cardW, h: cardH });
      });

      const bottomY = contentTop + cardH + 0.25;
      const bottomH = contentBottom - bottomY;
      if (bottomH >= 0.8 && s.bullets.length > 0) {
        pptSlide.addText(
          s.bullets.slice(0, 3).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
          {
            x: 0.55,
            y: bottomY,
            w: 12.2,
            h: bottomH,
            fontSize: 18,
            color: theme.text,
            fontFace: theme.bodyFontKo,
          },
        );
        boxes.push({ label: '보충설명', x: 0.55, y: bottomY, w: 12.2, h: bottomH });
      }
    } else if (s.slideType === 'quiz' && s.quizItem) {
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.55,
        y: contentTop,
        w: 12.2,
        h: 1.25,
        fill: { color: theme.softTint },
        line: { color: theme.primary, width: 1 },
      });
      pptSlide.addText(`Q. ${s.quizItem.question}`, {
        x: 0.8,
        y: contentTop + 0.15,
        w: 11.7,
        h: 0.95,
        fontSize: 20,
        bold: true,
        color: theme.text,
        fontFace: theme.headingFontKo,
        valign: 'middle',
      });
      boxes.push({ label: '퀴즈질문', x: 0.55, y: contentTop, w: 12.2, h: 1.25 });

      const optTop = contentTop + 1.45;
      const optH = 2.35;
      pptSlide.addText(
        (s.quizItem.options ?? [])
          .map((opt, idx) => `${idx + 1}) ${opt}`)
          .join('\n'),
        {
          x: 0.75,
          y: optTop,
          w: 11.8,
          h: optH,
          fontSize: 20,
          color: theme.text,
          fontFace: theme.bodyFontKo,
          lineSpacingMultiple: 1.45,
        },
      );
      boxes.push({ label: '보기', x: 0.75, y: optTop, w: 11.8, h: optH });

      const ansY = optTop + optH + 0.15;
      const ansH = contentBottom - ansY;
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.55,
        y: ansY,
        w: 12.2,
        h: ansH,
        fill: { color: theme.surface },
        line: { color: theme.accent, width: 0.75 },
      });
      pptSlide.addText(
        `정답: ${s.quizItem.answerIndex + 1}번  ·  해설: ${s.quizItem.explanation}`,
        {
          x: 0.78,
          y: ansY + 0.12,
          w: 11.75,
          h: ansH - 0.24,
          fontSize: 16,
          color: theme.accent,
          fontFace: theme.bodyFontKo,
          valign: 'middle',
        },
      );
      boxes.push({ label: '정답해설', x: 0.55, y: ansY, w: 12.2, h: ansH });
    } else if (s.slideType === 'multi-capture-compare' && matchedFrames.length >= 2) {
      const count = Math.min(4, matchedFrames.length);
      const cols = count <= 2 ? 2 : 2;
      const rows = count <= 2 ? 1 : 2;
      const gap = 0.25;
      const cellW = (12.2 - gap * (cols - 1)) / cols;
      const cellH = (contentH - 0.9 - gap * (rows - 1)) / rows;

      matchedFrames.slice(0, count).forEach((frame, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const fx = 0.55 + col * (cellW + gap);
        const fy = contentTop + row * (cellH + gap);
        const fitted = fitAspectBox(frame.width, frame.height, fx, fy, cellW, cellH - 0.34);
        pptSlide.addImage({
          data: frame.imageDataUrl,
          x: fitted.x,
          y: fitted.y,
          w: fitted.w,
          h: fitted.h,
        });
        insertedFrames.push(frame);
        pptSlide.addText(`${frame.timestampFormatted} · ${frame.sourceUrl || analysis.videoMeta.url || frame.sourceLabel}`, {
          x: fx,
          y: fy + cellH - 0.3,
          w: cellW,
          h: 0.28,
          fontSize: 11,
          color: theme.muted,
          fontFace: theme.bodyFontKo,
        });
        boxes.push({ label: `멀티캡처${idx + 1}`, x: fx, y: fy, w: cellW, h: cellH });
      });

      const sumY = contentBottom - 0.78;
      pptSlide.addText(s.bullets.slice(0, 2).join('   |   '), {
        x: 0.55,
        y: sumY,
        w: 12.2,
        h: 0.75,
        fontSize: 17,
        color: theme.text,
        fontFace: theme.bodyFontKo,
      });
      boxes.push({ label: '비교요약', x: 0.55, y: sumY, w: 12.2, h: 0.75 });
    } else if (s.slideType === 'video-hero') {
      // ~64% width dedicated to real video frame for classroom projector clarity
      const visualW = 7.85;
      await renderVisualPanel(0.55, contentTop, visualW, contentH);

      const textX = 8.62;
      const textW = 4.15;
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: textX,
        y: contentTop,
        w: textW,
        h: contentH,
        fill: { color: theme.surface },
        line: { color: theme.border, width: 0.75 },
      });
      pptSlide.addText(
        safeBullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true, paraSpaceAfter: 10 } })),
        {
          x: textX + 0.2,
          y: contentTop + 0.22,
          w: textW - 0.4,
          h: contentH - 0.44,
          fontSize: 20,
          color: theme.text,
          fontFace: theme.bodyFontKo,
          valign: 'top',
          lineSpacingMultiple: 1.32,
        },
      );
      boxes.push({ label: '장면핵심설명', x: textX, y: contentTop, w: textW, h: contentH });
    } else if (s.slideType === 'equation-focus' || s.slideType === 'matrix-stepwise') {
      // Dedicated Math & Matrix Stepwise Layout
      const eqH = eqPng ? 1.55 : 0.95;
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.55,
        y: contentTop,
        w: 12.2,
        h: eqH,
        fill: { color: theme.softTint },
        line: { color: theme.primary, width: 1 },
      });
      if (eqPng) {
        const fitted = fitAspectBox(eqPng.widthPx, eqPng.heightPx, 0.75, contentTop + 0.12, 11.8, eqH - 0.24);
        pptSlide.addImage({
          data: eqPng.dataUrl,
          x: fitted.x,
          y: fitted.y,
          w: fitted.w,
          h: fitted.h,
        });
      } else {
        pptSlide.addText(latexToReadableMath(s.equationLatex || s.matrixNote), {
          x: 0.8,
          y: contentTop + 0.15,
          w: 11.7,
          h: eqH - 0.3,
          align: 'center',
          valign: 'middle',
          fontSize: 20,
          bold: true,
          color: theme.primary,
          fontFace: theme.englishFont,
        });
      }
      boxes.push({ label: '수식블록', x: 0.55, y: contentTop, w: 12.2, h: eqH });

      const lowerY = contentTop + eqH + 0.22;
      const lowerH = contentBottom - lowerY;
      const leftW = 6.2;
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.55,
        y: lowerY,
        w: leftW,
        h: lowerH,
        fill: { color: theme.surface },
        line: { color: theme.border, width: 0.75 },
      });
      pptSlide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } })),
        {
          x: 0.75,
          y: lowerY + 0.18,
          w: leftW - 0.4,
          h: lowerH - 0.36,
          fontSize: 18,
          color: theme.text,
          fontFace: theme.bodyFontKo,
          valign: 'top',
          lineSpacingMultiple: 1.28,
        },
      );
      boxes.push({ label: '수식해설', x: 0.55, y: lowerY, w: leftW, h: lowerH });

      const rightX = 6.98;
      const rightW = 5.8;
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: rightX,
        y: lowerY,
        w: rightW,
        h: lowerH,
        fill: { color: 'FFFFFF' },
        line: { color: theme.accent, width: 0.75 },
      });
      const rightLines: string[] = [];
      if (s.matrixNote) rightLines.push(`행렬 차원: ${s.matrixNote}`);
      if (s.equationVariables?.length) {
        rightLines.push(...s.equationVariables.slice(0, 4).map((v) => `• ${v.symbol}: ${v.meaning}`));
      }
      if (s.numericExample) rightLines.push(`예제: ${s.numericExample}`);
      pptSlide.addText(rightLines.join('\n') || '변수 및 차원 추적 안내', {
        x: rightX + 0.2,
        y: lowerY + 0.18,
        w: rightW - 0.4,
        h: lowerH - 0.36,
        fontSize: 16,
        color: theme.text,
        fontFace: theme.bodyFontKo,
        valign: 'top',
        lineSpacingMultiple: 1.32,
      });
      boxes.push({ label: '차원및예제', x: rightX, y: lowerY, w: rightW, h: lowerH });
    } else {
      // Standard & Asymmetric 2-Column Layouts (image-left-text, image-right-text, architecture-diagram, key-concept, objectives, agenda, summary, references)
      const hasVisual =
        matchedFrames.length > 0 ||
        Boolean(diagPng) ||
        needsVideoFrame;
      const imageOnLeft = s.slideType === 'image-left-text';

      const colGap = matchedFrames.length > 0 ? 0.25 : 0.3;
      const visColW = matchedFrames.length > 0 ? 7.1 : 6.0;
      const textColW = hasVisual ? 12.2 - visColW - colGap : 12.2;
      const textColX = hasVisual && imageOnLeft ? 0.55 + visColW + colGap : 0.55;
      const visColX = imageOnLeft ? 0.55 : 0.55 + textColW + colGap;

      const eqBoxH = eqPng || hasEquation(s.equationLatex) || s.matrixNote ? 1.25 : 0;
      const highlightH = s.keyHighlight && s.slideType === 'key-concept' ? 0.85 : 0;
      const textBoxH = contentH - eqBoxH - (eqBoxH > 0 ? 0.16 : 0) - highlightH - (highlightH > 0 ? 0.14 : 0);

      let cursorY = contentTop;
      if (highlightH > 0) {
        pptSlide.addShape(pptx.ShapeType.rect, {
          x: textColX,
          y: cursorY,
          w: textColW,
          h: highlightH,
          fill: { color: theme.primary },
        });
        pptSlide.addText(s.keyHighlight!, {
          x: textColX + 0.2,
          y: cursorY + 0.1,
          w: textColW - 0.4,
          h: highlightH - 0.2,
          fontSize: 17,
          bold: true,
          color: 'FFFFFF',
          fontFace: theme.headingFontKo,
          valign: 'middle',
        });
        boxes.push({ label: '핵심강조', x: textColX, y: cursorY, w: textColW, h: highlightH });
        cursorY += highlightH + 0.14;
      }

      pptSlide.addShape(pptx.ShapeType.rect, {
        x: textColX,
        y: cursorY,
        w: textColW,
        h: textBoxH,
        fill: { color: theme.surface },
        line: { color: theme.border, width: 0.75 },
      });
      pptSlide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true, paraSpaceAfter: 9 } })),
        {
          x: textColX + 0.22,
          y: cursorY + 0.2,
          w: textColW - 0.44,
          h: textBoxH - 0.36,
          fontSize: 20,
          color: theme.text,
          fontFace: theme.bodyFontKo,
          valign: 'top',
          lineSpacingMultiple: 1.3,
        },
      );
      boxes.push({ label: '본문', x: textColX, y: cursorY, w: textColW, h: textBoxH });

      if (eqBoxH > 0) {
        const eqY = cursorY + textBoxH + 0.16;
        pptSlide.addShape(pptx.ShapeType.rect, {
          x: textColX,
          y: eqY,
          w: textColW,
          h: eqBoxH,
          fill: { color: theme.softTint },
          line: { color: theme.primary, width: 0.75 },
        });
        if (eqPng) {
          const fitted = fitAspectBox(
            eqPng.widthPx,
            eqPng.heightPx,
            textColX + 0.15,
            eqY + 0.08,
            textColW - 0.3,
            s.matrixNote ? eqBoxH - 0.45 : eqBoxH - 0.16,
          );
          pptSlide.addImage({
            data: eqPng.dataUrl,
            x: fitted.x,
            y: fitted.y,
            w: fitted.w,
            h: fitted.h,
          });
          if (s.matrixNote) {
            pptSlide.addText(`차원: ${s.matrixNote}`, {
              x: textColX + 0.2,
              y: eqY + eqBoxH - 0.34,
              w: textColW - 0.4,
              h: 0.28,
              fontSize: 12,
              color: theme.primary,
              fontFace: theme.codeFont,
            });
          }
        } else {
          pptSlide.addText(
            [
              s.equationLatex ? latexToReadableMath(s.equationLatex) : '',
              s.matrixNote ? `차원: ${s.matrixNote}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            {
              x: textColX + 0.2,
              y: eqY + 0.1,
              w: textColW - 0.4,
              h: eqBoxH - 0.2,
              fontSize: 15,
              color: theme.primary,
              fontFace: theme.codeFont,
              valign: 'middle',
            },
          );
        }
        boxes.push({ label: '수식및차원', x: textColX, y: eqY, w: textColW, h: eqBoxH });
      }

      if (hasVisual) {
        await renderVisualPanel(visColX, contentTop, visColW, contentH);
      }
    }

    // Footer Attribution Strip
    const footerText = [
      s.videoBasedPoints ? `영상 근거: ${s.videoBasedPoints}` : '',
      s.supplementaryPoints ? `보충: ${s.supplementaryPoints}` : '',
    ]
      .filter(Boolean)
      .join('  |  ')
      .slice(0, 165);

    if (footerText) {
      pptSlide.addText(footerText, {
        x: 0.55,
        y: footerY,
        w: 12.2,
        h: 0.4,
        fontSize: 11,
        color: theme.muted,
        fontFace: theme.bodyFontKo,
      });
      boxes.push({ label: '푸터', x: 0.55, y: footerY, w: 12.2, h: 0.4 });
    }

    finalizeSlideNotes();
    perSlideBoxes.push({ slideNumber: s.slideNumber, boxes });
  }

  const safeTitle = (analysis.videoMeta.title || config.courseName || 'LectureLens_Deck')
    .replace(/[^\w\u3131-\uD79D-]+/g, '_')
    .slice(0, 42);
  const fileName = `${safeTitle}_${normalizedSlides.length}Slides.pptx`;

  const output = (await pptx.write({ outputType: 'blob' })) as Blob;

  // Verify PPTX ZIP internal XML, embedded PNG media files, and Speaker Notes (Requirement 9)
  let zipVerified = false;
  let zipAudit: import('../types/lecture').PptxZipAudit | undefined;
  try {
    const zip = await JSZip.loadAsync(output);
    const slideFiles = Object.keys(zip.files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    const mediaFiles = Object.keys(zip.files).filter((k) =>
      /^ppt\/media\/.+\.(png|jpg|jpeg|webp)$/i.test(k),
    );
    const notesFiles = Object.keys(zip.files).filter((k) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(k),
    );

    let totalMediaBytes = 0;
    let brokenMediaCount = 0;
    for (const mf of mediaFiles) {
      const bytes = await zip.file(mf)!.async('uint8array');
      const mime = /\.png$/i.test(mf) ? 'image/png' : /\.webp$/i.test(mf) ? 'image/webp' : 'image/jpeg';
      if (!bytes || bytes.byteLength < 64 || !(await isNonBlankMedia(bytes, mime))) {
        brokenMediaCount++;
      } else {
        totalMediaBytes += bytes.byteLength;
      }
    }

    zipAudit = {
      slideCount: slideFiles.length,
      mediaImageCount: mediaFiles.length,
      notesSlideCount: notesFiles.length,
      totalMediaBytes,
      brokenMediaCount,
    };

    // Confirm each claimed video frame is actually embedded on its own slide,
    // not merely present somewhere in the PPTX ZIP.
    let videoRelationshipsValid = true;
    const parser = new DOMParser();
    for (const { slideIndex, frames } of expectedVideoFrames) {
      const slideXml = await zip.file(`ppt/slides/slide${slideIndex}.xml`)?.async('string');
      const relXml = await zip.file(`ppt/slides/_rels/slide${slideIndex}.xml.rels`)?.async('string');
      if (!slideXml || !relXml) { videoRelationshipsValid = false; continue; }
      const slideDoc = parser.parseFromString(slideXml, 'application/xml');
      const relDoc = parser.parseFromString(relXml, 'application/xml');
      const ids = Array.from(slideDoc.getElementsByTagNameNS('*', 'blip')).map(
        (node) => node.getAttribute('r:embed') || node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed'),
      ).filter(Boolean);
      const media = new Set<string>();
      for (const rel of Array.from(relDoc.getElementsByTagNameNS('*', 'Relationship'))) {
        if (!ids.includes(rel.getAttribute('Id'))) continue;
        const target = rel.getAttribute('Target') || '';
        const normalized = new URL(target, 'https://pptx.local/ppt/slides/').pathname.slice(1);
        const file = zip.file(normalized);
        if (file) media.add(await file.async('base64'));
      }
      if (frames.some((frame) => !media.has(frame.imageDataUrl.split(',')[1] || ''))) {
        videoRelationshipsValid = false;
        if (!missingFrameSlides.includes(normalizedSlides[slideIndex - 1].slideNumber)) {
          missingFrameSlides.push(normalizedSlides[slideIndex - 1].slideNumber);
        }
      }
    }
    zipVerified = Boolean(
      zip.file('ppt/presentation.xml') &&
        slideFiles.length === normalizedSlides.length &&
        notesFiles.length === normalizedSlides.length &&
        brokenMediaCount === 0 && videoRelationshipsValid,
    );
  } catch {
    zipVerified = false;
  }

  const validationReport = validateDeckLayout(
    normalizedSlides,
    perSlideBoxes,
    preIssues,
    missingFrameSlides,
    zipAudit,
  );

  return { fileName, blob: output, validationReport, zipVerified };
}

export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
