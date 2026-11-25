import type { CapturedFrame, LectureProject } from '../types/lecture';

const DB_NAME = 'lecturelens_db_v2';
const STORE_NAME = 'projects';
const FRAME_CACHE_STORE = 'frame_cache';
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FRAME_CACHE_STORE)) {
        db.createObjectStore(FRAME_CACHE_STORE, { keyPath: 'videoId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 열기 실패'));
  });
}

export async function listProjects(): Promise<LectureProject[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as LectureProject[]) || [];
        list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveProject(project: LectureProject): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(project);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveFramesCache(
  videoId: string,
  frames: Record<string, CapturedFrame>,
): Promise<void> {
  if (!videoId || Object.keys(frames).length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FRAME_CACHE_STORE, 'readwrite');
      const store = tx.objectStore(FRAME_CACHE_STORE);
      const req = store.put({
        videoId,
        updatedAt: new Date().toISOString(),
        frames,
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore storage errors
  }
}

export async function loadFramesCache(
  videoId: string,
): Promise<Record<string, CapturedFrame> | null> {
  if (!videoId) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_CACHE_STORE, 'readonly');
      const store = tx.objectStore(FRAME_CACHE_STORE);
      const req = store.get(videoId);
      req.onsuccess = () => {
        const res = req.result as { frames?: Record<string, CapturedFrame> } | undefined;
        resolve(res?.frames && Object.keys(res.frames).length > 0 ? res.frames : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
