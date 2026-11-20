import {
  MaterialItemRequirement,
  ProductionSchedule,
  UploadHistoryItem,
  WorksheetPdfItem,
} from '../types/ppic';
import {
  areOrNumbersMatching,
  buildWorksheetSnapshot,
  findLatestUploadForOr,
  PreparedMasterOrMatchingContext,
  prepareMasterOrMatchingContext,
} from './pdfWorksheetParser';

export interface ScheduleSyncProgressInfo {
  totalSchedules: number;
  completedSchedules: number;
  syncedSchedules: number;
  failedSchedules: number;
  percent: number;
  currentScheduleId?: string;
  currentScheduleLabel?: string;
}

export interface ScheduleSyncFailureDetail {
  scheduleId: string;
  orNumber: string;
  worksheetNo?: string;
  style?: string;
  productionLine?: string;
  error: string;
}

export interface ScheduleAutoSyncSummary {
  status: 'success' | 'no_schedules' | 'partial_failure' | 'failed';
  targetOr: string;
  uploadId?: string;
  updateDate?: string;
  matchedScheduleCount: number;
  syncedScheduleIds: string[];
  failedSchedules: ScheduleSyncFailureDetail[];
  updatedSchedulesById: Record<string, ProductionSchedule>;
  error?: string;
  syncedAt: string;
}

export interface PendingScheduleSyncRecord {
  targetOr: string;
  uploadId?: string;
  updateDate?: string;
  totalTargetSchedules: number;
  syncedCount: number;
  failedScheduleIds: string[];
  failedDetails: ScheduleSyncFailureDetail[];
  lastError: string;
  occurredAt: string;
}

export const PENDING_SCHEDULE_SYNCS_STORAGE_KEY = 'ppic_material_system_v3_pending_schedule_syncs';

export function loadPendingScheduleSyncsFromStorage(): PendingScheduleSyncRecord[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(PENDING_SCHEDULE_SYNCS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePendingScheduleSyncsToStorage(records: PendingScheduleSyncRecord[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(PENDING_SCHEDULE_SYNCS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

/**
 * Checks whether a ProductionSchedule has material worksheets belonging to `targetOr`.
 * Manual schedules without attached worksheets have no material snapshot lines to sync.
 */
export function doesScheduleMatchOr(
  schedule: ProductionSchedule,
  targetOr: string
): boolean {
  if (!targetOr || !targetOr.trim()) return false;
  if (!Array.isArray(schedule.worksheets) || schedule.worksheets.length === 0) {
    return false;
  }

  if (schedule.worksheets.some((ws) => areOrNumbersMatching(ws.orNumber || ws.rawOrNumber, targetOr))) {
    return true;
  }

  // Fallback when worksheet.orNumber is blank but schedule.orNumber matches
  if (areOrNumbersMatching(schedule.orNumber, targetOr)) {
    return schedule.worksheets.some((ws) => !ws.orNumber || !ws.orNumber.trim() || areOrNumbersMatching(ws.orNumber, targetOr));
  }

  return false;
}

/**
 * Validates whether a schedule row fetched from Supabase genuinely belongs to `targetOr`
 * using strict normalized OR matching (eliminating SQL substring false positives such as
 * '1036' matching '11036' or '10360', or incidental mentions in `notes`).
 */
export function doesFetchedScheduleMatchOr(
  schedule: ProductionSchedule,
  targetOr: string
): boolean {
  if (!targetOr || !targetOr.trim()) return false;
  if (Array.isArray(schedule.worksheets) && schedule.worksheets.length > 0) {
    return doesScheduleMatchOr(schedule, targetOr);
  }
  return areOrNumbersMatching(schedule.orNumber, targetOr);
}

/**
 * Rebuilds material availability snapshots ONLY for worksheets matching `targetOr` within `schedule`.
 * Strictly preserves all schedule metadata (`orNumber`, `style`, `productionLine`, `productionDate`,
 * `finishDate`, `target`, `status`, `notes`), worksheet identifiers (`worksheetNo`, `fileName`, `id`,
 * `style`, `target`), and material source fields (`materialCode`, `materialName`, `unit`, `total`).
 */
export function buildScheduleMaterialSyncUpdate(
  schedule: ProductionSchedule,
  targetOr: string,
  masterRequirements: MaterialItemRequirement[],
  uploadHistory: UploadHistoryItem[] = [],
  syncTimestampIso?: string,
  preparedContext?: PreparedMasterOrMatchingContext
): { hasMatchingWorksheet: boolean; updatedSchedule: ProductionSchedule } {
  const timestamp = syncTimestampIso || new Date().toISOString();
  if (!Array.isArray(schedule.worksheets) || schedule.worksheets.length === 0) {
    return { hasMatchingWorksheet: false, updatedSchedule: schedule };
  }

  let hasMatchingWorksheet = false;
  const nextWorksheets: WorksheetPdfItem[] = schedule.worksheets.map((ws) => {
    const wsOr = (ws.orNumber || ws.rawOrNumber || '').trim() || schedule.orNumber;
    if (!areOrNumbersMatching(wsOr, targetOr)) {
      return ws;
    }

    hasMatchingWorksheet = true;
    // Match against `targetOr` using pre-indexed context when available, while preserving ws metadata verbatim
    const snapshot = buildWorksheetSnapshot(
      ws,
      masterRequirements,
      uploadHistory,
      timestamp,
      preparedContext
    );
    return {
      ...snapshot,
      id: ws.id,
      fileName: ws.fileName,
      orNumber: ws.orNumber,
      rawOrNumber: ws.rawOrNumber,
      worksheetNo: ws.worksheetNo,
      style: ws.style,
      target: ws.target,
      targetUnit: ws.targetUnit,
      uploadedAt: ws.uploadedAt,
      error: ws.error,
    };
  });

  if (!hasMatchingWorksheet) {
    return { hasMatchingWorksheet: false, updatedSchedule: schedule };
  }

  return {
    hasMatchingWorksheet: true,
    updatedSchedule: {
      ...schedule,
      worksheets: nextWorksheets,
    },
  };
}

/**
 * Synchronizes all Production Schedules matching `targetOr` with the latest Master Data.
 * - Isolates per-schedule persistence so 1 failure does not corrupt already-synced schedules.
 * - Optional `targetScheduleIds` limits execution during targeted retries without creating duplicates.
 * - Never masks failures as success.
 */
export async function syncSchedulesForMasterDataOr(params: {
  targetOr: string;
  uploadId?: string;
  updateDate?: string;
  schedules: ProductionSchedule[];
  masterRequirements: MaterialItemRequirement[];
  uploadHistory: UploadHistoryItem[];
  persistScheduleSnapshot: (
    schedule: ProductionSchedule
  ) => Promise<{ success: boolean; error?: string }>;
  targetScheduleIds?: string[];
  syncTimestampIso?: string;
  concurrency?: number;
  onProgress?: (info: ScheduleSyncProgressInfo) => void;
}): Promise<ScheduleAutoSyncSummary> {
  const syncTimestamp = params.syncTimestampIso || new Date().toISOString();
  const targetFilterSet =
    Array.isArray(params.targetScheduleIds) && params.targetScheduleIds.length > 0
      ? new Set(params.targetScheduleIds)
      : null;

  const matchingSchedules = params.schedules.filter((sch) => {
    if (!doesScheduleMatchOr(sch, params.targetOr)) return false;
    if (targetFilterSet && !targetFilterSet.has(sch.id)) return false;
    return true;
  });

  if (matchingSchedules.length === 0) {
    return {
      status: 'no_schedules',
      targetOr: params.targetOr,
      uploadId: params.uploadId,
      updateDate: params.updateDate,
      matchedScheduleCount: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      updatedSchedulesById: {},
      syncedAt: syncTimestamp,
    };
  }

  // Build OR Master Data lookup index ONCE in memory for the entire batch of matching schedules
  const preparedContext = prepareMasterOrMatchingContext(
    params.targetOr,
    params.masterRequirements,
    params.uploadHistory
  );

  const preparedTargets: Array<{
    original: ProductionSchedule;
    updated: ProductionSchedule;
  }> = [];

  for (const sch of matchingSchedules) {
    const { hasMatchingWorksheet, updatedSchedule } = buildScheduleMaterialSyncUpdate(
      sch,
      params.targetOr,
      params.masterRequirements,
      params.uploadHistory,
      syncTimestamp,
      preparedContext
    );
    if (hasMatchingWorksheet) {
      preparedTargets.push({ original: sch, updated: updatedSchedule });
    }
  }

  if (preparedTargets.length === 0) {
    return {
      status: 'no_schedules',
      targetOr: params.targetOr,
      uploadId: params.uploadId,
      updateDate: params.updateDate,
      matchedScheduleCount: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      updatedSchedulesById: {},
      syncedAt: syncTimestamp,
    };
  }

  const totalToSync = preparedTargets.length;
  params.onProgress?.({
    totalSchedules: totalToSync,
    completedSchedules: 0,
    syncedSchedules: 0,
    failedSchedules: 0,
    percent: 0,
  });

  type PerScheduleOutcome =
    | { ok: true; schedule: ProductionSchedule }
    | { ok: false; failure: ScheduleSyncFailureDetail };

  const outcomes: PerScheduleOutcome[] = new Array(totalToSync);
  let nextIndex = 0;
  let completedCount = 0;
  let syncedCount = 0;
  let failedCount = 0;

  const workerCount = Math.min(
    Math.max(1, Math.floor(params.concurrency ?? 5)),
    totalToSync
  );

  const runWorker = async () => {
    while (true) {
      const currentIdx = nextIndex;
      if (currentIdx >= totalToSync) return;
      nextIndex++;

      const { original: sch, updated: updatedSchedule } = preparedTargets[currentIdx];
      try {
        const persistRes = await params.persistScheduleSnapshot(updatedSchedule);
        if (persistRes.success) {
          outcomes[currentIdx] = { ok: true, schedule: updatedSchedule };
          syncedCount++;
        } else {
          outcomes[currentIdx] = {
            ok: false,
            failure: {
              scheduleId: sch.id,
              orNumber: sch.orNumber,
              worksheetNo: sch.worksheets?.[0]?.worksheetNo,
              style: sch.style,
              productionLine: sch.productionLine,
              error:
                persistRes.error ||
                'Gagal menyimpan pembaruan snapshot material ke database.',
            },
          };
          failedCount++;
        }
      } catch (err: any) {
        outcomes[currentIdx] = {
          ok: false,
          failure: {
            scheduleId: sch.id,
            orNumber: sch.orNumber,
            worksheetNo: sch.worksheets?.[0]?.worksheetNo,
            style: sch.style,
            productionLine: sch.productionLine,
            error: err?.message || String(err) || 'Kesalahan saat menyinkronkan jadwal.',
          },
        };
        failedCount++;
      } finally {
        completedCount++;
        params.onProgress?.({
          totalSchedules: totalToSync,
          completedSchedules: completedCount,
          syncedSchedules: syncedCount,
          failedSchedules: failedCount,
          percent: Math.round((completedCount / totalToSync) * 100),
          currentScheduleId: sch.id,
          currentScheduleLabel: `${sch.orNumber}${sch.productionLine ? ` · ${sch.productionLine}` : ''}`,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const syncedScheduleIds: string[] = [];
  const failedSchedules: ScheduleSyncFailureDetail[] = [];
  const updatedSchedulesById: Record<string, ProductionSchedule> = {};

  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.ok) {
      syncedScheduleIds.push(outcome.schedule.id);
      updatedSchedulesById[outcome.schedule.id] = outcome.schedule;
    } else {
      failedSchedules.push(outcome.failure);
    }
  }

  let status: ScheduleAutoSyncSummary['status'] = 'success';
  let errorSummary: string | undefined;

  if (failedSchedules.length > 0) {
    status = syncedScheduleIds.length > 0 ? 'partial_failure' : 'failed';
    errorSummary = `${failedSchedules.length} dari ${totalToSync} jadwal gagal disinkronkan: ${failedSchedules[0].error}`;
  }

  return {
    status,
    targetOr: params.targetOr,
    uploadId: params.uploadId,
    updateDate: params.updateDate,
    matchedScheduleCount: totalToSync,
    syncedScheduleIds,
    failedSchedules,
    updatedSchedulesById,
    error: errorSummary,
    syncedAt: syncTimestamp,
  };
}

/**
 * Pure helper to merge updated schedules back into the master schedule array without duplication.
 */
export function applySyncedSchedulesToList(
  currentSchedules: ProductionSchedule[],
  updatedSchedulesById: Record<string, ProductionSchedule>
): ProductionSchedule[] {
  const entries = Object.values(updatedSchedulesById);
  if (entries.length === 0) return currentSchedules;

  const existingIds = new Set(currentSchedules.map((s) => s.id));
  const next = currentSchedules.map((s) => updatedSchedulesById[s.id] || s);

  for (const updated of entries) {
    if (!existingIds.has(updated.id)) {
      next.push(updated);
    }
  }

  return next;
}

/**
 * Updates pending retry queue cleanly when an OR finishes or fails sync.
 */
export function upsertPendingScheduleSyncRecord(
  currentRecords: PendingScheduleSyncRecord[],
  summary: ScheduleAutoSyncSummary
): PendingScheduleSyncRecord[] {
  const withoutCurrentOr = currentRecords.filter(
    (rec) => !areOrNumbersMatching(rec.targetOr, summary.targetOr)
  );

  if (summary.status === 'success' || summary.status === 'no_schedules') {
    return withoutCurrentOr;
  }

  const nextRecord: PendingScheduleSyncRecord = {
    targetOr: summary.targetOr,
    uploadId: summary.uploadId,
    updateDate: summary.updateDate,
    totalTargetSchedules: summary.matchedScheduleCount,
    syncedCount: summary.syncedScheduleIds.length,
    failedScheduleIds: summary.failedSchedules.map((f) => f.scheduleId),
    failedDetails: summary.failedSchedules,
    lastError:
      summary.error ||
      'Sinkronisasi otomatis ke Production Schedule gagal. Silakan coba sinkronkan ulang.',
    occurredAt: summary.syncedAt,
  };

  return [nextRecord, ...withoutCurrentOr];
}

export interface GlobalScheduleSyncProgressInfo {
  phase: 'discovering' | 'syncing' | 'completed' | 'partial_failure' | 'failed';
  totalOrs: number;
  processedOrs: number;
  succeededOrs: number;
  failedOrs: number;
  currentOr?: string;
  totalSchedules: number;
  completedSchedules: number;
  syncedSchedules: number;
  failedSchedules: number;
  percent: number;
  statusText: string;
}

export interface GlobalScheduleSyncSummary {
  status: 'success' | 'no_schedules' | 'partial_failure' | 'failed';
  totalOrs: number;
  succeededOrs: number;
  failedOrs: number;
  totalSchedules: number;
  syncedScheduleIds: string[];
  failedSchedules: ScheduleSyncFailureDetail[];
  orSummaries: ScheduleAutoSyncSummary[];
  updatedSchedulesById: Record<string, ProductionSchedule>;
  error?: string;
  syncedAt: string;
}

/**
 * Deduplicates OR numbers using `areOrNumbersMatching` so variant representations
 * (e.g. '1036', '01036', 'OR/2026/09/1036') are grouped once without duplicating work,
 * while distinct ORs ('1036', '11036', '10360') remain completely separate.
 */
export function deduplicateCanonicalOrs(orNumbers: string[]): string[] {
  const uniqueOrs: string[] = [];
  for (const raw of orNumbers) {
    const clean = (raw || '').trim();
    if (!clean || clean === '-') continue;
    if (!uniqueOrs.some((existing) => areOrNumbersMatching(existing, clean))) {
      uniqueOrs.push(clean);
    }
  }
  return uniqueOrs;
}

/**
 * Synchronizes ALL Production Schedules across ALL ORs that have Master Data,
 * isolating each OR strictly to its own latest Master Data upload.
 *
 * - Never mixes Master Data across ORs.
 * - Never updates schedules whose OR has no Master Data.
 * - Reuses `fetchLatestUploadMaterialsForOrs`, `fetchSchedulesMatchingOrFromSupabase`,
 *   `prepareMasterOrMatchingContext`, and `syncSchedulesForMasterDataOr` with bounded concurrency.
 * - Reports honest progress (`100%` only after all jobs complete without failure).
 */
export async function syncAllOrSchedulesWithMasterData(params: {
  targetOrs: string[];
  fetchMasterDataForOrs: (ors: string[]) => Promise<{
    connected: boolean;
    uploadHistory: UploadHistoryItem[];
    materialRequirements: MaterialItemRequirement[];
    error?: string;
  }>;
  fetchSchedulesForOr: (targetOr: string) => Promise<{
    connected: boolean;
    schedules: ProductionSchedule[];
    error?: string;
  }>;
  persistScheduleSnapshot: (
    schedule: ProductionSchedule
  ) => Promise<{ success: boolean; error?: string }>;
  concurrency?: number;
  syncTimestampIso?: string;
  onProgress?: (info: GlobalScheduleSyncProgressInfo) => void;
}): Promise<GlobalScheduleSyncSummary> {
  const syncTimestamp = params.syncTimestampIso || new Date().toISOString();
  const workerLimit = Math.max(1, Math.floor(params.concurrency ?? 5));
  const canonicalOrs = deduplicateCanonicalOrs(params.targetOrs);

  if (canonicalOrs.length === 0) {
    params.onProgress?.({
      phase: 'completed',
      totalOrs: 0,
      processedOrs: 0,
      succeededOrs: 0,
      failedOrs: 0,
      totalSchedules: 0,
      completedSchedules: 0,
      syncedSchedules: 0,
      failedSchedules: 0,
      percent: 100,
      statusText: 'Tidak ada data OR pada Master Data untuk disinkronkan ke jadwal produksi.',
    });
    return {
      status: 'no_schedules',
      totalOrs: 0,
      succeededOrs: 0,
      failedOrs: 0,
      totalSchedules: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      orSummaries: [],
      updatedSchedulesById: {},
      syncedAt: syncTimestamp,
    };
  }

  params.onProgress?.({
    phase: 'discovering',
    totalOrs: canonicalOrs.length,
    processedOrs: 0,
    succeededOrs: 0,
    failedOrs: 0,
    totalSchedules: 0,
    completedSchedules: 0,
    syncedSchedules: 0,
    failedSchedules: 0,
    percent: 5,
    statusText: `Mengambil Master Data terbaru untuk ${canonicalOrs.length} OR...`,
  });

  const masterDataRes = await params.fetchMasterDataForOrs(canonicalOrs);
  if (!masterDataRes.connected) {
    const errMsg =
      masterDataRes.error ||
      'Gagal mengambil Master Data terbaru dari database. Sinkronisasi jadwal dibatalkan.';
    params.onProgress?.({
      phase: 'failed',
      totalOrs: canonicalOrs.length,
      processedOrs: 0,
      succeededOrs: 0,
      failedOrs: canonicalOrs.length,
      totalSchedules: 0,
      completedSchedules: 0,
      syncedSchedules: 0,
      failedSchedules: 0,
      percent: 5,
      statusText: errMsg,
    });
    return {
      status: 'failed',
      totalOrs: canonicalOrs.length,
      succeededOrs: 0,
      failedOrs: canonicalOrs.length,
      totalSchedules: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      orSummaries: [],
      updatedSchedulesById: {},
      error: errMsg,
      syncedAt: syncTimestamp,
    };
  }

  // Resolve latest upload independently per OR; exclude ORs that have NO Master Data
  interface ResolvedOrMasterBucket {
    orNumber: string;
    latestUpload: UploadHistoryItem | null;
    requirements: MaterialItemRequirement[];
    uploadHistory: UploadHistoryItem[];
  }

  const orsWithMasterData: ResolvedOrMasterBucket[] = [];
  for (const orNum of canonicalOrs) {
    const resolution = findLatestUploadForOr(
      orNum,
      masterDataRes.materialRequirements,
      masterDataRes.uploadHistory
    );
    if (!resolution.latestUpload && resolution.rows.length === 0) {
      continue;
    }
    orsWithMasterData.push({
      orNumber: orNum,
      latestUpload: resolution.latestUpload,
      requirements: resolution.rows,
      uploadHistory: resolution.latestUpload ? [resolution.latestUpload] : [],
    });
  }

  if (orsWithMasterData.length === 0) {
    params.onProgress?.({
      phase: 'completed',
      totalOrs: 0,
      processedOrs: 0,
      succeededOrs: 0,
      failedOrs: 0,
      totalSchedules: 0,
      completedSchedules: 0,
      syncedSchedules: 0,
      failedSchedules: 0,
      percent: 100,
      statusText: 'Belum ada data Master Data yang tersedia untuk disinkronkan ke jadwal produksi.',
    });
    return {
      status: 'no_schedules',
      totalOrs: 0,
      succeededOrs: 0,
      failedOrs: 0,
      totalSchedules: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      orSummaries: [],
      updatedSchedulesById: {},
      syncedAt: syncTimestamp,
    };
  }

  params.onProgress?.({
    phase: 'discovering',
    totalOrs: orsWithMasterData.length,
    processedOrs: 0,
    succeededOrs: 0,
    failedOrs: 0,
    totalSchedules: 0,
    completedSchedules: 0,
    syncedSchedules: 0,
    failedSchedules: 0,
    percent: 12,
    statusText: `Mencari Production Schedule terkait untuk ${orsWithMasterData.length} OR...`,
  });

  // Fetch matching schedules per OR with bounded concurrency
  interface OrScheduleFetchResult {
    bucket: ResolvedOrMasterBucket;
    connected: boolean;
    schedules: ProductionSchedule[];
    error?: string;
  }

  const fetchResults: OrScheduleFetchResult[] = new Array(orsWithMasterData.length);
  let nextFetchIdx = 0;
  let fetchedCount = 0;

  const fetchWorker = async () => {
    while (true) {
      const idx = nextFetchIdx++;
      if (idx >= orsWithMasterData.length) return;
      const bucket = orsWithMasterData[idx];
      try {
        const res = await params.fetchSchedulesForOr(bucket.orNumber);
        const strictMatched = (res.schedules || []).filter((sch) =>
          doesScheduleMatchOr(sch, bucket.orNumber)
        );
        fetchResults[idx] = {
          bucket,
          connected: res.connected,
          schedules: strictMatched,
          error: res.error,
        };
      } catch (err: any) {
        fetchResults[idx] = {
          bucket,
          connected: false,
          schedules: [],
          error: err?.message || String(err) || `Gagal mengambil jadwal untuk OR ${bucket.orNumber}.`,
        };
      } finally {
        fetchedCount++;
        params.onProgress?.({
          phase: 'discovering',
          totalOrs: orsWithMasterData.length,
          processedOrs: 0,
          succeededOrs: 0,
          failedOrs: 0,
          currentOr: bucket.orNumber,
          totalSchedules: 0,
          completedSchedules: 0,
          syncedSchedules: 0,
          failedSchedules: 0,
          percent: Math.min(24, 12 + Math.round((fetchedCount / orsWithMasterData.length) * 12)),
          statusText: `Memeriksa jadwal terkait (${fetchedCount}/${orsWithMasterData.length} OR): ${bucket.orNumber}...`,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(workerLimit, orsWithMasterData.length) }, () => fetchWorker())
  );

  const failedFetchResults = fetchResults.filter((r) => !r.connected);
  const targetsToSync = fetchResults.filter((r) => r.connected && r.schedules.length > 0);

  if (targetsToSync.length === 0 && failedFetchResults.length === 0) {
    params.onProgress?.({
      phase: 'completed',
      totalOrs: 0,
      processedOrs: 0,
      succeededOrs: 0,
      failedOrs: 0,
      totalSchedules: 0,
      completedSchedules: 0,
      syncedSchedules: 0,
      failedSchedules: 0,
      percent: 100,
      statusText: 'Tidak ada jadwal produksi terkait yang perlu diperbarui.',
    });
    return {
      status: 'no_schedules',
      totalOrs: 0,
      succeededOrs: 0,
      failedOrs: 0,
      totalSchedules: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      orSummaries: [],
      updatedSchedulesById: {},
      syncedAt: syncTimestamp,
    };
  }

  const totalOrsToProcess = targetsToSync.length + failedFetchResults.length;
  const totalSchedulesToProcess = targetsToSync.reduce((acc, t) => acc + t.schedules.length, 0);

  if (targetsToSync.length === 0 && failedFetchResults.length > 0) {
    const errMsg =
      failedFetchResults[0].error ||
      'Gagal mengambil daftar Production Schedule dari database.';
    const fetchOrSummaries: ScheduleAutoSyncSummary[] = failedFetchResults.map((ff) => ({
      status: 'failed',
      targetOr: ff.bucket.orNumber,
      uploadId: ff.bucket.latestUpload?.id,
      updateDate: ff.bucket.latestUpload?.updateDate,
      matchedScheduleCount: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      updatedSchedulesById: {},
      error: ff.error || errMsg,
      syncedAt: syncTimestamp,
    }));
    params.onProgress?.({
      phase: 'failed',
      totalOrs: totalOrsToProcess,
      processedOrs: failedFetchResults.length,
      succeededOrs: 0,
      failedOrs: failedFetchResults.length,
      totalSchedules: 0,
      completedSchedules: 0,
      syncedSchedules: 0,
      failedSchedules: 0,
      percent: 25,
      statusText: errMsg,
    });
    return {
      status: 'failed',
      totalOrs: totalOrsToProcess,
      succeededOrs: 0,
      failedOrs: failedFetchResults.length,
      totalSchedules: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      orSummaries: fetchOrSummaries,
      updatedSchedulesById: {},
      error: errMsg,
      syncedAt: syncTimestamp,
    };
  }

  const latestScheduleById = new Map<string, ProductionSchedule>();
  for (const target of targetsToSync) {
    for (const sch of target.schedules) {
      if (!latestScheduleById.has(sch.id)) {
        latestScheduleById.set(sch.id, sch);
      }
    }
  }

  params.onProgress?.({
    phase: 'syncing',
    totalOrs: totalOrsToProcess,
    processedOrs: 0,
    succeededOrs: 0,
    failedOrs: failedFetchResults.length,
    currentOr: targetsToSync[0].bucket.orNumber,
    totalSchedules: totalSchedulesToProcess,
    completedSchedules: 0,
    syncedSchedules: 0,
    failedSchedules: 0,
    percent: 25,
    statusText: `Menyinkronkan ${totalSchedulesToProcess} jadwal produksi di ${targetsToSync.length} OR...`,
  });

  const orSummaries: ScheduleAutoSyncSummary[] = [];
  const allUpdatedSchedulesById: Record<string, ProductionSchedule> = {};
  const allSyncedIdSet = new Set<string>();
  const allFailedSchedules: ScheduleSyncFailureDetail[] = [];

  for (const ff of failedFetchResults) {
    orSummaries.push({
      status: 'failed',
      targetOr: ff.bucket.orNumber,
      uploadId: ff.bucket.latestUpload?.id,
      updateDate: ff.bucket.latestUpload?.updateDate,
      matchedScheduleCount: 0,
      syncedScheduleIds: [],
      failedSchedules: [],
      updatedSchedulesById: {},
      error: ff.error || `Gagal mengambil jadwal untuk OR ${ff.bucket.orNumber}.`,
      syncedAt: syncTimestamp,
    });
  }

  let processedOrs = failedFetchResults.length;
  let succeededOrs = 0;
  let failedOrs = failedFetchResults.length;
  let cumulativeCompleted = 0;
  let cumulativeSynced = 0;
  let cumulativeFailed = 0;

  for (const target of targetsToSync) {
    const { bucket, schedules: rawOrSchedules } = target;
    // Reuse latest in-memory version of each schedule so mixed-OR schedules keep prior OR updates
    const currentOrSchedules = rawOrSchedules.map((s) => latestScheduleById.get(s.id) || s);

    const orSummary = await syncSchedulesForMasterDataOr({
      targetOr: bucket.orNumber,
      uploadId: bucket.latestUpload?.id,
      updateDate: bucket.latestUpload?.updateDate,
      schedules: currentOrSchedules,
      // Strict per-OR isolation: pass ONLY this OR's resolved Master Data rows & upload
      masterRequirements: bucket.requirements,
      uploadHistory: bucket.uploadHistory,
      persistScheduleSnapshot: params.persistScheduleSnapshot,
      syncTimestampIso: syncTimestamp,
      concurrency: workerLimit,
      onProgress: (syncProg) => {
        const globalCompleted = cumulativeCompleted + syncProg.completedSchedules;
        const globalSynced = cumulativeSynced + syncProg.syncedSchedules;
        const globalFailed = cumulativeFailed + syncProg.failedSchedules;
        const pct =
          totalSchedulesToProcess === 0
            ? 99
            : Math.min(99, 25 + Math.round((globalCompleted / totalSchedulesToProcess) * 74));

        params.onProgress?.({
          phase: 'syncing',
          totalOrs: totalOrsToProcess,
          processedOrs,
          succeededOrs,
          failedOrs,
          currentOr: bucket.orNumber,
          totalSchedules: totalSchedulesToProcess,
          completedSchedules: globalCompleted,
          syncedSchedules: globalSynced,
          failedSchedules: globalFailed,
          percent: pct,
          statusText: `Menyinkronkan OR ${bucket.orNumber} (${syncProg.completedSchedules}/${syncProg.totalSchedules} jadwal)...`,
        });
      },
    });

    orSummaries.push(orSummary);
    processedOrs++;
    cumulativeCompleted += orSummary.matchedScheduleCount;
    cumulativeSynced += orSummary.syncedScheduleIds.length;
    cumulativeFailed += orSummary.failedSchedules.length;

    if (orSummary.status === 'success' || orSummary.status === 'no_schedules') {
      succeededOrs++;
    } else {
      failedOrs++;
    }

    for (const [schId, updatedSch] of Object.entries(orSummary.updatedSchedulesById)) {
      latestScheduleById.set(schId, updatedSch);
      allUpdatedSchedulesById[schId] = updatedSch;
    }
    for (const id of orSummary.syncedScheduleIds) {
      allSyncedIdSet.add(id);
    }
    for (const fail of orSummary.failedSchedules) {
      allFailedSchedules.push(fail);
    }
  }

  const allSyncedScheduleIds = Array.from(allSyncedIdSet);

  if (allFailedSchedules.length === 0 && failedFetchResults.length === 0) {
    params.onProgress?.({
      phase: 'completed',
      totalOrs: totalOrsToProcess,
      processedOrs,
      succeededOrs,
      failedOrs: 0,
      totalSchedules: totalSchedulesToProcess,
      completedSchedules: cumulativeCompleted,
      syncedSchedules: cumulativeSynced,
      failedSchedules: 0,
      percent: 100,
      statusText: `Refresh selesai! ${succeededOrs}/${totalOrsToProcess} OR & ${cumulativeSynced}/${totalSchedulesToProcess} jadwal produksi berhasil diperbarui.`,
    });
    return {
      status: 'success',
      totalOrs: totalOrsToProcess,
      succeededOrs,
      failedOrs: 0,
      totalSchedules: totalSchedulesToProcess,
      syncedScheduleIds: allSyncedScheduleIds,
      failedSchedules: [],
      orSummaries,
      updatedSchedulesById: allUpdatedSchedulesById,
      syncedAt: syncTimestamp,
    };
  }

  const status: GlobalScheduleSyncSummary['status'] =
    cumulativeSynced > 0 || succeededOrs > 0 ? 'partial_failure' : 'failed';
  const errMsg =
    allFailedSchedules.length > 0
      ? `${allFailedSchedules.length} dari ${totalSchedulesToProcess} jadwal (${failedOrs} OR) gagal disinkronkan: ${allFailedSchedules[0].error}`
      : failedFetchResults[0]?.error || 'Sebagian OR gagal disinkronkan.';
  const partialPct = Math.min(
    99,
    25 + Math.round((cumulativeSynced / Math.max(1, totalSchedulesToProcess)) * 74)
  );

  params.onProgress?.({
    phase: status,
    totalOrs: totalOrsToProcess,
    processedOrs,
    succeededOrs,
    failedOrs,
    totalSchedules: totalSchedulesToProcess,
    completedSchedules: cumulativeCompleted,
    syncedSchedules: cumulativeSynced,
    failedSchedules: cumulativeFailed,
    percent: partialPct,
    statusText: errMsg,
  });

  return {
    status,
    totalOrs: totalOrsToProcess,
    succeededOrs,
    failedOrs,
    totalSchedules: totalSchedulesToProcess,
    syncedScheduleIds: allSyncedScheduleIds,
    failedSchedules: allFailedSchedules,
    orSummaries,
    updatedSchedulesById: allUpdatedSchedulesById,
    error: errMsg,
    syncedAt: syncTimestamp,
  };
}
