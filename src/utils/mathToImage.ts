import katex from 'katex';
import { toPng } from 'html-to-image';

export function hasEquation(latex: string | null | undefined): boolean {
  const value = (latex || '').trim().replace(/^\$\$|\$\$/g, '').replace(/^\$|\$/g, '').trim();
  return Boolean(value && !/^(?:n\/?a|none|null|[-—–]|해당\s*없음|수식\s*없음)$/i.test(value));
}

export function latexToReadableMath(latex: string): string {
  if (!hasEquation(latex)) return '';
  return (latex || '')
    .replace(/^\$\$|\$\$$/g, '')
    .replace(/^\$|\$$/g, '')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\mathbf\{([^}]+)\}/g, '$1')
    .replace(/\\mathbb\{R\}/g, 'ℝ')
    .replace(/\\mathbb\{([A-Z])\}/g, '$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1) / ($2)')
    .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
    .replace(/\\top/g, 'ᵀ')
    .replace(/\^T\b/g, 'ᵀ')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\sum/g, '∑')
    .replace(/\\prod/g, '∏')
    .replace(/\\in/g, '∈')
    .replace(/\\le/g, '≤')
    .replace(/\\ge/g, '≥')
    .replace(/\\approx/g, '≈')
    .replace(/\\rightarrow|\\to/g, '→')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\theta/g, 'θ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\ell/g, 'ℓ')
    .replace(/\\left/g, '')
    .replace(/\\right/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RenderedEquationImage {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

const equationCache = new Map<string, RenderedEquationImage>();

// A nonempty PNG can still contain only the tinted background. Decode and
// inspect actual pixels before allowing an equation into the cache or PPTX.
async function hasVisibleEquationInk(dataUrl: string): Promise<boolean> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) return false;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0;
  const total = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    if (pixels[i + 3] > 128 && luminance < 100) dark++;
  }
  return dark >= Math.max(12, total * 0.00015) && dark < total * 0.9;
}

export async function renderLatexToPng(
  latex: string,
  backgroundHex = '#EFF6FF',
): Promise<RenderedEquationImage | null> {
  const cleaned = (latex || '').trim().replace(/^\$\$|\$\$$/g, '').replace(/^\$|\$$/g, '');
  if (!hasEquation(cleaned)) return null;

  const cacheKey = `${backgroundHex}::${cleaned}`;
  if (equationCache.has(cacheKey)) {
    return equationCache.get(cacheKey)!;
  }

  let container: HTMLDivElement | null = null;
  try {
    const mathHtml = katex.renderToString(cleaned, {
      displayMode: true,
      throwOnError: true,
      strict: false,
      trust: false,
    });

    container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.padding = '16px 24px';
    container.style.backgroundColor = backgroundHex;
    container.style.color = '#0F172A';
    container.style.fontSize = '22px';
    container.style.display = 'inline-block';
    container.style.maxWidth = '960px';
    container.style.borderRadius = '8px';
    container.innerHTML = mathHtml;

    document.body.appendChild(container);
    // Ensure local KaTeX fonts are ready before rasterizing.
    await document.fonts.ready;
    // Allow browser layout to measure exact dimensions
    const rect = container.getBoundingClientRect();
    const widthPx = Math.max(120, Math.ceil(rect.width));
    const heightPx = Math.max(48, Math.ceil(rect.height));

    let dataUrl: string;
    try {
      dataUrl = await toPng(container, {
        pixelRatio: 3,
        backgroundColor: backgroundHex,
        cacheBust: false,
      });
    } catch {
      dataUrl = await toPng(container, {
        pixelRatio: 3,
        backgroundColor: backgroundHex,
        cacheBust: false,
        skipFonts: true,
      });
    }

    if (!(await hasVisibleEquationInk(dataUrl))) return null;
    const result: RenderedEquationImage = { dataUrl, widthPx, heightPx };
    equationCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
