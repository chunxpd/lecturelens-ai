import katex from 'katex';
import { toPng } from 'html-to-image';

export function latexToReadableMath(latex: string): string {
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

export async function renderLatexToPng(
  latex: string,
  backgroundHex = '#EFF6FF',
): Promise<RenderedEquationImage | null> {
  const cleaned = (latex || '').trim().replace(/^\$\$|\$\$$/g, '').replace(/^\$|\$$/g, '');
  if (!cleaned) return null;

  const cacheKey = `${backgroundHex}::${cleaned}`;
  if (equationCache.has(cacheKey)) {
    return equationCache.get(cacheKey)!;
  }

  let container: HTMLDivElement | null = null;
  try {
    const mathHtml = katex.renderToString(cleaned, {
      displayMode: true,
      throwOnError: false,
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
