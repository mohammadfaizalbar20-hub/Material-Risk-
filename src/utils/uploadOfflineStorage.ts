/**
 * PPIC Offline Upload Storage & Resume Manager (IndexedDB + LocalStorage)
 * Handles large-scale dataset persistence (20,000+ rows / 10MB+) across browser refreshes.
 * Bypasses the 5MB sessionStorage/localStorage quota limitation safely.
 */

export interface UploadResumeCheckpoint {
  uploadId: string;
  fileName: string;
  orNumber: string;
  style: string;
  updateDate: string;
  totalRows: number;
  startRowIndex: number;
  failedBatch: number;
  totalBatches: number;
  failingRange?: string;
  preparedRequirements?: any[];
  error?: string;
  savedAt: string;
}

const CHECKPOINT_STORAGE_KEY = 'PPIC_UPLOAD_CHECKPOINT_META_V1';
const DB_NAME = 'ppic_upload_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_upload_rows';

// In-memory fallback for environments without IndexedDB (e.g. Node.js unit tests / SSR)
const memoryRowStore = new Map<string, any[]>();
let memoryCheckpoint: UploadResumeCheckpoint | null = null;

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      return reject(new Error('IndexedDB tidak tersedia di environment ini.'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'uploadId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Gagal membuka IndexedDB'));
  });
}

/**
 * Saves checkpoint metadata (small JSON) to localStorage/sessionStorage.
 */
export function saveCheckpointMeta(meta: UploadResumeCheckpoint): void {
  memoryCheckpoint = meta;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(meta));
    } catch {
      try {
        window.localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(meta));
      } catch (err) {
        console.warn('Gagal menyimpan metadata checkpoint ke storage:', err);
      }
    }
  }
}

/**
 * Retrieves checkpoint metadata.
 */
export function getCheckpointMeta(): UploadResumeCheckpoint | null {
  if (memoryCheckpoint) return memoryCheckpoint;
  if (typeof window === 'undefined') return null;

  try {
    const rawSession = window.sessionStorage?.getItem(CHECKPOINT_STORAGE_KEY);
    if (rawSession) return JSON.parse(rawSession);
    const rawLocal = window.localStorage?.getItem(CHECKPOINT_STORAGE_KEY);
    if (rawLocal) return JSON.parse(rawLocal);
  } catch (err) {
    console.warn('Gagal membaca metadata checkpoint:', err);
  }
  return null;
}

/**
 * Clears checkpoint metadata from storage.
 */
export function clearCheckpointMeta(): void {
  memoryCheckpoint = null;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage?.removeItem(CHECKPOINT_STORAGE_KEY);
      window.localStorage?.removeItem(CHECKPOINT_STORAGE_KEY);
    } catch {}
  }
}

/**
 * Persists the complete prepared rows in IndexedDB (handles 20,000+ rows smoothly).
 */
export async function savePendingUploadRows(uploadId: string, rows: any[]): Promise<boolean> {
  memoryRowStore.set(uploadId, rows);

  if (!hasIndexedDb()) {
    return true;
  }

  try {
    const db = await openIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ uploadId, rows, updatedAt: Date.now() });

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Gagal menyimpan rows ke IndexedDB'));
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn('IndexedDB write warning, falling back to in-memory store:', err);
    return false;
  }
}

/**
 * Retrieves the full pending rows for an upload session from IndexedDB.
 */
export async function getPendingUploadRows(uploadId: string): Promise<any[] | null> {
  if (memoryRowStore.has(uploadId)) {
    return memoryRowStore.get(uploadId) || null;
  }

  if (!hasIndexedDb()) {
    return null;
  }

  try {
    const db = await openIndexedDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(uploadId);

      req.onsuccess = () => {
        const result = req.result;
        resolve(result?.rows || null);
      };
      req.onerror = () => {
        resolve(null);
      };
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn('Gagal membaca rows dari IndexedDB:', err);
    return null;
  }
}

/**
 * Deletes pending upload data from IndexedDB upon successful upload completion or manual abort.
 */
export async function clearPendingUpload(uploadId: string): Promise<void> {
  memoryRowStore.delete(uploadId);
  clearCheckpointMeta();

  if (!hasIndexedDb()) return;

  try {
    const db = await openIndexedDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(uploadId);
    tx.oncomplete = () => db.close();
  } catch {}
}

/**
 * Validates whether a re-selected file matches the pending checkpoint.
 * Ensures the user doesn't accidentally resume with a completely different file or different row count.
 */
export function validateFileMatchWithCheckpoint(
  file: { name: string; size?: number },
  parsedRowsCount: number,
  parsedOr: string,
  checkpoint: UploadResumeCheckpoint
): { isValid: boolean; reason?: string } {
  const cleanParsedOr = (parsedOr || '').trim().toUpperCase();
  const cleanCheckpointOr = (checkpoint.orNumber || '').trim().toUpperCase();

  if (cleanParsedOr && cleanCheckpointOr && cleanParsedOr !== cleanCheckpointOr) {
    return {
      isValid: false,
      reason: `Nomor OR berkas (${cleanParsedOr}) tidak cocok dengan sesi tertunda (${cleanCheckpointOr}).`,
    };
  }

  if (parsedRowsCount !== checkpoint.totalRows) {
    return {
      isValid: false,
      reason: `Jumlah baris material berkas (${parsedRowsCount.toLocaleString('id-ID')}) tidak cocok dengan sesi tertunda (${checkpoint.totalRows.toLocaleString('id-ID')}).`,
    };
  }

  return { isValid: true };
}
