import { useMemo } from 'react';
import katex from 'katex';

interface MathBlockProps {
  latex: string;
  displayMode?: boolean;
  className?: string;
}

export function MathBlock({ latex, displayMode = true, className = '' }: MathBlockProps) {
  const renderedHtml = useMemo(() => {
    const cleaned = (latex || '').trim().replace(/^\$\$|\$\$$/g, '').replace(/^\$|\$$/g, '');
    if (!cleaned) return '';
    try {
      return katex.renderToString(cleaned, {
        displayMode,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      return '';
    }
  }, [latex, displayMode]);

  if (!latex || !latex.trim()) return null;

  if (!renderedHtml) {
    return (
      <code className={`font-mono text-sm text-[#0F172A] ${className}`}>
        {latex}
      </code>
    );
  }

  return (
    <div
      className={`overflow-x-auto text-[#0F172A] ${className}`}
      // KaTeX with trust: false generates sanitized math markup from pure LaTeX input
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}
