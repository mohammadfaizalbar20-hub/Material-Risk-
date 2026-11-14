import { ProductionSchedule, WorksheetPdfItem } from '../types/ppic';
import { isValidUuid } from './uuid';

export const WORKSHEET_PAYLOAD_PREFIX = '[WORKSHEET_PAYLOAD]';

export interface NormalizedWorksheetDbRow {
  id: string;
  schedule_id: string;
  file_name: string;
  or_number: string;
  style: string;
  target: number;
  matched_upload_id: string | null;
  matched_upload_date: string | null;
  matched_upload_time: string | null;
  matched_upload_created_at: string | null;
  last_synced_at: string | null;
  uploaded_at: string;
}

export interface NormalizedMaterialSnapshotDbRow {
  id: string;
  schedule_id: string;
  worksheet_id: string;
  row_order: number;
  or_number: string;
  style: string;
  material_code: string;
  material_name: string;
  unit: string;
  pdf_total: number;
  received_qty: number | null;
  status: 'READY' | 'BELUM READY' | null;
  is_found_in_master_data: boolean;
  matched_upload_id: string | null;
  matched_upload_date: string | null;
  matched_upload_time: string | null;
  matched_upload_created_at: string | null;
  matched_at: string;
}

export interface AtomicSnapshotSyncPayload {
  p_schedule_id: string;
  p_notes: string | null;
  p_worksheets_snapshot: WorksheetPdfItem[];
  p_worksheets: NormalizedWorksheetDbRow[];
  p_material_snapshots: NormalizedMaterialSnapshotDbRow[];
}

export interface SnapshotSyncRpcResponse {
  data?: any;
  error?: { message?: string; code?: string; details?: string; hint?: string } | null;
}

export interface SnapshotSyncRpcGateway {
  callSyncRpc: (payload: AtomicSnapshotSyncPayload) => Promise<SnapshotSyncRpcResponse>;
}

function isValidCalendarParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function isValidIsoCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  return isValidCalendarParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function normalizeOptionalSnapshotDate(
  val: unknown,
  fieldLabel: string
):
  | { ok: true; snapshotValue: string | null | undefined; dbValue: string | null }
  | { ok: false; error: string } {
  if (val === undefined) {
    return { ok: true, snapshotValue: undefined, dbValue: null };
  }
  if (val === null) {
    return { ok: true, snapshotValue: null, dbValue: null };
  }
  if (typeof val !== 'string') {
    return {
      ok: false,
      error: `${fieldLabel} harus berupa teks tanggal berformat YYYY-MM-DD atau null.`,
    };
  }

  const clean = val.trim();
  if (!clean) {
    return { ok: true, snapshotValue: null, dbValue: null };
  }

  // Strict YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidCalendarParts(year, month, day)) {
      return {
        ok: false,
        error: `${fieldLabel} ("${clean}") bukan tanggal kalender yang valid.`,
      };
    }
    return { ok: true, snapshotValue: clean, dbValue: clean };
  }

  // ISO timestamp prefix YYYY-MM-DDT...
  const isoTsMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})T.+$/);
  if (isoTsMatch) {
    const year = Number(isoTsMatch[1]);
    const month = Number(isoTsMatch[2]);
    const day = Number(isoTsMatch[3]);
    if (!isValidCalendarParts(year, month, day) || isNaN(Date.parse(clean))) {
      return {
        ok: false,
        error: `${fieldLabel} ("${clean}") bukan tanggal ISO yang valid.`,
      };
    }
    const isoDate = `${isoTsMatch[1]}-${isoTsMatch[2]}-${isoTsMatch[3]}`;
    return { ok: true, snapshotValue: isoDate, dbValue: isoDate };
  }

  // Legacy DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const dayNum = Number(dmyMatch[1]);
    const monthNum = Number(dmyMatch[2]);
    const yearNum = Number(dmyMatch[3]);
    if (!isValidCalendarParts(yearNum, monthNum, dayNum)) {
      return {
        ok: false,
        error: `${fieldLabel} ("${clean}") bukan tanggal kalender yang valid.`,
      };
    }
    const isoDate = `${String(yearNum).padStart(4, '0')}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    return { ok: true, snapshotValue: isoDate, dbValue: isoDate };
  }

  return {
    ok: false,
    error: `${fieldLabel} ("${clean}") tidak sesuai format tanggal ISO YYYY-MM-DD.`,
  };
}

function defaultSafeDate(val?: string | null): string {
  if (!val || typeof val !== 'string' || !val.trim()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  }
  const clean = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  if (/^\d{4}-\d{2}-\d{2}T/.test(clean)) return clean.slice(0, 10);
  const dmyMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/**
 * Returns cloned worksheet snapshot array for JSONB column `worksheets_snapshot`.
 * Always returns an array (`[]` when schedule has no PDFs, never `null`) to match JSONB type.
 */
export function buildScheduleWorksheetsSnapshotArray(schedule: ProductionSchedule): WorksheetPdfItem[] {
  if (!Array.isArray(schedule.worksheets) || schedule.worksheets.length === 0) {
    return [];
  }
  return schedule.worksheets.map((ws) => ({
    ...ws,
    materials: Array.isArray(ws.materials) ? ws.materials.map((mat) => ({ ...mat })) : [],
  }));
}

/**
 * Builds the primary `production_schedules.notes` payload consistently with `worksheets_snapshot`.
 */
export function buildScheduleNotesPayload(schedule: ProductionSchedule): string | null {
  const worksheets = buildScheduleWorksheetsSnapshotArray(schedule);
  if (worksheets.length > 0) {
    return `${WORKSHEET_PAYLOAD_PREFIX}${JSON.stringify({
      userNotes: schedule.notes || '',
      worksheets,
    })}`;
  }
  return schedule.notes && schedule.notes.trim() ? schedule.notes : null;
}

/**
 * Validates and constructs the complete 4-layer snapshot sync payload BEFORE any DB write.
 * Preserves duplicate material codes and exact row ordering (`row_order: idx`).
 */
export function buildAtomicSnapshotSyncPayload(
  scheduleId: string,
  schedule: ProductionSchedule,
  safeDateFn: (val?: string | null) => string = defaultSafeDate
): { success: true; payload: AtomicSnapshotSyncPayload } | { success: false; error: string } {
  if (!scheduleId || !isValidUuid(scheduleId)) {
    return {
      success: false,
      error: `ID jadwal "${scheduleId}" bukan UUID yang valid untuk sinkronisasi snapshot.`,
    };
  }

  const cleanScheduleId = scheduleId.trim().toLowerCase();
  const worksheets = buildScheduleWorksheetsSnapshotArray(schedule);

  const wsRows: NormalizedWorksheetDbRow[] = [];
  const matRows: NormalizedMaterialSnapshotDbRow[] = [];
  const seenWorksheetIds = new Set<string>();
  const fallbackIso = new Date().toISOString();

  for (let wsIdx = 0; wsIdx < worksheets.length; wsIdx++) {
    const ws = worksheets[wsIdx];
    const rawWsId = typeof ws.id === 'string' ? ws.id.trim() : '';
    const fileName = typeof ws.fileName === 'string' ? ws.fileName.trim() : '';
    const orNumber = typeof ws.orNumber === 'string' ? ws.orNumber.trim() : '';
    const style = typeof ws.style === 'string' ? ws.style.trim() : '';
    const targetNum = Number(ws.target ?? 0);

    if (!rawWsId) {
      return {
        success: false,
        error: `Worksheet ke-${wsIdx + 1} tidak memiliki ID yang valid.`,
      };
    }
    if (!fileName || !orNumber || !style) {
      return {
        success: false,
        error: `Data Worksheet "${fileName || rawWsId}" tidak lengkap (fileName, orNumber, dan style wajib terisi).`,
      };
    }
    if (!Number.isFinite(targetNum) || targetNum < 0) {
      return {
        success: false,
        error: `Target produksi Worksheet "${fileName}" harus berupa angka valid >= 0.`,
      };
    }

    const normalizedWsId = `${cleanScheduleId}__${rawWsId}`;
    if (seenWorksheetIds.has(normalizedWsId)) {
      return {
        success: false,
        error: `Terdapat duplikasi ID Worksheet "${rawWsId}" dalam jadwal yang sama.`,
      };
    }
    seenWorksheetIds.add(normalizedWsId);

    const wsDateNorm = normalizeOptionalSnapshotDate(
      ws.matchedUploadDate,
      `matchedUploadDate Worksheet "${fileName}"`
    );
    if (wsDateNorm.ok === false) {
      return { success: false, error: wsDateNorm.error };
    }

    let wsDbDate: string | null = null;
    if (wsDateNorm.dbValue !== null) {
      const formatted = safeDateFn(wsDateNorm.dbValue);
      if (!isValidIsoCalendarDate(formatted)) {
        return {
          success: false,
          error: `matched_upload_date Worksheet "${fileName}" ("${formatted}") bukan tanggal kalender YYYY-MM-DD yang valid.`,
        };
      }
      wsDbDate = formatted;
      ws.matchedUploadDate = formatted;
    } else if ('matchedUploadDate' in ws) {
      ws.matchedUploadDate = wsDateNorm.snapshotValue;
    }

    const wsUploadedAt = ws.uploadedAt || fallbackIso;
    wsRows.push({
      id: normalizedWsId,
      schedule_id: cleanScheduleId,
      file_name: fileName,
      or_number: orNumber,
      style,
      target: targetNum,
      matched_upload_id: ws.matchedUploadId || null,
      matched_upload_date: wsDbDate,
      matched_upload_time: ws.matchedUploadTime || null,
      matched_upload_created_at: ws.matchedUploadCreatedAt || null,
      last_synced_at: ws.lastSyncedAt || null,
      uploaded_at: wsUploadedAt,
    });

    const materials = Array.isArray(ws.materials) ? ws.materials : [];
    for (let idx = 0; idx < materials.length; idx++) {
      const mat = materials[idx];
      const matCode = typeof mat.materialCode === 'string' ? mat.materialCode.trim() : '';
      const matName = typeof mat.materialName === 'string' ? mat.materialName.trim() : '';
      const unit = typeof mat.unit === 'string' ? mat.unit.trim() : '';
      const pdfTotal = Number(mat.total ?? 0);

      if (!matCode || !matName || !unit) {
        return {
          success: false,
          error: `Baris material ke-${idx + 1} pada Worksheet "${fileName}" tidak lengkap (kode, nama, dan satuan wajib terisi).`,
        };
      }
      if (!Number.isFinite(pdfTotal) || pdfTotal < 0) {
        return {
          success: false,
          error: `Kebutuhan material "${matCode}" pada Worksheet "${fileName}" tidak valid.`,
        };
      }

      let receivedQty: number | null = null;
      if (mat.receivedQty !== undefined && mat.receivedQty !== null) {
        if (typeof mat.receivedQty !== 'number' || !Number.isFinite(mat.receivedQty) || mat.receivedQty < 0) {
          return {
            success: false,
            error: `Nilai Diterima material "${matCode}" pada Worksheet "${fileName}" tidak valid (wajib null atau angka >= 0, bukan string/boolean).`,
          };
        }
        receivedQty = mat.receivedQty;
      }

      const rawStatus = mat.status as unknown;
      if (rawStatus !== undefined && rawStatus !== null) {
        if (typeof rawStatus !== 'string' || rawStatus.trim() === '' || (rawStatus !== 'READY' && rawStatus !== 'BELUM READY')) {
          return {
            success: false,
            error: `Status material "${matCode}" pada Worksheet "${fileName}" tidak valid (hanya null, READY, atau BELUM READY).`,
          };
        }
      }
      const normalizedStatus: 'READY' | 'BELUM READY' | null =
        rawStatus !== undefined && rawStatus !== null ? (rawStatus as 'READY' | 'BELUM READY') : null;

      const rawIsFound = mat.isFoundInMasterData as unknown;
      if (rawIsFound !== undefined && rawIsFound !== null && typeof rawIsFound !== 'boolean') {
        return {
          success: false,
          error: `Nilai isFoundInMasterData material "${matCode}" pada Worksheet "${fileName}" wajib berupa boolean atau null (bukan string/angka).`,
        };
      }

      if ((receivedQty === null) !== (normalizedStatus === null)) {
        return {
          success: false,
          error: `Inkonsistensi material "${matCode}" pada Worksheet "${fileName}": nilai Diterima dan Status harus sama-sama terisi atau sama-sama kosong.`,
        };
      }

      if (rawIsFound === true && (receivedQty === null || normalizedStatus === null)) {
        return {
          success: false,
          error: `Material "${matCode}" pada Worksheet "${fileName}" yang ditemukan di Master Data wajib memiliki nilai Diterima dan Status.`,
        };
      }

      if (rawIsFound === false && (receivedQty !== null || normalizedStatus !== null)) {
        return {
          success: false,
          error: `Material "${matCode}" pada Worksheet "${fileName}" yang tidak ditemukan di Master Data (isFoundInMasterData = false) wajib memiliki Diterima = null dan Status = null.`,
        };
      }

      const matDateNorm = normalizeOptionalSnapshotDate(
        mat.matchedUploadDate,
        `matchedUploadDate material "${matCode}" pada Worksheet "${fileName}"`
      );
      if (matDateNorm.ok === false) {
        return { success: false, error: matDateNorm.error };
      }

      let matDbDate: string | null = null;
      if (matDateNorm.dbValue !== null) {
        const formatted = safeDateFn(matDateNorm.dbValue);
        if (!isValidIsoCalendarDate(formatted)) {
          return {
            success: false,
            error: `matched_upload_date material "${matCode}" pada Worksheet "${fileName}" ("${formatted}") bukan tanggal kalender YYYY-MM-DD yang valid.`,
          };
        }
        matDbDate = formatted;
        mat.matchedUploadDate = formatted;
      } else if ('matchedUploadDate' in mat) {
        mat.matchedUploadDate = matDateNorm.snapshotValue;
      }

      const normalizedIsFound: boolean =
        typeof rawIsFound === 'boolean' ? rawIsFound : receivedQty !== null;

      matRows.push({
        id: `${normalizedWsId}__${idx}`,
        schedule_id: cleanScheduleId,
        worksheet_id: normalizedWsId,
        row_order: idx,
        or_number: orNumber,
        style,
        material_code: matCode,
        material_name: matName,
        unit,
        pdf_total: pdfTotal,
        received_qty: receivedQty,
        status: normalizedStatus,
        is_found_in_master_data: normalizedIsFound,
        matched_upload_id: mat.matchedUploadId || ws.matchedUploadId || null,
        matched_upload_date: matDbDate,
        matched_upload_time: mat.matchedUploadTime || null,
        matched_upload_created_at: mat.matchedUploadCreatedAt || null,
        matched_at: mat.matchedAt || ws.lastSyncedAt || fallbackIso,
      });
    }
  }

  const notesPayload = buildScheduleNotesPayload({ ...schedule, worksheets });

  return {
    success: true,
    payload: {
      p_schedule_id: cleanScheduleId,
      p_notes: notesPayload,
      p_worksheets_snapshot: worksheets,
      p_worksheets: wsRows,
      p_material_snapshots: matRows,
    },
  };
}

export function formatSnapshotSyncError(error: any): string {
  const rawMessage = error?.message || String(error || 'Terjadi kesalahan saat sinkronisasi snapshot.');
  const code = error?.code || '';

  if (
    code === 'PGRST202' ||
    code === '42883' ||
    rawMessage.toLowerCase().includes('sync_production_schedule_snapshots') &&
      rawMessage.toLowerCase().includes('could not find')
  ) {
    return 'Fungsi RPC database "sync_production_schedule_snapshots" belum diterapkan di Supabase. Jalankan draft SQL migrasi Stage 2B di Supabase SQL Editor terlebih dahulu.';
  }

  if (code === '42501' || rawMessage.toLowerCase().includes('permission denied') || rawMessage.toLowerCase().includes('row-level security')) {
    return `Izin database (RLS/EXECUTE) menolak sinkronisasi snapshot: ${rawMessage}`;
  }

  return `Sinkronisasi snapshot atomik gagal dan dibatalkan: ${rawMessage}`;
}

/**
 * Executes the atomic 4-layer snapshot sync via PostgreSQL RPC.
 * Never swallows errors; guarantees callers know whether the transaction committed or rolled back.
 */
export async function executeAtomicSnapshotSync(
  scheduleId: string,
  schedule: ProductionSchedule,
  gateway: SnapshotSyncRpcGateway,
  safeDateFn: (val?: string | null) => string = defaultSafeDate
): Promise<{ success: boolean; error?: string; payload?: AtomicSnapshotSyncPayload }> {
  const built = buildAtomicSnapshotSyncPayload(scheduleId, schedule, safeDateFn);
  if (built.success === false) {
    return { success: false, error: built.error };
  }

  try {
    const res = await gateway.callSyncRpc(built.payload);
    if (res.error) {
      return {
        success: false,
        error: formatSnapshotSyncError(res.error),
      };
    }

    if (res.data && typeof res.data === 'object' && res.data.success === false) {
      return {
        success: false,
        error: res.data.error || 'Transaksi RPC sinkronisasi snapshot gagal.',
      };
    }

    return {
      success: true,
      payload: built.payload,
    };
  } catch (err: any) {
    return {
      success: false,
      error: formatSnapshotSyncError(err),
    };
  }
}
