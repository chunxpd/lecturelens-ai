import { useState } from 'react';
import type { ConceptCategory, TechnicalConcept } from '../types/lecture';
import { MathBlock } from './MathBlock';

interface ConceptsMatrixViewProps {
  concepts: TechnicalConcept[];
}

const CATEGORIES: Array<'ALL' | ConceptCategory> = [
  'ALL',
  'Sequence Modeling',
  'Attention Mechanism',
  'Transformer Architecture',
  'Training & Optimization',
  'Programming & Systems',
  'Other',
];

const CATEGORY_LABELS: Record<'ALL' | ConceptCategory, string> = {
  ALL: '전체 개념',
  'Sequence Modeling': '시퀀스 모델링',
  'Attention Mechanism': 'Attention 메커니즘',
  'Transformer Architecture': 'Transformer 구조',
  'Training & Optimization': '학습 및 최적화',
  'Programming & Systems': '프로그래밍·시스템',
  Other: '기타 기반 개념',
};

export function ConceptsMatrixView({ concepts }: ConceptsMatrixViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | ConceptCategory>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'video' | 'supplement'>('all');

  const filtered = concepts.filter((c) => {
    const catMatch = selectedCategory === 'ALL' || c.category === selectedCategory;
    const srcMatch =
      sourceFilter === 'all' ||
      (sourceFilter === 'video' && c.appearedInVideo) ||
      (sourceFilter === 'supplement' && !c.appearedInVideo);
    return catMatch && srcMatch;
  });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setSourceFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sourceFilter === 'all'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            전체 ({concepts.length})
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('video')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sourceFilter === 'video'
                ? 'bg-white text-[#0284C7] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            영상 내 등장 ({concepts.filter((c) => c.appearedInVideo).length})
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('supplement')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sourceFilter === 'supplement'
                ? 'bg-white text-[#4F46E5] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            학부 보충 개념 ({concepts.filter((c) => !c.appearedInVideo).length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {filtered.map((concept) => (
          <article
            key={concept.id}
            className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-2">
                <span>{CATEGORY_LABELS[concept.category] || concept.category}</span>
                <span
                  className={
                    concept.appearedInVideo
                      ? 'font-semibold text-[#0284C7]'
                      : 'font-semibold text-[#4F46E5]'
                  }
                >
                  {concept.appearedInVideo
                    ? `영상 내 설명 · ${concept.videoTimestampRef}`
                    : '학부 보충 심화 · 영상 직접 언급 없음'}
                </span>
              </div>

              <h3 className="text-lg font-bold text-[#0F172A]">
                {concept.nameKo}{' '}
                <span className="text-sm font-medium text-slate-500">({concept.nameEn})</span>
              </h3>

              {concept.formulaLatex && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-[#F8FAFC] px-4 py-3">
                  <MathBlock latex={concept.formulaLatex} />
                </div>
              )}

              {concept.matrixDimensions && (
                <div className="mt-2.5 text-xs font-mono tabular-nums text-[#1E3A8A] bg-blue-50/70 border border-blue-100 rounded-md px-3 py-2">
                  차원 규격: {concept.matrixDimensions}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2.5 text-sm leading-relaxed">
              <div>
                <span className="text-xs font-bold text-[#0284C7] mr-2">영상 설명</span>
                <span className="text-slate-700">{concept.videoExplanation}</span>
              </div>
              <div>
                <span className="text-xs font-bold text-[#4F46E5] mr-2">학부 보충</span>
                <span className="text-slate-700">{concept.studentSupplementary}</span>
              </div>
              {concept.academicReference && (
                <div className="text-xs text-slate-500 pt-1">
                  <span className="font-semibold text-slate-700 mr-1.5">학술 출처:</span>
                  <span>{concept.academicReference}</span>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
