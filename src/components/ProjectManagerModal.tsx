import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Download, FolderOpen, Trash2, Upload, X } from 'lucide-react';
import type { LectureProject } from '../types/lecture';
import { deleteProject, listProjects } from '../utils/projectStorage';

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: LectureProject | null;
  onLoadProject: (project: LectureProject) => void;
}

export function ProjectManagerModal({
  isOpen,
  onClose,
  currentProject,
  onLoadProject,
}: ProjectManagerModalProps) {
  const [projects, setProjects] = useState<LectureProject[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    const items = await listProjects();
    setProjects(items);
  };

  useEffect(() => {
    if (isOpen) {
      refresh();
      setStatusMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    await refresh();
    setStatusMsg('프로젝트가 IndexedDB 보관함에서 삭제되었습니다.');
  };

  const handleExportProjectJson = () => {
    if (!currentProject) return;
    const blob = new Blob([JSON.stringify(currentProject, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentProject.name || 'lecture_project').replace(/[^\w\u3131-\uD79D-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportJson = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}')) as LectureProject;
        if (!parsed.analysis || !parsed.config) {
          throw new Error('유효한 LectureLens 프로젝트 JSON 파일이 아닙니다.');
        }
        onLoadProject(parsed);
        onClose();
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : 'JSON 불러오기 실패');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-[#F8FAFC] flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">강의 프로젝트 보관함 (IndexedDB 자동 저장)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              분석 결과와 추출된 실제 영상 프레임을 브라우저 대용량 저장소에 보관하고 언제든 다시 열 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1.5 text-slate-500 hover:text-[#0F172A] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportJson}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                프로젝트 JSON 불러오기
              </button>
              {currentProject && (
                <button
                  type="button"
                  onClick={handleExportProjectJson}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1E3A8A] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  현재 프로젝트 JSON 저장
                </button>
              )}
            </div>
            <span className="font-mono text-xs text-slate-500">저장됨 {projects.length}건</span>
          </div>

          {statusMsg && (
            <p className="text-xs text-[#0F766E] bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {statusMsg}
            </p>
          )}

          {projects.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-8 text-center text-xs text-slate-500">
              아직 저장된 강의 프로젝트가 없습니다. 영상을 분석하면 자동으로 저장됩니다.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {projects.map((p) => {
                const frameCount = Object.keys(p.capturedFrames || {}).length;
                const slideCount = p.analysis?.slides?.length || 0;
                return (
                  <div key={p.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-[#0F172A] truncate">{p.name}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{p.courseName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">슬라이드 {slideCount}장</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">프레임 {frameCount}장</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {new Date(p.updatedAt).toLocaleString('ko-KR')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadProject(p);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A8A] rounded-md hover:bg-[#1E40AF] cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        열기
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        aria-label="프로젝트 삭제"
                        className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
