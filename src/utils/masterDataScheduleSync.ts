import {
  MaterialItemRequirement,
  ProductionSchedule,
  UploadHistoryItem,
  WorksheetPdfItem,
} from '../types/ppic';
import { areOrNumbersMatching, buildWorksheetSnapshot } from './pdfWorksheetParser';

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
  syncTimestampIso?: string
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
    // Match against `targetOr` when wsOr uses a compatible variant, while preserving ws.orNumber verbatim
    const snapshot = buildWorksheetSnapshot(ws, masterRequirements, uploadHistory, timestamp);
    return {
      ...snapshot,
      id: ws.id,
      fileName: ws.fileName,
      orNumber: ws.orNumber,
      rawOrNumber: ws.rawOrNumber,
      worksheetNo: ws.worksheetNo,
      style: ws.style,
      target: ws.target,
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

  const syncedScheduleIds: string[] = [];
  const failedSchedules: ScheduleSyncFailureDetail[] = [];
  const updatedSchedulesById: Record<string, ProductionSchedule> = {};

  for (const sch of matchingSchedules) {
    const { hasMatchingWorksheet, updatedSchedule } = buildScheduleMaterialSyncUpdate(
      sch,
      params.targetOr,
      params.masterRequirements,
      params.uploadHistory,
      syncTimestamp
    );

    if (!hasMatchingWorksheet) continue;

    try {
      const persistRes = await params.persistScheduleSnapshot(updatedSchedule);
      if (persistRes.success) {
        syncedScheduleIds.push(sch.id);
        updatedSchedulesById[sch.id] = updatedSchedule;
      } else {
        failedSchedules.push({
          scheduleId: sch.id,
          orNumber: sch.orNumber,
          worksheetNo: sch.worksheets?.[0]?.worksheetNo,
          style: sch.style,
          productionLine: sch.productionLine,
          error:
            persistRes.error ||
            'Gagal menyimpan pembaruan snapshot material ke database.',
        });
      }
    } catch (err: any) {
      failedSchedules.push({
        scheduleId: sch.id,
        orNumber: sch.orNumber,
        worksheetNo: sch.worksheets?.[0]?.worksheetNo,
        style: sch.style,
        productionLine: sch.productionLine,
        error: err?.message || String(err) || 'Kesalahan saat menyinkronkan jadwal.',
      });
    }
  }

  let status: ScheduleAutoSyncSummary['status'] = 'success';
  let errorSummary: string | undefined;

  if (failedSchedules.length > 0) {
    status = syncedScheduleIds.length > 0 ? 'partial_failure' : 'failed';
    errorSummary = `${failedSchedules.length} dari ${matchingSchedules.length} jadwal gagal disinkronkan: ${failedSchedules[0].error}`;
  }

  return {
    status,
    targetOr: params.targetOr,
    uploadId: params.uploadId,
    updateDate: params.updateDate,
    matchedScheduleCount: matchingSchedules.length,
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
