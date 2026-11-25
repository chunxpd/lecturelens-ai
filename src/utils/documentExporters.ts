import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import type {
  CapturedFrame,
  LectureAnalysisResult,
  LectureConfig,
} from '../types/lecture';
import { latexToReadableMath } from './mathToImage';
import { resolveThemeTokens } from './pptxThemeAndTemplate';

export async function exportScriptToDocx(
  analysis: LectureAnalysisResult,
  config: LectureConfig,
): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({
      text: `${config.courseName || 'AI응용기술'} — 교수자 강의 대본 및 수업 가이드`,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `원본 영상: ${analysis.videoMeta.title} (${analysis.videoMeta.url || '로컬 MP4'}) · 목표 시간: ${config.durationMinutes}분 · 총 ${analysis.slides.length}장`,
          size: 22,
          color: '475569',
        }),
      ],
    }),
    new Paragraph({ text: '' }),
    new Paragraph({
      text: '전체 강의 요약',
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({ text: analysis.executiveSummary }),
    new Paragraph({ text: '' }),
  ];

  for (const s of analysis.slides) {
    children.push(
      new Paragraph({
        text: `Slide ${String(s.slideNumber).padStart(2, '0')}. ${s.titleKo} (${s.titleEn})`,
        heading: HeadingLevel.HEADING_2,
      }),
    );
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `[단원: ${s.section} | 출처 등급: ${s.sourceTier} | 예상 시간: ${s.estimatedMinutes || 1}분 | 캡처 시점: ${s.captureTimestamp}]`,
            bold: true,
            size: 20,
            color: '1E3A8A',
          }),
        ],
      }),
    );
    for (const b of s.bullets) {
      children.push(
        new Paragraph({
          text: `• ${b}`,
        }),
      );
    }
    if (s.equationLatex) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `수식: ${latexToReadableMath(s.equationLatex)}  ${s.matrixNote ? `(${s.matrixNote})` : ''}`,
              italics: true,
              color: '0F766E',
            }),
          ],
        }),
      );
    }
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: '교수자 구두 설명 스크립트: ', bold: true }),
          new TextRun({ text: s.speakerScript || '' }),
        ],
      }),
    );
    children.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      // Character split for long CJK runs without spaces
      if (ctx.measureText(word).width > maxWidth) {
        let sub = '';
        for (const ch of word) {
          if (ctx.measureText(sub + ch).width <= maxWidth) {
            sub += ch;
          } else {
            if (sub) lines.push(sub);
            sub = ch;
          }
        }
        current = sub;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function exportHandoutToPdf(
  analysis: LectureAnalysisResult,
  capturedFrames: Record<string, CapturedFrame>,
  config: LectureConfig,
): Promise<Blob> {
  const theme = resolveThemeTokens(config.themeId, config.referenceTemplate);
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [960, 540],
  });

  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('PDF 렌더링용 Canvas 컨텍스트를 생성할 수 없습니다.');
  }

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  for (let i = 0; i < analysis.slides.length; i++) {
    const s = analysis.slides[i];
    if (i > 0) pdf.addPage([960, 540], 'landscape');

    ctx.fillStyle = i === 0 ? `#${theme.primary}` : '#FFFFFF';
    ctx.fillRect(0, 0, 1600, 900);

    if (i === 0) {
      ctx.fillStyle = '#BAE6FD';
      ctx.font = 'bold 24px "Noto Sans KR", "Malgun Gothic", sans-serif';
      ctx.fillText(`${config.courseName || 'AI응용기술'} · 학생 배포용 강의안`, 90, 170);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 56px "Noto Sans KR", "Malgun Gothic", sans-serif';
      const titleLines = wrapCanvasText(ctx, s.titleKo, 1400);
      titleLines.slice(0, 3).forEach((ln, idx) => {
        ctx.fillText(ln, 90, 265 + idx * 72);
      });

      ctx.fillStyle = '#E0F2FE';
      ctx.font = '28px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(s.titleEn || '', 90, 510);

      ctx.fillStyle = '#CBD5E1';
      ctx.font = '20px "Noto Sans KR", "Malgun Gothic", sans-serif';
      ctx.fillText(
        `원본 영상: ${analysis.videoMeta.title} (${analysis.videoMeta.url || '로컬 MP4'})`,
        90,
        810,
      );
    } else {
      // Header bar
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, 1600, 64);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 64);
      ctx.lineTo(1600, 64);
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.font = '18px "Noto Sans KR", "Malgun Gothic", sans-serif';
      ctx.fillText(`${config.courseName} · ${s.section} · [출처 ${s.sourceTier}]`, 64, 40);

      ctx.fillStyle = `#${theme.primary}`;
      ctx.font = 'bold 18px monospace';
      ctx.fillText(`${String(s.slideNumber).padStart(2, '0')} / ${String(analysis.slides.length).padStart(2, '0')}`, 1440, 40);

      // Title
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 38px "Noto Sans KR", "Malgun Gothic", sans-serif';
      ctx.fillText(s.titleKo, 64, 130, 1470);

      if (s.titleEn) {
        ctx.fillStyle = `#${theme.accent}`;
        ctx.font = '22px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(s.titleEn, 64, 170, 1470);
      }

      const frameId = s.capturedFrameIds?.[0];
      const frame = frameId ? capturedFrames[frameId] : undefined;
      const maxTextW = frame ? 760 : 1440;

      // Bullets
      ctx.fillStyle = '#0F172A';
      ctx.font = '25px "Noto Sans KR", "Malgun Gothic", sans-serif';
      let y = 235;
      for (const b of s.bullets.slice(0, 5)) {
        const lines = wrapCanvasText(ctx, `• ${b}`, maxTextW);
        for (const ln of lines) {
          if (y > 700) break;
          ctx.fillText(ln, 64, y);
          y += 38;
        }
        y += 12;
      }

      if (s.equationLatex) {
        ctx.fillStyle = '#EFF6FF';
        ctx.fillRect(64, 725, maxTextW, 95);
        ctx.fillStyle = `#${theme.primary}`;
        ctx.font = 'bold 22px monospace';
        ctx.fillText(latexToReadableMath(s.equationLatex), 84, 770, maxTextW - 40);
        if (s.matrixNote) {
          ctx.font = '18px monospace';
          ctx.fillText(`차원: ${s.matrixNote}`, 84, 804, maxTextW - 40);
        }
      }

      if (frame) {
        const img = await loadImage(frame.imageDataUrl);
        if (img) {
          const boxX = 870;
          const boxY = 215;
          const boxW = 665;
          const boxH = 440;
          const ratio = img.width / img.height;
          let dw = boxW;
          let dh = dw / ratio;
          if (dh > boxH) {
            dh = boxH;
            dw = dh * ratio;
          }
          ctx.drawImage(img, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);
          ctx.fillStyle = '#475569';
          ctx.font = '16px "Noto Sans KR", "Malgun Gothic", sans-serif';
          ctx.fillText(`실제 영상 캡처 · ${frame.sourceLabel}`, boxX, boxY + boxH + 32, boxW);
        }
      }
    }

    const jpgData = canvas.toDataURL('image/jpeg', 0.9);
    pdf.addImage(jpgData, 'JPEG', 0, 0, 960, 540);
  }

  return pdf.output('blob');
}

export function buildMarkdownReport(
  analysis: LectureAnalysisResult,
  config: LectureConfig,
): string {
  const lines: string[] = [
    `# ${config.courseName || '전공강의'} — ${analysis.videoMeta.title}`,
    `- 출처: ${analysis.videoMeta.url || '로컬 MP4 영상'}`,
    `- 채널/발표자: ${analysis.videoMeta.channelOrAuthor} · 길이: ${analysis.videoMeta.durationFormatted}`,
    `- 강의 설정: ${config.durationMinutes}분 · 대상(${config.studentLevel}) · 총 ${analysis.slides.length}장`,
    `- 검증 안내: ${analysis.videoMeta.verificationNote}`,
    '',
    '## 종합 요약',
    analysis.executiveSummary,
    '',
  ];

  if (analysis.storyline) {
    lines.push('## 강의 스토리라인 설계');
    lines.push(`- **핵심 메시지**: ${analysis.storyline.coreMessage}`);
    lines.push(`- **도입**: ${analysis.storyline.introSummary}`);
    lines.push(`- **전개**: ${analysis.storyline.bodySummary}`);
    lines.push(`- **결론**: ${analysis.storyline.conclusionSummary}`);
    lines.push(`- **교육적 재구성 메모**: ${analysis.storyline.pedagogicalReorderNote}`);
    lines.push('');
  }

  lines.push('## 1. 시간 순서별 장면 분석');
  for (const s of analysis.scenes) {
    lines.push(`### 장면 ${s.sceneNumber}. ${s.title} (${s.startTime} – ${s.endTime})`);
    lines.push(`- **실제 화면 구성**: ${s.screenComposition}`);
    lines.push(`- **등장 그림·도식·수식**: ${s.visualDiagramsAndEquations}`);
    if (s.onScreenTextAndSubtitles) {
      lines.push(`- **화면 자막·텍스트**: ${s.onScreenTextAndSubtitles}`);
    }
    lines.push(`- **음성 설명 핵심**: ${s.audioCoreSummary}`);
    lines.push(`- **캡처 권장 시점**: ${s.captureTimestamp} (${s.captureGuide})`);
    lines.push(`- **영상 실제 설명**: ${s.observedInVideo.join(' / ')}`);
    lines.push(`- **학부생 보충 설명**: ${s.supplementaryForStudents.join(' / ')}`);
    lines.push(`- **미확인 영역**: ${s.unverifiedOrAmbiguous}`);
    lines.push('');
  }

  lines.push('## 2. 핵심 개념 및 수식');
  for (const c of analysis.concepts) {
    lines.push(`### ${c.nameKo} (${c.nameEn})`);
    lines.push(`- 출처: ${c.appearedInVideo ? `영상 등장 (${c.videoTimestampRef})` : '학부 보충 심화'} · 참고: ${c.academicReference}`);
    if (c.formulaLatex) lines.push(`- 수식: \`${c.formulaLatex}\``);
    if (c.matrixDimensions) lines.push(`- 행렬 차원: \`${c.matrixDimensions}\``);
    lines.push(`- 영상 설명: ${c.videoExplanation}`);
    lines.push(`- 학부 보충: ${c.studentSupplementary}`);
    lines.push('');
  }

  lines.push(`## 3. 슬라이드 구성안 (${analysis.slides.length}장) 및 교수자 대본`);
  for (const sl of analysis.slides) {
    lines.push(`### Slide ${sl.slideNumber}. ${sl.titleKo} (${sl.titleEn})`);
    lines.push(`- 단원: ${sl.section} · 레이아웃: ${sl.slideType} · 출처 등급: ${sl.sourceTier} · 캡처: ${sl.captureTimestamp}`);
    for (const b of sl.bullets) lines.push(`  - ${b}`);
    if (sl.equationLatex) lines.push(`- 수식: \`${sl.equationLatex}\``);
    if (sl.matrixNote) lines.push(`- 차원: \`${sl.matrixNote}\``);
    lines.push(`- **교수자 스크립트**: ${sl.speakerScript}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function exportBundleZip(
  analysis: LectureAnalysisResult,
  capturedFrames: Record<string, CapturedFrame>,
  config: LectureConfig,
  pptxBlob: Blob,
  pptxFileName: string,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file(pptxFileName, pptxBlob);

  const docxBlob = await exportScriptToDocx(analysis, config);
  zip.file('교수자_강의대본_스크립트.docx', docxBlob);

  const pdfBlob = await exportHandoutToPdf(analysis, capturedFrames, config);
  zip.file('학생_배포용_강의자료.pdf', pdfBlob);

  const mdText = buildMarkdownReport(analysis, config);
  zip.file('강의분석_리포트.md', mdText);

  zip.file('lecture_analysis_data.json', JSON.stringify({ config, analysis }, null, 2));

  const frameList = Object.values(capturedFrames);
  if (frameList.length > 0) {
    const folder = zip.folder('captures');
    frameList.forEach((f, idx) => {
      const base64 = f.imageDataUrl.split(',')[1];
      if (base64 && folder) {
        folder.file(
          `frame_${String(idx + 1).padStart(2, '0')}_${f.timestampFormatted.replace(':', 'm')}s.jpg`,
          base64,
          { base64: true },
        );
      }
    });
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
