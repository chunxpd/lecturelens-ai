import type { DesignThemeId, ReferenceThemeProfile } from '../types/lecture';

export interface PptxThemeTokens {
  id: DesignThemeId;
  name: string;
  bg: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  muted: string;
  border: string;
  softTint: string;
  amberBg: string;
  amberBorder: string;
  headingFontKo: string;
  bodyFontKo: string;
  englishFont: string;
  codeFont: string;
}

export const BUILTIN_THEMES: Record<Exclude<DesignThemeId, 'custom-template'>, PptxThemeTokens> = {
  'navy-teal': {
    id: 'navy-teal',
    name: '학술 네이비 & 청록 (기본)',
    bg: 'FFFFFF',
    surface: 'F8FAFC',
    primary: '1E3A8A',
    accent: '0F766E',
    text: '0F172A',
    muted: '475569',
    border: 'CBD5E1',
    softTint: 'F0F9FF',
    amberBg: 'FFFBEB',
    amberBorder: 'D97706',
    headingFontKo: '맑은 고딕',
    bodyFontKo: '맑은 고딕',
    englishFont: 'Segoe UI',
    codeFont: 'Consolas',
  },
  'cobalt-slate': {
    id: 'cobalt-slate',
    name: '코발트 & 슬레이트 블루',
    bg: 'F8FAFC',
    surface: 'FFFFFF',
    primary: '1D4ED8',
    accent: '0284C7',
    text: '0F172A',
    muted: '475569',
    border: 'CBD5E1',
    softTint: 'EFF6FF',
    amberBg: 'FFFBEB',
    amberBorder: 'B45309',
    headingFontKo: '맑은 고딕',
    bodyFontKo: '맑은 고딕',
    englishFont: 'Segoe UI',
    codeFont: 'Consolas',
  },
  'charcoal-gold': {
    id: 'charcoal-gold',
    name: '차콜 & 다크 티일',
    bg: 'FFFFFF',
    surface: 'F4F4F5',
    primary: '18181B',
    accent: '0D9488',
    text: '18181B',
    muted: '52525B',
    border: 'D4D4D8',
    softTint: 'F0FDFA',
    amberBg: 'FEF3C7',
    amberBorder: 'B45309',
    headingFontKo: '맑은 고딕',
    bodyFontKo: '맑은 고딕',
    englishFont: 'Segoe UI',
    codeFont: 'Consolas',
  },
  'ivory-academic': {
    id: 'ivory-academic',
    name: '아이보리 & 인디고 세미나',
    bg: 'FEFDFB',
    surface: 'F8FAFC',
    primary: '312E81',
    accent: '0E7490',
    text: '1E293B',
    muted: '475569',
    border: 'CBD5E1',
    softTint: 'EEF2FF',
    amberBg: 'FFFBEB',
    amberBorder: 'D97706',
    headingFontKo: '맑은 고딕',
    bodyFontKo: '맑은 고딕',
    englishFont: 'Segoe UI',
    codeFont: 'Consolas',
  },
};

export function resolveThemeTokens(
  themeId: DesignThemeId,
  template?: ReferenceThemeProfile | null,
): PptxThemeTokens {
  if (themeId === 'custom-template' && template) {
    return {
      ...BUILTIN_THEMES['navy-teal'],
      id: 'custom-template',
      name: `참고 템플릿 (${template.fileName})`,
      primary: template.primaryColor || '1E3A8A',
      accent: template.accentColor || '0F766E',
      bg: template.backgroundColor || 'FFFFFF',
      headingFontKo: template.headingFont || '맑은 고딕',
      bodyFontKo: template.bodyFont || '맑은 고딕',
    };
  }
  const key = themeId === 'custom-template' ? 'navy-teal' : themeId;
  return BUILTIN_THEMES[key] ?? BUILTIN_THEMES['navy-teal'];
}
