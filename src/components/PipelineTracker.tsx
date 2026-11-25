import { AlertTriangle, CheckCircle2, Circle, Loader2, RefreshCw, SkipForward, Square } from 'lucide-react';
import type { PipelineStepItem } from '../types/lecture';

interface PipelineTrackerProps {
  steps: PipelineStepItem[];
  isAnalyzing: boolean;
  activeModel: string;
  progressMessage: string;
  forceRefresh: boolean;
  onToggleForceRefresh: (val: boolean) => void;
  onCancel: () => void;
  onRetry?: () => void;
}

export function PipelineTracker({
  steps,
  isAnalyzing,
  activeModel,
  progressMessage,
  forceRefresh,
  onToggleForceRefresh,
  onCancel,
  onRetry,
}: PipelineTrackerProps) {
  if (!isAnalyzing && steps.length === 0) {
    return null;
  }

  const hasFailed = steps.some((s) => s.status === 'failed');

  return (
    <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          {isAnalyzing ? (
            <Loader2 className="w-4 h-4 text-[#1E3A8A] animate-spin shrink-0" />
          ) : hasFailed ? (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#0F766E] shrink-0" />
          )}
          <span className="font-semibold text-[#0F172A]">
            {progressMessage || '파이프라인 상태'}
          </span>
          <span className="font-mono text-slate-500">({activeModel})</span>
        </div>

        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              disabled={isAnalyzing}
              checked={forceRefresh}
              onChange={(e) => onToggleForceRefresh(e.target.checked)}
              className="rounded border-slate-300 text-[#1E3A8A]"
            />
            <span>캐시 건너뛰고 새로 분석</span>
          </label>

          {isAnalyzing && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              분석 중단
            </button>
          )}

          {!isAnalyzing && hasFailed && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#1E3A8A] bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              재시도
            </button>
          )}
        </div>
      </div>

      {steps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {steps.map((st) => (
            <div
              key={st.step}
              className={`rounded-md border px-2.5 py-2 text-[11px] space-y-1 ${
                st.status === 'completed'
                  ? 'bg-white border-emerald-200 text-slate-800'
                  : st.status === 'running'
                    ? 'bg-blue-50 border-blue-300 text-[#1E3A8A]'
                    : st.status === 'failed'
                      ? 'bg-red-50 border-red-300 text-red-900'
                      : 'bg-white border-slate-200 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between gap-1 font-semibold">
                <span className="font-mono tabular-nums">STEP {st.step}</span>
                {st.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-[#0F766E]" />}
                {st.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1E3A8A]" />}
                {st.status === 'failed' && <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
                {st.status === 'skipped' && <SkipForward className="w-3.5 h-3.5 text-slate-400" />}
                {st.status === 'pending' && <Circle className="w-3 h-3 text-slate-300" />}
              </div>
              <p className="font-medium leading-tight">{st.label}</p>
              {st.detail && (
                <p className="text-[10px] text-slate-500 leading-tight break-words">{st.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
