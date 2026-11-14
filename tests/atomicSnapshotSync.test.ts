import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductionSchedule, WorksheetPdfItem } from '../src/types/ppic';
import { generateUuid } from '../src/utils/uuid';
import {
  WORKSHEET_PAYLOAD_PREFIX,
  AtomicSnapshotSyncPayload,
  buildAtomicSnapshotSyncPayload,
  buildScheduleNotesPayload,
  buildScheduleWorksheetsSnapshotArray,
  executeAtomicSnapshotSync,
  isValidIsoCalendarDate,
  NormalizedWorksheetDbRow,
  NormalizedMaterialSnapshotDbRow,
} from '../src/utils/scheduleSnapshotSync';
import {
  ScheduleRemoteGateway,
  createScheduleWithPersistence,
  updateScheduleWithPersistence,
} from '../src/utils/scheduleCrudLogic';
import { mapDbScheduleToModel, mapModelToDbSchedule } from '../src/lib/supabase';

import fs from 'node:fs';
import path from 'node:path';

interface SimulatedScheduleRow {
  id: string;
  or_number: string;
  style: string;
  production_line: string;
  production_date: string;
  finish_date: string;
  target: number;
  status: string;
  notes: string | null;
  worksheets_snapshot: WorksheetPdfItem[];
}

/**
 * Simulates PostgreSQL transactional execution of `public.sync_production_schedule_snapshots`
 * across all 4 storage layers, mirroring Phase 1 strict validations, ownership guards,
 * ON CONFLICT ... WHERE schedule_id = p_schedule_id, post-UPSERT row count checks,
 * and full rollback on failure at any phase.
 */
function createTransactional4LayerDb() {
  let schedules = new Map<string, SimulatedScheduleRow>();
  let worksheets = new Map<string, NormalizedWorksheetDbRow>();
  let materialSnapshots = new Map<string, NormalizedMaterialSnapshotDbRow>();

  let failStage:
    | null
    | 'worksheet'
    | 'material_snapshot'
    | 'schedule_update'
    | 'missing_rpc'
    | 'simulate_on_conflict_skip_ws'
    | 'simulate_on_conflict_skip_mat' = null;

  const cloneState = () => ({
    schedules: new Map(
      Array.from(schedules.entries()).map(([k, v]) => [
        k,
        { ...v, worksheets_snapshot: JSON.parse(JSON.stringify(v.worksheets_snapshot)) },
      ])
    ),
    worksheets: new Map(Array.from(worksheets.entries()).map(([k, v]) => [k, { ...v }])),
    materialSnapshots: new Map(Array.from(materialSnapshots.entries()).map(([k, v]) => [k, { ...v }])),
  });

  const restoreState = (snap: ReturnType<typeof cloneState>) => {
    schedules = snap.schedules;
    worksheets = snap.worksheets;
    materialSnapshots = snap.materialSnapshots;
  };

  const runSyncRpc = async (payload: AtomicSnapshotSyncPayload) => {
    if (failStage === 'missing_rpc') {
      return {
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.sync_production_schedule_snapshots in the schema cache',
        },
      };
    }

    const txBackup = cloneState();
    try {
      if (!payload.p_schedule_id) {
        throw { code: '22023', message: 'schedule_id wajib diisi' };
      }

      const normalizedScheduleId = payload.p_schedule_id.trim().toLowerCase();
      const schedulePrefix = `${normalizedScheduleId}__`;

      if (!Array.isArray(payload.p_worksheets_snapshot)) {
        throw { code: '22023', message: 'worksheets_snapshot harus berupa JSON array' };
      }
      if (!Array.isArray(payload.p_worksheets)) {
        throw { code: '22023', message: 'p_worksheets harus berupa JSON array' };
      }
      if (!Array.isArray(payload.p_material_snapshots)) {
        throw { code: '22023', message: 'p_material_snapshots harus berupa JSON array' };
      }

      if (payload.p_worksheets_snapshot.length !== payload.p_worksheets.length) {
        throw { code: '22023', message: 'Inkonsistensi jumlah worksheet antara worksheets_snapshot dan p_worksheets' };
      }

      if (payload.p_worksheets.length === 0 && payload.p_material_snapshots.length > 0) {
        throw { code: '22023', message: 'Material snapshot tidak boleh dikirim ketika tanpa Worksheet PDF' };
      }

      // Layer 1 (notes) vs Layer 2 (worksheets_snapshot)
      if (payload.p_worksheets.length > 0) {
        if (!payload.p_notes || !payload.p_notes.startsWith(WORKSHEET_PAYLOAD_PREFIX)) {
          throw { code: '22023', message: 'notes wajib memuat [WORKSHEET_PAYLOAD]' };
        }
        let parsedNotes: any;
        try {
          parsedNotes = JSON.parse(payload.p_notes.slice(WORKSHEET_PAYLOAD_PREFIX.length));
        } catch {
          throw { code: '22023', message: 'Payload JSON pada notes tidak valid' };
        }
        if (
          !parsedNotes ||
          typeof parsedNotes !== 'object' ||
          !Array.isArray(parsedNotes.worksheets) ||
          JSON.stringify(parsedNotes.worksheets) !== JSON.stringify(payload.p_worksheets_snapshot)
        ) {
          throw { code: '22023', message: 'Inkonsistensi Layer 1 & Layer 2: key worksheets pada notes tidak identik dengan worksheets_snapshot' };
        }
      } else if (payload.p_notes && payload.p_notes.startsWith(WORKSHEET_PAYLOAD_PREFIX)) {
        throw { code: '22023', message: 'notes tidak boleh memuat [WORKSHEET_PAYLOAD] ketika tanpa PDF' };
      }

      const target = schedules.get(normalizedScheduleId);
      if (!target) {
        throw { code: 'P0002', message: `Schedule ${normalizedScheduleId} not found` };
      }

      // Duplicate ID checks
      const seenSnapWsIds = new Set<string>();
      for (const s of payload.p_worksheets_snapshot) {
        const sid = typeof s?.id === 'string' ? s.id.trim() : '';
        if (!sid) throw { code: '22023', message: 'Worksheet snapshot id wajib diisi' };
        if (seenSnapWsIds.has(sid)) throw { code: '23505', message: `Duplikasi Worksheet ID "${sid}" dalam worksheets_snapshot` };
        seenSnapWsIds.add(sid);
      }

      const parseStrictRpcOptionalDate = (val: unknown, label: string): string | null => {
        if (val === undefined || val === null) return null;
        if (typeof val !== 'string') {
          throw { code: '22023', message: `${label} harus bernilai NULL atau teks ISO YYYY-MM-DD.` };
        }
        const clean = val.trim();
        if (!clean) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
          throw { code: '22023', message: `Format ${label} ("${clean}") tidak valid. Wajib berformat ISO YYYY-MM-DD.` };
        }
        if (!isValidIsoCalendarDate(clean)) {
          throw { code: '22023', message: `${label} ("${clean}") bukan tanggal kalender yang valid.` };
        }
        return clean;
      };

      const seenNormWsIds = new Set<string>();
      for (const w of payload.p_worksheets) {
        if (!w?.id) throw { code: '22023', message: 'Worksheet id wajib diisi' };
        if (seenNormWsIds.has(w.id)) throw { code: '23505', message: `Duplikasi Worksheet ID "${w.id}" dalam p_worksheets` };
        seenNormWsIds.add(w.id);

        if (!w.id.startsWith(schedulePrefix) || w.id.slice(schedulePrefix.length).trim().length === 0) {
          throw { code: '42501', message: `Kepemilikan Worksheet ID "${w.id}" tidak valid: wajib prefix ${schedulePrefix}` };
        }
        if ((w.schedule_id || '').trim().toLowerCase() !== normalizedScheduleId) {
          throw { code: '42501', message: `schedule_id worksheet ${w.schedule_id} tidak cocok dengan ${normalizedScheduleId}` };
        }
        if (!w.file_name?.trim() || !w.or_number?.trim() || !w.style?.trim()) {
          throw { code: '22023', message: 'file_name, or_number, dan style wajib diisi' };
        }
        if (!Number.isFinite(Number(w.target)) || Number(w.target) < 0) {
          throw { code: '22023', message: 'Target worksheet tidak boleh negatif' };
        }
        parseStrictRpcOptionalDate(w.matched_upload_date, `matched_upload_date pada worksheet "${w.id}"`);
      }

      const seenMatIds = new Set<string>();
      const seenWsRowOrder = new Set<string>();
      for (const m of payload.p_material_snapshots) {
        if (!m?.id) throw { code: '22023', message: 'Material snapshot id wajib diisi' };
        if (seenMatIds.has(m.id)) throw { code: '23505', message: `Duplikasi Material Snapshot ID "${m.id}" dalam p_material_snapshots` };
        seenMatIds.add(m.id);

        if ((m.schedule_id || '').trim().toLowerCase() !== normalizedScheduleId) {
          throw { code: '42501', message: `schedule_id material snapshot ${m.schedule_id} tidak cocok dengan ${normalizedScheduleId}` };
        }
        if (!m.worksheet_id?.startsWith(schedulePrefix)) {
          throw { code: '42501', message: `Kepemilikan worksheet_id "${m.worksheet_id}" tidak valid` };
        }
        if (!seenNormWsIds.has(m.worksheet_id)) {
          throw { code: '23503', message: `worksheet_id "${m.worksheet_id}" tidak ada di payload` };
        }

        if (
          typeof m.row_order !== 'number' ||
          !Number.isInteger(m.row_order) ||
          m.row_order < 0 ||
          m.row_order > 2147483647
        ) {
          throw { code: '22023', message: `row_order material snapshot "${m.id}" harus bilangan bulat >= 0 dalam rentang INTEGER` };
        }
        if (m.id !== `${m.worksheet_id}__${m.row_order}`) {
          throw { code: '42501', message: `Format ID material snapshot "${m.id}" harus "${m.worksheet_id}__${m.row_order}"` };
        }

        const pairKey = `${m.worksheet_id}::${m.row_order}`;
        if (seenWsRowOrder.has(pairKey)) {
          throw { code: '23505', message: `Duplikasi pasangan (worksheet_id, row_order): ${pairKey}` };
        }
        seenWsRowOrder.add(pairKey);

        if (m.received_qty !== null && m.received_qty !== undefined) {
          if (typeof m.received_qty !== 'number' || !Number.isFinite(m.received_qty) || m.received_qty < 0) {
            throw { code: '22023', message: `received_qty material snapshot "${m.id}" harus NULL atau JSON number >= 0` };
          }
        }
        if (m.status !== null && m.status !== undefined) {
          if (typeof m.status !== 'string' || m.status.trim() === '' || (m.status !== 'READY' && m.status !== 'BELUM READY')) {
            throw { code: '22023', message: `status material snapshot "${m.id}" tidak valid ("${m.status}")` };
          }
        }
        if (
          m.is_found_in_master_data !== null &&
          m.is_found_in_master_data !== undefined &&
          typeof m.is_found_in_master_data !== 'boolean'
        ) {
          throw { code: '22023', message: `is_found_in_master_data harus NULL atau JSON boolean` };
        }
        if (m.is_found_in_master_data === true && (m.received_qty === null || m.received_qty === undefined || m.status === null || m.status === undefined)) {
          throw { code: '22023', message: `is_found_in_master_data = TRUE wajib memiliki received_qty dan status` };
        }
        if (m.is_found_in_master_data === false && ((m.received_qty !== null && m.received_qty !== undefined) || (m.status !== null && m.status !== undefined))) {
          throw { code: '22023', message: `is_found_in_master_data = FALSE wajib memiliki received_qty = NULL dan status = NULL` };
        }
        if ((m.received_qty === null || m.received_qty === undefined) !== (m.status === null || m.status === undefined)) {
          throw { code: '22023', message: `received_qty dan status harus sama-sama terisi atau sama-sama NULL` };
        }
        parseStrictRpcOptionalDate(m.matched_upload_date, `matched_upload_date pada material snapshot "${m.id}"`);
      }

      // Strict JSON type, consistency, and date validation on worksheets_snapshot BEFORE Layer 2/3/4 comparisons
      for (const snapWs of payload.p_worksheets_snapshot) {
        parseStrictRpcOptionalDate(snapWs.matchedUploadDate, `matchedUploadDate pada worksheets_snapshot "${snapWs.id}"`);
        const snapMats: any[] = Array.isArray(snapWs.materials) ? snapWs.materials : [];
        for (const snapMat of snapMats) {
          if (!snapMat || typeof snapMat !== 'object' || Array.isArray(snapMat)) {
            throw { code: '22023', message: `Setiap elemen material pada worksheets_snapshot "${snapWs.id}" harus JSON object.` };
          }
          const hasQty = snapMat.receivedQty !== undefined && snapMat.receivedQty !== null;
          if (hasQty && (typeof snapMat.receivedQty !== 'number' || !Number.isFinite(snapMat.receivedQty) || snapMat.receivedQty < 0)) {
            throw { code: '22023', message: `receivedQty material "${snapMat.materialCode}" harus bernilai NULL atau JSON number >= 0.` };
          }
          const hasStatus = snapMat.status !== undefined && snapMat.status !== null;
          if (hasStatus && (typeof snapMat.status !== 'string' || snapMat.status.trim() === '' || (snapMat.status !== 'READY' && snapMat.status !== 'BELUM READY'))) {
            throw { code: '22023', message: `status material "${snapMat.materialCode}" harus bernilai NULL, READY, atau BELUM READY.` };
          }
          if (snapMat.isFoundInMasterData !== undefined && snapMat.isFoundInMasterData !== null && typeof snapMat.isFoundInMasterData !== 'boolean') {
            throw { code: '22023', message: `isFoundInMasterData material "${snapMat.materialCode}" harus bernilai NULL atau JSON boolean.` };
          }
          if (snapMat.isFoundInMasterData === true && (!hasQty || !hasStatus)) {
            throw { code: '22023', message: `Material "${snapMat.materialCode}" dengan isFoundInMasterData = TRUE wajib memiliki receivedQty dan status.` };
          }
          if (snapMat.isFoundInMasterData === false && (hasQty || hasStatus)) {
            throw { code: '22023', message: `Material "${snapMat.materialCode}" dengan isFoundInMasterData = FALSE wajib memiliki receivedQty = NULL dan status = NULL.` };
          }
          if (hasQty !== hasStatus) {
            throw { code: '22023', message: `Inkonsistensi material "${snapMat.materialCode}": receivedQty dan status harus sama-sama terisi atau sama-sama NULL.` };
          }
          parseStrictRpcOptionalDate(
            snapMat.matchedUploadDate,
            `matchedUploadDate material "${snapMat.materialCode}" pada worksheets_snapshot "${snapWs.id}"`
          );
        }
      }

      // Layer 2 vs Layer 3 (per position WITH ORDINALITY)
      for (let i = 0; i < payload.p_worksheets_snapshot.length; i++) {
        const snapWs = payload.p_worksheets_snapshot[i];
        const normWs = payload.p_worksheets[i];
        const snapDate = parseStrictRpcOptionalDate(snapWs.matchedUploadDate, 'snapWs.matchedUploadDate');
        const normDate = parseStrictRpcOptionalDate(normWs.matched_upload_date, 'normWs.matched_upload_date');
        if (
          normWs.id !== `${schedulePrefix}${snapWs.id.trim()}` ||
          normWs.file_name.trim() !== (snapWs.fileName || '').trim() ||
          normWs.or_number.trim() !== (snapWs.orNumber || '').trim() ||
          normWs.style.trim() !== (snapWs.style || '').trim() ||
          Number(normWs.target) !== Number(snapWs.target ?? 0) ||
          (normWs.matched_upload_id || null) !== (snapWs.matchedUploadId || null) ||
          normDate !== snapDate
        ) {
          throw { code: '22023', message: `Inkonsistensi Layer 2 & Layer 3 (Worksheet) pada posisi ke-${i + 1}` };
        }
      }

      // Layer 2 vs Layer 4 (per worksheet + row_order)
      const expectedMats: Array<{ wsId: string; rowOrder: number; id: string; snapMat: any; snapWs: WorksheetPdfItem }> = [];
      for (const snapWs of payload.p_worksheets_snapshot) {
        const wsId = `${schedulePrefix}${snapWs.id.trim()}`;
        const mats = Array.isArray(snapWs.materials) ? snapWs.materials : [];
        for (let idx = 0; idx < mats.length; idx++) {
          expectedMats.push({
            wsId,
            rowOrder: idx,
            id: `${wsId}__${idx}`,
            snapMat: mats[idx],
            snapWs,
          });
        }
      }
      if (expectedMats.length !== payload.p_material_snapshots.length) {
        throw { code: '22023', message: 'Inkonsistensi jumlah material antara worksheets_snapshot dan p_material_snapshots' };
      }
      for (const exp of expectedMats) {
        const actual = payload.p_material_snapshots.find(
          (m) => m.worksheet_id === exp.wsId && m.row_order === exp.rowOrder
        );
        const snapMatDate = actual
          ? parseStrictRpcOptionalDate(exp.snapMat.matchedUploadDate, 'snapMat.matchedUploadDate')
          : null;
        const normMatDate = actual
          ? parseStrictRpcOptionalDate(actual.matched_upload_date, 'actual.matched_upload_date')
          : null;
        if (
          !actual ||
          actual.id !== exp.id ||
          actual.material_code.trim() !== (exp.snapMat.materialCode || '').trim() ||
          actual.material_name.trim() !== (exp.snapMat.materialName || '').trim() ||
          actual.unit.trim() !== (exp.snapMat.unit || '').trim() ||
          Number(actual.pdf_total) !== Number(exp.snapMat.total ?? 0) ||
          (actual.received_qty ?? null) !== (exp.snapMat.receivedQty ?? null) ||
          (actual.status ?? null) !== (exp.snapMat.status ?? null) ||
          (typeof exp.snapMat.isFoundInMasterData === 'boolean' &&
            (typeof actual.is_found_in_master_data !== 'boolean' ||
              actual.is_found_in_master_data !== exp.snapMat.isFoundInMasterData)) ||
          normMatDate !== snapMatDate
        ) {
          throw { code: '22023', message: `Inkonsistensi Layer 2 & Layer 4 (Material Snapshot) pada ${exp.id}` };
        }
      }

      // Database ownership check BEFORE mutation
      for (const w of payload.p_worksheets) {
        const existing = worksheets.get(w.id);
        if (existing && existing.schedule_id !== payload.p_schedule_id) {
          throw {
            code: '42501',
            message: `Konflik kepemilikan: Worksheet ID "${w.id}" sudah dimiliki oleh jadwal lain (${existing.schedule_id}).`,
          };
        }
      }
      for (const m of payload.p_material_snapshots) {
        const existing = materialSnapshots.get(m.id);
        if (existing && existing.schedule_id !== payload.p_schedule_id) {
          throw {
            code: '42501',
            message: `Konflik kepemilikan: Material Snapshot ID "${m.id}" sudah dimiliki oleh jadwal lain (${existing.schedule_id}).`,
          };
        }
      }

      // Phase 2: Upsert worksheets with ON CONFLICT ... WHERE schedule_id = p_schedule_id guard + ROW_COUNT check
      let upsertedWsRows = 0;
      for (const ws of payload.p_worksheets) {
        if (failStage === 'worksheet') {
          throw { code: '23514', message: 'Simulated CHECK/INSERT failure on production_schedule_worksheets' };
        }
        if (failStage === 'simulate_on_conflict_skip_ws') {
          // Simulates ON CONFLICT DO UPDATE ... WHERE schedule_id = p_schedule_id skipping update
          continue;
        }
        const existing = worksheets.get(ws.id);
        if (existing && existing.schedule_id !== payload.p_schedule_id) {
          continue;
        }
        worksheets.set(ws.id, { ...ws, schedule_id: payload.p_schedule_id });
        upsertedWsRows++;
      }
      if (upsertedWsRows !== payload.p_worksheets.length) {
        throw {
          code: '42501',
          message: `UPSERT Worksheet ditolak oleh ownership guard: diharapkan ${payload.p_worksheets.length} baris tersimpan, aktual ${upsertedWsRows}.`,
        };
      }

      // Phase 2b: Upsert material snapshots with ON CONFLICT ... WHERE schedule_id = p_schedule_id guard + ROW_COUNT check
      let upsertedMatRows = 0;
      for (const mat of payload.p_material_snapshots) {
        if (failStage === 'material_snapshot') {
          throw {
            code: '23502',
            message: 'Simulated NOT NULL/FK failure on production_schedule_material_snapshots',
          };
        }
        if (failStage === 'simulate_on_conflict_skip_mat') {
          continue;
        }
        const existing = materialSnapshots.get(mat.id);
        if (existing && existing.schedule_id !== payload.p_schedule_id) {
          continue;
        }
        materialSnapshots.set(mat.id, { ...mat, schedule_id: payload.p_schedule_id });
        upsertedMatRows++;
      }
      if (upsertedMatRows !== payload.p_material_snapshots.length) {
        throw {
          code: '42501',
          message: `UPSERT Material Snapshot ditolak oleh ownership guard: diharapkan ${payload.p_material_snapshots.length} baris tersimpan, aktual ${upsertedMatRows}.`,
        };
      }

      // Phase 3: Delete stale normalized rows only after replacement upserts succeed
      const newWsIds = new Set(payload.p_worksheets.map((w) => w.id));
      const newMatIds = new Set(payload.p_material_snapshots.map((m) => m.id));

      for (const [id, row] of Array.from(materialSnapshots.entries())) {
        if (row.schedule_id === payload.p_schedule_id && !newMatIds.has(id)) {
          materialSnapshots.delete(id);
        }
      }
      for (const [id, row] of Array.from(worksheets.entries())) {
        if (row.schedule_id === payload.p_schedule_id && !newWsIds.has(id)) {
          worksheets.delete(id);
        }
      }

      // Phase 4: Update notes and worksheets_snapshot consistently in same transaction
      if (failStage === 'schedule_update') {
        throw { code: '42501', message: 'Simulated RLS failure updating production_schedules' };
      }

      schedules.set(payload.p_schedule_id, {
        ...target,
        notes: payload.p_notes,
        worksheets_snapshot: JSON.parse(JSON.stringify(payload.p_worksheets_snapshot)),
      });

      return {
        data: {
          success: true,
          schedule_id: payload.p_schedule_id,
          worksheets_count: payload.p_worksheets.length,
          material_snapshots_count: payload.p_material_snapshots.length,
        },
        error: null,
      };
    } catch (err: any) {
      // Full transactional rollback
      restoreState(txBackup);
      return { data: null, error: err };
    }
  };

  const gateway: ScheduleRemoteGateway = {
    isConfigured: true,
    async createSchedule(schedule) {
      const dbRow = mapModelToDbSchedule(schedule);
      const canonicalId = schedule.id.trim().toLowerCase();
      schedules.set(canonicalId, {
        id: canonicalId,
        or_number: dbRow.or_number,
        style: dbRow.style,
        production_line: dbRow.production_line,
        production_date: dbRow.production_date,
        finish_date: dbRow.finish_date,
        target: dbRow.target,
        status: dbRow.status,
        notes: dbRow.notes,
        worksheets_snapshot: dbRow.worksheets_snapshot,
      });

      const syncRes = await executeAtomicSnapshotSync(canonicalId, schedule, {
        callSyncRpc: runSyncRpc,
      });
      if (!syncRes.success) {
        // Compensating rollback for failed create
        schedules.delete(canonicalId);
        return { success: false, error: syncRes.error };
      }
      return { success: true, id: canonicalId };
    },
    async updateSchedule(schedule) {
      const existing = schedules.get(schedule.id);
      if (!existing) return { success: false, error: '0 rows updated' };
      const dbRow = mapModelToDbSchedule(schedule);
      // Defer notes & worksheets_snapshot to atomic RPC
      schedules.set(schedule.id, {
        ...existing,
        or_number: dbRow.or_number,
        style: dbRow.style,
        production_line: dbRow.production_line,
        production_date: dbRow.production_date,
        finish_date: dbRow.finish_date,
        target: dbRow.target,
        status: dbRow.status,
      });

      const syncRes = await executeAtomicSnapshotSync(schedule.id, schedule, {
        callSyncRpc: runSyncRpc,
      });
      if (!syncRes.success) {
        return { success: false, error: syncRes.error };
      }
      return { success: true, id: schedule.id };
    },
    async deleteSchedule(id) {
      if (!schedules.has(id)) return { success: false, error: '0 rows deleted' };
      schedules.delete(id);
      for (const [mId, row] of Array.from(materialSnapshots.entries())) {
        if (row.schedule_id === id) materialSnapshots.delete(mId);
      }
      for (const [wId, row] of Array.from(worksheets.entries())) {
        if (row.schedule_id === id) worksheets.delete(wId);
      }
      return { success: true };
    },
  };

  return {
    getSchedules: () => schedules,
    getWorksheets: () => worksheets,
    getMaterialSnapshots: () => materialSnapshots,
    setFailStage: (stage: typeof failStage) => {
      failStage = stage;
    },
    runSyncRpc,
    gateway,
  };
}

function makeSampleWorksheets(): WorksheetPdfItem[] {
  return [
    {
      id: 'ws-pdf-1',
      fileName: 'WS_OR1117_JACKET.pdf',
      orNumber: '1117',
      style: 'JACKET A',
      target: 1200,
      uploadedAt: '2026-11-12T08:00:00.000Z',
      matchedUploadId: 'up-1117-latest',
      matchedUploadDate: '2026-11-12',
      matchedUploadTime: '07:45:00 WIB',
      matchedUploadCreatedAt: '2026-11-12T00:45:00.000Z',
      lastSyncedAt: '2026-11-12T08:00:00.000Z',
      materials: [
        {
          materialCode: 'MAT-Z01',
          materialName: 'Zipper Main #5',
          unit: 'Pcs',
          total: 1200,
          receivedQty: 1200,
          status: 'READY',
          isFoundInMasterData: true,
          matchedUploadId: 'up-1117-latest',
          matchedUploadDate: '2026-11-12',
          matchedAt: '2026-11-12T08:00:00.000Z',
        },
        {
          materialCode: 'MAT-DUP',
          materialName: 'Thread Poly Part A',
          unit: 'Cone',
          total: 50,
          receivedQty: 30,
          status: 'BELUM READY',
          isFoundInMasterData: true,
          matchedUploadId: 'up-1117-latest',
          matchedUploadDate: '2026-11-12',
          matchedAt: '2026-11-12T08:00:00.000Z',
        },
        {
          materialCode: 'MAT-DUP',
          materialName: 'Thread Poly Part B (Duplicate Code)',
          unit: 'Cone',
          total: 75,
          receivedQty: 30,
          status: 'BELUM READY',
          isFoundInMasterData: true,
          matchedUploadId: 'up-1117-latest',
          matchedUploadDate: '2026-11-12',
          matchedAt: '2026-11-12T08:00:00.000Z',
        },
        {
          materialCode: 'MAT-MISS',
          materialName: 'Label Care Unmatched',
          unit: 'Pcs',
          total: 1200,
          receivedQty: null,
          status: null,
          isFoundInMasterData: false,
          matchedUploadId: null,
          matchedUploadDate: null,
          matchedAt: '2026-11-12T08:00:00.000Z',
        },
      ],
    },
    {
      id: 'ws-pdf-2',
      fileName: 'WS_OR1118_PANTS.pdf',
      orNumber: '1118',
      style: 'CARGO PANTS B',
      target: 800,
      uploadedAt: '2026-11-12T08:01:00.000Z',
      matchedUploadId: 'up-1118-latest',
      matchedUploadDate: '2026-11-11',
      matchedUploadTime: '16:10:00 WIB',
      matchedUploadCreatedAt: '2026-11-11T09:10:00.000Z',
      lastSyncedAt: '2026-11-12T08:01:00.000Z',
      materials: [
        {
          materialCode: 'MAT-FAB-09',
          materialName: 'Ripstop Olive',
          unit: 'Yard',
          total: 1600,
          receivedQty: 1650,
          status: 'READY',
          isFoundInMasterData: true,
          matchedUploadId: 'up-1118-latest',
          matchedUploadDate: '2026-11-11',
          matchedAt: '2026-11-12T08:01:00.000Z',
        },
      ],
    },
  ];
}

test('1, 3, 4 & 9. Save schedule with multiple Worksheets, duplicate material codes, preserved order, and consistent 4 layers', async () => {
  const db = createTransactional4LayerDb();
  const worksheets = makeSampleWorksheets();

  const res = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-1117',
      style: 'MULTI STYLE',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-17',
      target: 2000,
      status: 'Terjadwal',
      notes: 'Catatan PPIC',
      worksheets,
    },
    db.gateway
  );

  assert.equal(res.success, true);
  assert.ok(res.schedule);
  const schId = res.schedule.id;

  // Verify 4 storage layers in DB
  const dbSch = db.getSchedules().get(schId)!;
  assert.ok(dbSch);
  assert.ok(dbSch.notes?.startsWith(WORKSHEET_PAYLOAD_PREFIX));
  assert.equal(Array.isArray(dbSch.worksheets_snapshot), true);
  assert.equal(dbSch.worksheets_snapshot.length, 2);

  // Layer 1 (notes) & Layer 2 (worksheets_snapshot) match identically
  const parsedFromNotes = mapDbScheduleToModel({ ...dbSch, worksheets_snapshot: null });
  const parsedFromSnapshot = mapDbScheduleToModel({ ...dbSch, notes: null });
  assert.deepEqual(parsedFromNotes.worksheets, parsedFromSnapshot.worksheets);
  assert.equal(parsedFromNotes.notes, 'Catatan PPIC');

  // Layer 3: production_schedule_worksheets
  const wsRows = Array.from(db.getWorksheets().values()).filter((w) => w.schedule_id === schId);
  assert.equal(wsRows.length, 2);
  assert.deepEqual(
    wsRows.map((w) => [w.or_number, w.target]),
    [
      ['1117', 1200],
      ['1118', 800],
    ]
  );

  // Layer 4: production_schedule_material_snapshots preserves duplicates and exact row_order
  const ws1Mats = Array.from(db.getMaterialSnapshots().values())
    .filter((m) => m.worksheet_id === `${schId}__ws-pdf-1`)
    .sort((a, b) => a.row_order - b.row_order);

  assert.equal(ws1Mats.length, 4);
  assert.deepEqual(
    ws1Mats.map((m) => [m.row_order, m.material_code, m.material_name, m.received_qty, m.status]),
    [
      [0, 'MAT-Z01', 'Zipper Main #5', 1200, 'READY'],
      [1, 'MAT-DUP', 'Thread Poly Part A', 30, 'BELUM READY'],
      [2, 'MAT-DUP', 'Thread Poly Part B (Duplicate Code)', 30, 'BELUM READY'],
      [3, 'MAT-MISS', 'Label Care Unmatched', null, null],
    ]
  );
  // Duplicate codes have distinct deterministic IDs
  assert.notEqual(ws1Mats[1].id, ws1Mats[2].id);
});

test('2 & 9. Save schedule WITHOUT PDF Worksheets uses empty array [] (never NULL) and preserves schedule metadata', async () => {
  const db = createTransactional4LayerDb();

  const res = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-NO-PDF',
      style: 'Basic Polo',
      productionLine: 'Line 2',
      productionDate: '2026-11-14',
      finishDate: '2026-11-16',
      target: 950,
      status: 'Terjadwal',
      notes: 'Jadwal manual tanpa PDF',
    },
    db.gateway
  );

  assert.equal(res.success, true);
  const schId = res.schedule!.id;
  const dbSch = db.getSchedules().get(schId)!;

  assert.equal(dbSch.target, 950);
  assert.equal(dbSch.notes, 'Jadwal manual tanpa PDF');
  // Must be empty array [], never null
  assert.deepEqual(dbSch.worksheets_snapshot, []);
  assert.notEqual(dbSch.worksheets_snapshot, null);

  assert.equal(db.getWorksheets().size, 0);
  assert.equal(db.getMaterialSnapshots().size, 0);

  // Round-trip mapper preserves undefined worksheets on frontend model while DB keeps []
  const roundTrip = mapDbScheduleToModel(dbSch);
  assert.equal(roundTrip.worksheets, undefined);
  assert.equal(roundTrip.notes, 'Jadwal manual tanpa PDF');

  // Direct payload builder check
  assert.deepEqual(buildScheduleWorksheetsSnapshotArray(roundTrip), []);
  assert.equal(buildScheduleNotesPayload(roundTrip), 'Jadwal manual tanpa PDF');
});

test('5. Replacing old snapshot with new snapshot (Edit / Manual Refresh / Removing PDFs) updates all 4 layers atomically', async () => {
  const db = createTransactional4LayerDb();
  const initialRes = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-1117',
      style: 'JACKET A',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-16',
      target: 2000,
      worksheets: makeSampleWorksheets(),
    },
    db.gateway
  );
  assert.equal(initialRes.success, true);
  const schId = initialRes.schedule!.id;
  assert.equal(db.getWorksheets().size, 2);
  assert.equal(db.getMaterialSnapshots().size, 5);

  // Replace with 1 worksheet and updated snapshot
  const replacementWs: WorksheetPdfItem[] = [
    {
      id: 'ws-pdf-3',
      fileName: 'WS_REPLACEMENT.pdf',
      orNumber: '1199',
      style: 'NEW HOODIE',
      target: 500,
      uploadedAt: '2026-11-12T10:00:00.000Z',
      materials: [
        {
          materialCode: 'MAT-NEW-1',
          materialName: 'Fleece Black',
          unit: 'Yard',
          total: 900,
          receivedQty: 900,
          status: 'READY',
          isFoundInMasterData: true,
        },
      ],
    },
  ];

  const replaced = await updateScheduleWithPersistence(
    initialRes.schedules,
    schId,
    { worksheets: replacementWs, target: 500 },
    db.gateway
  );
  assert.equal(replaced.success, true);

  const dbSchAfterReplace = db.getSchedules().get(schId)!;
  assert.equal(dbSchAfterReplace.worksheets_snapshot.length, 1);
  assert.equal(dbSchAfterReplace.worksheets_snapshot[0].id, 'ws-pdf-3');
  assert.ok(dbSchAfterReplace.notes?.includes('WS_REPLACEMENT.pdf'));
  assert.equal(db.getWorksheets().size, 1);
  assert.equal(db.getMaterialSnapshots().size, 1);
  assert.equal(Array.from(db.getWorksheets().values())[0].or_number, '1199');

  // Remove all PDFs from schedule -> clears normalized rows and sets worksheets_snapshot = []
  const cleared = await updateScheduleWithPersistence(
    replaced.schedules,
    schId,
    { worksheets: undefined, notes: 'Tanpa PDF sekarang' },
    db.gateway
  );
  assert.equal(cleared.success, true);
  const dbSchCleared = db.getSchedules().get(schId)!;
  assert.deepEqual(dbSchCleared.worksheets_snapshot, []);
  assert.equal(dbSchCleared.notes, 'Tanpa PDF sekarang');
  assert.equal(dbSchCleared.target, 500);
  assert.equal(db.getWorksheets().size, 0);
  assert.equal(db.getMaterialSnapshots().size, 0);
});

test('6, 7, 8 & 10. Failure at Worksheet or Material Snapshot phase rolls back transaction, preserves old snapshot, and never reports fake success', async () => {
  const db = createTransactional4LayerDb();
  const initialWorksheets = makeSampleWorksheets();

  const created = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-1117',
      style: 'JACKET A',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-16',
      target: 2000,
      notes: 'Snapshot awal stabil',
      worksheets: initialWorksheets,
    },
    db.gateway
  );
  assert.equal(created.success, true);
  const schId = created.schedule!.id;
  const baselineNotes = db.getSchedules().get(schId)!.notes;

  const newCandidateWorksheets: WorksheetPdfItem[] = [
    {
      id: 'ws-new-should-rollback',
      fileName: 'WS_BROKEN.pdf',
      orNumber: '9999',
      style: 'BROKEN STYLE',
      target: 300,
      materials: [
        {
          materialCode: 'MAT-ROLLBACK',
          materialName: 'Rollback Fabric',
          unit: 'Yard',
          total: 300,
          receivedQty: 100,
          status: 'BELUM READY',
          isFoundInMasterData: true,
        },
      ],
    },
  ];

  // Test 6: Simulate failure while saving Worksheet
  db.setFailStage('worksheet');
  const failWsRes = await updateScheduleWithPersistence(
    created.schedules,
    schId,
    { worksheets: newCandidateWorksheets },
    db.gateway
  );
  assert.equal(failWsRes.success, false);
  assert.match(failWsRes.error || '', /production_schedule_worksheets/i);
  // Local state untouched (no fake success)
  assert.equal(failWsRes.schedules[0].worksheets?.length, 2);
  assert.equal(failWsRes.schedules[0].worksheets?.[0].id, 'ws-pdf-1');
  // DB 4 layers completely intact
  assert.equal(db.getSchedules().get(schId)!.notes, baselineNotes);
  assert.equal(db.getSchedules().get(schId)!.worksheets_snapshot.length, 2);
  assert.equal(db.getWorksheets().size, 2);
  assert.equal(db.getMaterialSnapshots().size, 5);

  // Test 7 & 8: Simulate failure while saving Material Snapshot (after worksheets upserted)
  db.setFailStage('material_snapshot');
  const failMatRes = await updateScheduleWithPersistence(
    failWsRes.schedules,
    schId,
    { worksheets: newCandidateWorksheets },
    db.gateway
  );
  assert.equal(failMatRes.success, false);
  assert.match(failMatRes.error || '', /production_schedule_material_snapshots/i);
  // Local state untouched
  assert.equal(failMatRes.schedules[0].worksheets?.length, 2);
  // Old normalized worksheets and material snapshots MUST NOT have been wiped or polluted by ws-new-should-rollback
  assert.equal(db.getWorksheets().has(`${schId}__ws-new-should-rollback`), false);
  assert.equal(db.getWorksheets().size, 2);
  assert.equal(db.getMaterialSnapshots().size, 5);
  assert.equal(db.getSchedules().get(schId)!.notes, baselineNotes);
  assert.equal(db.getSchedules().get(schId)!.worksheets_snapshot.length, 2);

  // Test 10: Simulate missing RPC on Create -> rollback brand-new schedule + return readable error
  db.setFailStage('missing_rpc');
  const draftId = generateUuid();
  const failCreateRes = await createScheduleWithPersistence(
    failMatRes.schedules,
    {
      id: draftId,
      orNumber: 'OR-NEW-FAIL',
      style: 'FAIL CREATE',
      productionLine: 'Line 3',
      productionDate: '2026-11-18',
      finishDate: '2026-11-20',
      target: 400,
      worksheets: newCandidateWorksheets,
    },
    db.gateway
  );
  assert.equal(failCreateRes.success, false);
  assert.match(failCreateRes.error || '', /sync_production_schedule_snapshots/i);
  assert.equal(failCreateRes.schedules.length, 1);
  assert.equal(db.getSchedules().has(draftId), false);
});

test('Payload pre-validation rejects corrupt worksheet/material entries before calling RPC', () => {
  const validId = generateUuid();
  const invalidPayload = buildAtomicSnapshotSyncPayload(validId, {
    id: validId,
    orNumber: 'OR-100',
    style: 'Test',
    productionLine: 'Line 1',
    productionDate: '2026-11-12',
    finishDate: '2026-11-13',
    target: 100,
    worksheets: [
      {
        id: 'ws-bad',
        fileName: 'bad.pdf',
        orNumber: '100',
        style: 'Test',
        target: 100,
        materials: [
          {
            materialCode: '',
            materialName: 'Missing Code',
            unit: 'Pcs',
            total: 10,
          },
        ],
      },
    ],
  });

  assert.equal(invalidPayload.success, false);
  if (invalidPayload.success === false) {
    assert.match(invalidPayload.error, /tidak lengkap/i);
  }
});

test('F1, F2 & F12. Cross-schedule Worksheet ID and Material Snapshot ID takeover attempts are rejected and roll back cleanly', async () => {
  const db = createTransactional4LayerDb();

  const createA = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-OWNER-A',
      style: 'Style Owner A',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-15',
      target: 1000,
      worksheets: makeSampleWorksheets(),
    },
    db.gateway
  );
  assert.equal(createA.success, true);
  const schAId = createA.schedule!.id;

  const createB = await createScheduleWithPersistence(
    createA.schedules,
    {
      orNumber: 'OR-OWNER-B',
      style: 'Style Owner B',
      productionLine: 'Line 2',
      productionDate: '2026-11-16',
      finishDate: '2026-11-18',
      target: 500,
      worksheets: [
        {
          id: 'ws-b-own',
          fileName: 'WS_B.pdf',
          orNumber: '2001',
          style: 'Style B',
          target: 500,
          materials: [
            {
              materialCode: 'MAT-B-1',
              materialName: 'Button B',
              unit: 'Pcs',
              total: 500,
              receivedQty: 500,
              status: 'READY',
              isFoundInMasterData: true,
            },
          ],
        },
      ],
    },
    db.gateway
  );
  assert.equal(createB.success, true);
  const schBId = createB.schedule!.id;

  // Attempt 1: Schedule B tries to hijack Schedule A's worksheet ID (prefix belongs to Schedule A)
  const builtA = buildAtomicSnapshotSyncPayload(schAId, createA.schedule!);
  assert.equal(builtA.success, true);
  if (!builtA.success) return;

  const hijackWsRes = await db.runSyncRpc({
    ...builtA.payload,
    p_schedule_id: schBId,
    p_worksheets: builtA.payload.p_worksheets.map((w) => ({ ...w, schedule_id: schBId })),
    p_material_snapshots: builtA.payload.p_material_snapshots.map((m) => ({ ...m, schedule_id: schBId })),
  });
  assert.equal(hijackWsRes.error?.code, '42501');

  // Attempt 2: Pre-existing DB row owned by Schedule A with crafted matching ID on Schedule B
  const victimWsId = `${schBId}__ws-b-own`;
  const savedWorksheet = db.getWorksheets().get(victimWsId)!;
  db.getWorksheets().set(victimWsId, { ...savedWorksheet, schedule_id: schAId });
  const builtB = buildAtomicSnapshotSyncPayload(schBId, createB.schedule!);
  assert.equal(builtB.success, true);
  if (!builtB.success) return;

  const hijackDbWsRes = await db.runSyncRpc(builtB.payload);
  assert.equal(hijackDbWsRes.error?.code, '42501');
  assert.match(hijackDbWsRes.error?.message || '', /Konflik kepemilikan: Worksheet ID/i);
  // Restore Schedule B ownership on ws-b-own, then corrupt material snapshot ownership to Schedule A
  db.getWorksheets().set(victimWsId, savedWorksheet);

  const victimMatId = `${schBId}__ws-b-own__0`;
  const savedMat = db.getMaterialSnapshots().get(victimMatId)!;
  db.getMaterialSnapshots().set(victimMatId, { ...savedMat, schedule_id: schAId });
  const hijackDbMatRes = await db.runSyncRpc(builtB.payload);
  assert.equal(hijackDbMatRes.error?.code, '42501');
  assert.match(hijackDbMatRes.error?.message || '', /Konflik kepemilikan: Material Snapshot ID/i);
  db.getMaterialSnapshots().set(victimMatId, savedMat);

  // Schedule A & Schedule B snapshots remain intact
  assert.equal(db.getWorksheets().get(`${schAId}__ws-pdf-1`)?.schedule_id, schAId);
  assert.equal(db.getSchedules().get(schBId)?.worksheets_snapshot.length, 1);
});

test('F3 & F12. Duplicate Worksheet ID, Material Snapshot ID, and (worksheet_id, row_order) pairs are rejected', async () => {
  const db = createTransactional4LayerDb();
  const created = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-DUP',
      style: 'Dup Guard',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-15',
      target: 500,
      worksheets: makeSampleWorksheets(),
    },
    db.gateway
  );
  assert.equal(created.success, true);
  const schId = created.schedule!.id;
  const built = buildAtomicSnapshotSyncPayload(schId, created.schedule!);
  assert.equal(built.success, true);
  if (!built.success) return;

  // Duplicate worksheet ID in p_worksheets
  const dupWsPayload: AtomicSnapshotSyncPayload = {
    ...built.payload,
    p_worksheets_snapshot: [built.payload.p_worksheets_snapshot[0], built.payload.p_worksheets_snapshot[0]],
    p_notes: buildScheduleNotesPayload({
      ...created.schedule!,
      worksheets: [built.payload.p_worksheets_snapshot[0], built.payload.p_worksheets_snapshot[0]],
    }),
    p_worksheets: [built.payload.p_worksheets[0], built.payload.p_worksheets[0]],
  };
  const dupWsRes = await db.runSyncRpc(dupWsPayload);
  assert.equal(dupWsRes.error?.code, '23505');

  // Duplicate material snapshot ID in p_material_snapshots
  const dupMatPayload: AtomicSnapshotSyncPayload = {
    ...built.payload,
    p_material_snapshots: [built.payload.p_material_snapshots[0], built.payload.p_material_snapshots[0]],
  };
  const dupMatRes = await db.runSyncRpc(dupMatPayload);
  assert.equal(dupMatRes.error?.code, '23505');

  // Duplicate (worksheet_id, row_order) pair with tampered ID
  const dupPairPayload: AtomicSnapshotSyncPayload = {
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, idx) =>
      idx === 1 ? { ...m, id: `${m.worksheet_id}__0_dup`, row_order: 0 } : m
    ),
  };
  const dupPairRes = await db.runSyncRpc(dupPairPayload);
  assert.ok(dupPairRes.error);
});

test('F4 & F12. ON CONFLICT skip (0 affected rows) fails transaction and rolls back preserving old snapshot', async () => {
  const db = createTransactional4LayerDb();
  const created = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-GUARD',
      style: 'Guard Test',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-15',
      target: 1000,
      worksheets: makeSampleWorksheets(),
    },
    db.gateway
  );
  assert.equal(created.success, true);
  const schId = created.schedule!.id;
  const oldSnapshotLen = db.getSchedules().get(schId)!.worksheets_snapshot.length;

  db.setFailStage('simulate_on_conflict_skip_ws');
  const wsSkipRes = await updateScheduleWithPersistence(
    created.schedules,
    schId,
    {
      worksheets: [makeSampleWorksheets()[0]],
    },
    db.gateway
  );
  assert.equal(wsSkipRes.success, false);
  assert.match(wsSkipRes.error || '', /ownership guard/i);
  assert.equal(db.getSchedules().get(schId)!.worksheets_snapshot.length, oldSnapshotLen);

  db.setFailStage('simulate_on_conflict_skip_mat');
  const matSkipRes = await updateScheduleWithPersistence(
    created.schedules,
    schId,
    {
      worksheets: [makeSampleWorksheets()[0]],
    },
    db.gateway
  );
  assert.equal(matSkipRes.success, false);
  assert.match(matSkipRes.error || '', /ownership guard/i);
  assert.equal(db.getSchedules().get(schId)!.worksheets_snapshot.length, oldSnapshotLen);
  assert.equal(db.getWorksheets().size, 2);
  assert.equal(db.getMaterialSnapshots().size, 5);
});

test('F5, F6 & F12. Layer inconsistencies (notes vs worksheets_snapshot vs worksheets vs material_snapshots) are rejected and rolled back', async () => {
  const db = createTransactional4LayerDb();
  const created = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-LAYER',
      style: 'Layer Consistency',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-15',
      target: 1000,
      worksheets: makeSampleWorksheets(),
    },
    db.gateway
  );
  assert.equal(created.success, true);
  const schId = created.schedule!.id;
  const baselineNotes = db.getSchedules().get(schId)!.notes;
  const built = buildAtomicSnapshotSyncPayload(schId, created.schedule!);
  assert.equal(built.success, true);
  if (!built.success) return;

  // F5a: Layer 1 notes differs from Layer 2 worksheets_snapshot
  const tamperedSnap = JSON.parse(JSON.stringify(built.payload.p_worksheets_snapshot));
  tamperedSnap[0].target = 9999;
  const l1l2Mismatch = await db.runSyncRpc({
    ...built.payload,
    p_worksheets_snapshot: tamperedSnap,
  });
  assert.equal(l1l2Mismatch.error?.code, '22023');

  // F5b: Layer 2 worksheets_snapshot differs from Layer 3 p_worksheets (e.g. target or order)
  const l2l3Mismatch = await db.runSyncRpc({
    ...built.payload,
    p_worksheets: built.payload.p_worksheets.map((w, i) => (i === 0 ? { ...w, target: 7777 } : w)),
  });
  assert.equal(l2l3Mismatch.error?.code, '22023');
  assert.match(l2l3Mismatch.error?.message || '', /Layer 2 & Layer 3/i);

  // F6: Layer 2 worksheets_snapshot.materials differs from Layer 4 p_material_snapshots
  const l2l4Mismatch = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, received_qty: 1, status: 'BELUM READY' } : m
    ),
  });
  assert.equal(l2l4Mismatch.error?.code, '22023');
  assert.match(l2l4Mismatch.error?.message || '', /Layer 2 & Layer 4/i);

  // Old snapshot untouched
  assert.equal(db.getSchedules().get(schId)!.notes, baselineNotes);
});

test('F7, F8, F9, F10 & F11. Material validations (fractional row_order, negative received_qty, empty/invalid status) and no-PDF schedule', async () => {
  const db = createTransactional4LayerDb();
  const created = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-VAL',
      style: 'Validation Suite',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-15',
      target: 1000,
      worksheets: makeSampleWorksheets(),
    },
    db.gateway
  );
  assert.equal(created.success, true);
  const schId = created.schedule!.id;
  const built = buildAtomicSnapshotSyncPayload(schId, created.schedule!);
  assert.equal(built.success, true);
  if (!built.success) return;

  // F8: Fractional row_order rejected; integer accepted (already verified in F7/created above)
  const fracRes = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, row_order: 1.5 as any } : m
    ),
  });
  assert.equal(fracRes.error?.code, '22023');
  assert.match(fracRes.error?.message || '', /row_order/i);

  // F9: Negative received_qty rejected (both client pre-validation and RPC boundary)
  const badScheduleNegQty: ProductionSchedule = {
    ...created.schedule!,
    worksheets: [
      {
        ...makeSampleWorksheets()[0],
        materials: [
          {
            materialCode: 'MAT-NEG',
            materialName: 'Negative Test',
            unit: 'Pcs',
            total: 10,
            receivedQty: -5,
            status: 'BELUM READY',
            isFoundInMasterData: true,
          },
        ],
      },
    ],
  };
  const clientNeg = buildAtomicSnapshotSyncPayload(schId, badScheduleNegQty);
  assert.equal(clientNeg.success, false);
  const rpcNeg = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, received_qty: -1 } : m
    ),
  });
  assert.equal(rpcNeg.error?.code, '22023');

  // F10: Empty string status and invalid status rejected
  const clientEmptyStatus = buildAtomicSnapshotSyncPayload(schId, {
    ...created.schedule!,
    worksheets: [
      {
        ...makeSampleWorksheets()[0],
        materials: [
          {
            materialCode: 'MAT-EMP',
            materialName: 'Empty Status',
            unit: 'Pcs',
            total: 10,
            receivedQty: 10,
            status: '' as any,
            isFoundInMasterData: true,
          },
        ],
      },
    ],
  });
  assert.equal(clientEmptyStatus.success, false);

  const rpcEmptyStatus = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, status: '' as any } : m
    ),
  });
  assert.equal(rpcEmptyStatus.error?.code, '22023');

  const rpcInvalidStatus = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, status: 'PENDING' as any } : m
    ),
  });
  assert.equal(rpcInvalidStatus.error?.code, '22023');

  // F8b: Negative & overflow INTEGER row_order rejected
  const negOrderRes = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, row_order: -1 } : m
    ),
  });
  assert.equal(negOrderRes.error?.code, '22023');

  const overflowOrderRes = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, row_order: 2147483648 } : m
    ),
  });
  assert.equal(overflowOrderRes.error?.code, '22023');

  // F10b: is_found_in_master_data = TRUE with null received_qty/status rejected
  const inconsistentFound = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 3 ? { ...m, is_found_in_master_data: true } : m
    ),
  });
  assert.equal(inconsistentFound.error?.code, '22023');

  // Legacy compatibility: omitted isFoundInMasterData with populated receivedQty & status succeeds
  // and uppercase scheduleId normalizes to canonical lowercase UUID
  const legacyRes = await createScheduleWithPersistence(
    [],
    {
      id: generateUuid().toUpperCase(),
      orNumber: 'OR-LEGACY',
      style: 'Legacy Compatible',
      productionLine: 'Line 2',
      productionDate: '2026-11-14',
      finishDate: '2026-11-15',
      target: 100,
      worksheets: [
        {
          id: 'ws-legacy',
          fileName: 'WS_LEGACY.pdf',
          orNumber: '1117',
          style: 'Legacy Compatible',
          target: 100,
          materials: [
            {
              materialCode: 'MAT-LEG',
              materialName: 'Legacy Material',
              unit: 'Pcs',
              total: 100,
              receivedQty: 100,
              status: 'READY',
            },
          ],
        },
      ],
    },
    db.gateway
  );
  assert.equal(legacyRes.success, true);

  // F11: No-PDF schedule accepted cleanly with worksheets_snapshot: [] and leaves other schedules untouched
  const noPdfRes = await updateScheduleWithPersistence(
    created.schedules,
    schId,
    { worksheets: [], notes: 'Manual tanpa PDF' },
    db.gateway
  );
  assert.equal(noPdfRes.success, true);
  assert.deepEqual(db.getSchedules().get(schId)!.worksheets_snapshot, []);
  assert.equal(
    Array.from(db.getWorksheets().values()).filter((w) => w.schedule_id === schId).length,
    0
  );
  assert.equal(
    Array.from(db.getMaterialSnapshots().values()).filter((m) => m.schedule_id === schId).length,
    0
  );
  assert.equal(
    Array.from(db.getWorksheets().values()).filter((w) => w.schedule_id === legacyRes.schedule!.id).length,
    1
  );
});

test('Final Review Fix Stage 2B: Strict ISO date validation & 4-layer date consistency (Worksheet & Material Snapshot)', async () => {
  const db = createTransactional4LayerDb();
  const created = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-DATE-TEST',
      style: 'Date Suite',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-15',
      target: 1000,
      worksheets: makeSampleWorksheets(),
    },
    db.gateway
  );
  assert.equal(created.success, true);
  const schId = created.schedule!.id;
  const baselineNotes = db.getSchedules().get(schId)!.notes;

  const built = buildAtomicSnapshotSyncPayload(schId, created.schedule!);
  assert.equal(built.success, true);
  if (!built.success) return;

  // 1. Tanggal ISO valid (termasuk tahun kabisat 2024-02-29) diterima & konsisten
  const leapSnap = JSON.parse(JSON.stringify(built.payload.p_worksheets_snapshot)) as WorksheetPdfItem[];
  leapSnap[0].matchedUploadDate = '2024-02-29';
  leapSnap[0].materials[0].matchedUploadDate = '2024-02-29';
  const leapBuilt = buildAtomicSnapshotSyncPayload(schId, {
    ...created.schedule!,
    worksheets: leapSnap,
  });
  assert.equal(leapBuilt.success, true);
  if (!leapBuilt.success) return;
  const leapRpc = await db.runSyncRpc(leapBuilt.payload);
  assert.equal(leapRpc.error, null);
  assert.equal(db.getWorksheets().get(`${schId}__ws-pdf-1`)?.matched_upload_date, '2024-02-29');
  assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-pdf-1__0`)?.matched_upload_date, '2024-02-29');

  // 2. Tanggal NULL / string kosong pada field opsional diterima & tetap konsisten
  const nullDateSnap = JSON.parse(JSON.stringify(leapSnap)) as WorksheetPdfItem[];
  nullDateSnap[0].matchedUploadDate = null;
  nullDateSnap[0].materials[0].matchedUploadDate = '';
  const nullDateBuilt = buildAtomicSnapshotSyncPayload(schId, {
    ...created.schedule!,
    worksheets: nullDateSnap,
  });
  assert.equal(nullDateBuilt.success, true);
  if (!nullDateBuilt.success) return;
  assert.equal(nullDateBuilt.payload.p_worksheets[0].matched_upload_date, null);
  assert.equal(nullDateBuilt.payload.p_material_snapshots[0].matched_upload_date, null);
  assert.equal(nullDateBuilt.payload.p_worksheets_snapshot[0].materials[0].matchedUploadDate, null);
  const nullDateRpc = await db.runSyncRpc(nullDateBuilt.payload);
  assert.equal(nullDateRpc.error, null);

  // Restore baseline valid ISO date snapshot for negative assertions below
  const resetRpc = await db.runSyncRpc(built.payload);
  assert.equal(resetRpc.error, null);
  assert.equal(db.getSchedules().get(schId)!.notes, baselineNotes);

  // 3. Format tanggal tidak dikenal (mis. '13/11/2026', '2026/11/12', 'invalid-date')
  // a) Client normalizes valid DD/MM/YYYY consistently across all 4 layers, and rejects unrecognized strings
  const dmySchedule: ProductionSchedule = {
    ...created.schedule!,
    worksheets: leapSnap.map((ws, i) =>
      i === 0 ? { ...ws, matchedUploadDate: '13/11/2026' } : ws
    ),
  };
  const dmyBuilt = buildAtomicSnapshotSyncPayload(schId, dmySchedule);
  assert.equal(dmyBuilt.success, true);
  if (dmyBuilt.success) {
    assert.equal(dmyBuilt.payload.p_worksheets_snapshot[0].matchedUploadDate, '2026-11-13');
    assert.equal(dmyBuilt.payload.p_worksheets[0].matched_upload_date, '2026-11-13');
  }

  const badFormatClient = buildAtomicSnapshotSyncPayload(schId, {
    ...created.schedule!,
    worksheets: leapSnap.map((ws, i) =>
      i === 0 ? { ...ws, matchedUploadDate: '13-Nov-2026' } : ws
    ),
  });
  assert.equal(badFormatClient.success, false);

  // b) RPC boundary MUST reject non-ISO date format directly (worksheet & material) without mutating DB
  const badFmtWsSnap = JSON.parse(JSON.stringify(built.payload.p_worksheets_snapshot));
  badFmtWsSnap[0].matchedUploadDate = '13/11/2026';
  const badFmtWsRpc = await db.runSyncRpc({
    ...built.payload,
    p_notes: buildScheduleNotesPayload({ ...created.schedule!, worksheets: badFmtWsSnap }),
    p_worksheets_snapshot: badFmtWsSnap,
  });
  assert.equal(badFmtWsRpc.error?.code, '22023');

  const badFmtMatSnap = JSON.parse(JSON.stringify(built.payload.p_worksheets_snapshot));
  badFmtMatSnap[0].materials[0].matchedUploadDate = 'tanggal-ngawur';
  const badFmtMatRpc = await db.runSyncRpc({
    ...built.payload,
    p_notes: buildScheduleNotesPayload({ ...created.schedule!, worksheets: badFmtMatSnap }),
    p_worksheets_snapshot: badFmtMatSnap,
  });
  assert.equal(badFmtMatRpc.error?.code, '22023');

  // 4. Tanggal kalender tidak valid (mis. 2026-02-30, 2025-02-29, 2026-04-31) ditolak di client dan RPC
  for (const invalidCal of ['2026-02-30', '2025-02-29', '2026-04-31', '2026-13-01']) {
    const clientCalFail = buildAtomicSnapshotSyncPayload(schId, {
      ...created.schedule!,
      worksheets: leapSnap.map((ws, i) =>
        i === 0 ? { ...ws, matchedUploadDate: invalidCal } : ws
      ),
    });
    assert.equal(clientCalFail.success, false, `Client harus menolak tanggal kalender invalid ${invalidCal}`);

    const badCalWsSnap = JSON.parse(JSON.stringify(built.payload.p_worksheets_snapshot));
    badCalWsSnap[0].matchedUploadDate = invalidCal;
    const rpcCalWsFail = await db.runSyncRpc({
      ...built.payload,
      p_notes: buildScheduleNotesPayload({ ...created.schedule!, worksheets: badCalWsSnap }),
      p_worksheets_snapshot: badCalWsSnap,
      p_worksheets: built.payload.p_worksheets.map((w, i) =>
        i === 0 ? { ...w, matched_upload_date: invalidCal } : w
      ),
    });
    assert.equal(rpcCalWsFail.error?.code, '22023', `RPC worksheet harus menolak ${invalidCal}`);

    const badCalMatSnap = JSON.parse(JSON.stringify(built.payload.p_worksheets_snapshot));
    badCalMatSnap[0].materials[0].matchedUploadDate = invalidCal;
    const rpcCalMatFail = await db.runSyncRpc({
      ...built.payload,
      p_notes: buildScheduleNotesPayload({ ...created.schedule!, worksheets: badCalMatSnap }),
      p_worksheets_snapshot: badCalMatSnap,
      p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
        i === 0 ? { ...m, matched_upload_date: invalidCal } : m
      ),
    });
    assert.equal(rpcCalMatFail.error?.code, '22023', `RPC material harus menolak ${invalidCal}`);
  }

  // 5. Tanggal snapshot berbeda dari tanggal normalized (Worksheet & Material) ditolak sebelum mutasi
  const wsDateMismatchRpc = await db.runSyncRpc({
    ...built.payload,
    p_worksheets: built.payload.p_worksheets.map((w, i) =>
      i === 0 ? { ...w, matched_upload_date: '2026-11-20' } : w
    ),
  });
  assert.equal(wsDateMismatchRpc.error?.code, '22023');
  assert.match(wsDateMismatchRpc.error?.message || '', /Layer 2 & Layer 3/i);

  const matDateMismatchRpc = await db.runSyncRpc({
    ...built.payload,
    p_material_snapshots: built.payload.p_material_snapshots.map((m, i) =>
      i === 0 ? { ...m, matched_upload_date: '2026-11-20' } : m
    ),
  });
  assert.equal(matDateMismatchRpc.error?.code, '22023');
  assert.match(matDateMismatchRpc.error?.message || '', /Layer 2 & Layer 4/i);

  // 6. Tanggal snapshot sama dengan tanggal normalized diterima & database tetap konsisten
  const matchingDateSnap = JSON.parse(JSON.stringify(built.payload.p_worksheets_snapshot)) as WorksheetPdfItem[];
  matchingDateSnap[0].matchedUploadDate = '2026-11-15';
  matchingDateSnap[0].materials[0].matchedUploadDate = '2026-11-15';
  const matchingBuilt = buildAtomicSnapshotSyncPayload(schId, {
    ...created.schedule!,
    worksheets: matchingDateSnap,
  });
  assert.equal(matchingBuilt.success, true);
  if (!matchingBuilt.success) return;
  const matchingRpc = await db.runSyncRpc(matchingBuilt.payload);
  assert.equal(matchingRpc.error, null);
  assert.equal(db.getWorksheets().get(`${schId}__ws-pdf-1`)?.matched_upload_date, '2026-11-15');
  assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-pdf-1__0`)?.matched_upload_date, '2026-11-15');
});

test('Stage 2B Final Fix: Strict JSON type validation & consistency on worksheets_snapshot.materials and p_material_snapshots', async () => {
  const db = createTransactional4LayerDb();
  const created = await createScheduleWithPersistence(
    [],
    {
      orNumber: 'OR-JSON-TYPE',
      style: 'JSON Type Suite',
      productionLine: 'Line 1',
      productionDate: '2026-11-13',
      finishDate: '2026-11-15',
      target: 100,
      worksheets: [
        {
          id: 'ws-type-1',
          fileName: 'WS_TYPE.pdf',
          orNumber: '5001',
          style: 'JSON Type Suite',
          target: 100,
          uploadedAt: '2026-11-13T08:00:00.000Z',
          lastSyncedAt: '2026-11-13T08:00:00.000Z',
          materials: [
            {
              materialCode: 'MAT-1',
              materialName: 'Zipper',
              unit: 'Pcs',
              total: 100,
              receivedQty: 10,
              status: 'READY',
              isFoundInMasterData: true,
              matchedAt: '2026-11-13T08:00:00.000Z',
            },
          ],
        },
      ],
    },
    db.gateway
  );
  assert.equal(created.success, true);
  const schId = created.schedule!.id;

  const makeSingleMatSchedule = (matPatch: Record<string, any>): ProductionSchedule => ({
    ...created.schedule!,
    worksheets: [
      {
        ...created.schedule!.worksheets![0],
        materials: [
          {
            materialCode: 'MAT-1',
            materialName: 'Zipper',
            unit: 'Pcs',
            total: 100,
            matchedAt: '2026-11-13T08:00:00.000Z',
            ...(matPatch as any),
          },
        ],
      },
    ],
  });

  // 1, 5 & 9: receivedQty: 10, status: "READY", isFoundInMasterData: true diterima
  const validReady = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: 10, status: 'READY', isFoundInMasterData: true })
  );
  assert.equal(validReady.success, true);
  if (validReady.success) {
    const rpcRes = await db.runSyncRpc(validReady.payload);
    assert.equal(rpcRes.error, null);
    assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.received_qty, 10);
    assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.status, 'READY');
    assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.is_found_in_master_data, true);
  }

  // 6: status: "BELUM READY" diterima
  const validBelumReady = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: 10, status: 'BELUM READY', isFoundInMasterData: true })
  );
  assert.equal(validBelumReady.success, true);
  if (validBelumReady.success) {
    const rpcRes = await db.runSyncRpc(validBelumReady.payload);
    assert.equal(rpcRes.error, null);
    assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.status, 'BELUM READY');
  }

  // 2 & 10: receivedQty: null, status: null, isFoundInMasterData: false diterima
  const validNotFound = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: null, status: null, isFoundInMasterData: false })
  );
  assert.equal(validNotFound.success, true);
  if (validNotFound.success) {
    const rpcRes = await db.runSyncRpc(validNotFound.payload);
    assert.equal(rpcRes.error, null);
    assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.received_qty, null);
    assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.status, null);
    assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.is_found_in_master_data, false);
  }

  // Restore baseline valid state before negative tests
  if (validReady.success) {
    const resetRes = await db.runSyncRpc(validReady.payload);
    assert.equal(resetRes.error, null);
  }
  const activeBaselineNotes = db.getSchedules().get(schId)!.notes;
  const activeBaselineWs = db.getWorksheets().get(`${schId}__ws-type-1`)!;
  const activeBaselineMat = db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)!;

  // 3: receivedQty: "10" ditolak (tanpa konversi otomatis) di client & di kedua lapisan RPC
  const strQtyClient = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: '10', status: 'READY', isFoundInMasterData: true })
  );
  assert.equal(strQtyClient.success, false);

  // 4: receivedQty: true ditolak di client & di kedua lapisan RPC
  const boolQtyClient = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: true, status: 'READY', isFoundInMasterData: true })
  );
  assert.equal(boolQtyClient.success, false);

  // 7: status: "" ditolak
  const emptyStatusClient = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: 10, status: '', isFoundInMasterData: true })
  );
  assert.equal(emptyStatusClient.success, false);

  // 8: status: 1 ditolak
  const numStatusClient = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: 10, status: 1, isFoundInMasterData: true })
  );
  assert.equal(numStatusClient.success, false);

  // 11: isFoundInMasterData: "true" ditolak (tanpa konversi otomatis)
  const strFoundClient = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: 10, status: 'READY', isFoundInMasterData: 'true' })
  );
  assert.equal(strFoundClient.success, false);

  // 12: Material ditemukan (isFoundInMasterData: true) tetapi receivedQty: null ditolak
  const foundNullQtyClient = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: null, status: null, isFoundInMasterData: true })
  );
  assert.equal(foundNullQtyClient.success, false);

  // 13: Material tidak ditemukan (isFoundInMasterData: false) tetapi receivedQty atau status terisi ditolak
  const notFoundWithQtyClient = buildAtomicSnapshotSyncPayload(
    schId,
    makeSingleMatSchedule({ receivedQty: 10, status: 'READY', isFoundInMasterData: false })
  );
  assert.equal(notFoundWithQtyClient.success, false);

  // Direct RPC boundary rejections on worksheets_snapshot.materials AND p_material_snapshots
  assert.equal(validReady.success, true);
  if (!validReady.success) return;
  const basePayload = validReady.payload;

  const mutateSnapshotMaterial = (patch: Record<string, any>) => {
    const snap = JSON.parse(JSON.stringify(basePayload.p_worksheets_snapshot));
    Object.assign(snap[0].materials[0], patch);
    return {
      ...basePayload,
      p_notes: buildScheduleNotesPayload({ ...created.schedule!, worksheets: snap }),
      p_worksheets_snapshot: snap,
    };
  };

  const invalidSnapshotCases: Array<{ label: string; patch: Record<string, any> }> = [
    { label: 'snapshot receivedQty: "10"', patch: { receivedQty: '10' } },
    { label: 'snapshot receivedQty: true', patch: { receivedQty: true } },
    { label: 'snapshot receivedQty: []', patch: { receivedQty: [] } },
    { label: 'snapshot status: ""', patch: { status: '' } },
    { label: 'snapshot status: 1', patch: { status: 1 } },
    { label: 'snapshot isFoundInMasterData: "true"', patch: { isFoundInMasterData: 'true' } },
    { label: 'snapshot isFoundInMasterData: 1', patch: { isFoundInMasterData: 1 } },
    { label: 'snapshot found=true with receivedQty=null', patch: { isFoundInMasterData: true, receivedQty: null, status: null } },
    { label: 'snapshot found=false with receivedQty=10', patch: { isFoundInMasterData: false, receivedQty: 10, status: 'READY' } },
    { label: 'snapshot found=false with status=READY only', patch: { isFoundInMasterData: false, receivedQty: null, status: 'READY' } },
  ];

  for (const tc of invalidSnapshotCases) {
    const res = await db.runSyncRpc(mutateSnapshotMaterial(tc.patch));
    assert.equal(res.error?.code, '22023', `RPC harus menolak ${tc.label}`);
  }

  // Symmetric RPC rejections on p_material_snapshots directly
  const invalidNormalizedCases: Array<{ label: string; patch: Record<string, any> }> = [
    { label: 'normalized received_qty: "10"', patch: { received_qty: '10' } },
    { label: 'normalized received_qty: true', patch: { received_qty: true } },
    { label: 'normalized status: ""', patch: { status: '' } },
    { label: 'normalized status: 1', patch: { status: 1 } },
    { label: 'normalized is_found_in_master_data: "true"', patch: { is_found_in_master_data: 'true' } },
    { label: 'normalized is_found_in_master_data=true with received_qty=null', patch: { is_found_in_master_data: true, received_qty: null, status: null } },
    { label: 'normalized is_found_in_master_data=false with received_qty=10', patch: { is_found_in_master_data: false, received_qty: 10, status: 'READY' } },
  ];

  for (const tc of invalidNormalizedCases) {
    const res = await db.runSyncRpc({
      ...basePayload,
      p_material_snapshots: [{ ...basePayload.p_material_snapshots[0], ...tc.patch } as any],
    });
    assert.equal(res.error?.code, '22023', `RPC harus menolak ${tc.label}`);
  }

  // 14: Payload JSON snapshot dan normalized snapshot berbeda tipe atau nilai ditolak
  const typeMismatchQty = await db.runSyncRpc({
    ...basePayload,
    p_material_snapshots: [{ ...basePayload.p_material_snapshots[0], received_qty: '10' as any }],
  });
  assert.equal(typeMismatchQty.error?.code, '22023');

  const valueMismatchQty = await db.runSyncRpc({
    ...basePayload,
    p_material_snapshots: [{ ...basePayload.p_material_snapshots[0], received_qty: 20 }],
  });
  assert.equal(valueMismatchQty.error?.code, '22023');
  assert.match(valueMismatchQty.error?.message || '', /Layer 2 & Layer 4/i);

  const valueMismatchStatus = await db.runSyncRpc({
    ...basePayload,
    p_material_snapshots: [{ ...basePayload.p_material_snapshots[0], status: 'BELUM READY' }],
  });
  assert.equal(valueMismatchStatus.error?.code, '22023');
  assert.match(valueMismatchStatus.error?.message || '', /Layer 2 & Layer 4/i);

  const typeMismatchFound = await db.runSyncRpc({
    ...basePayload,
    p_material_snapshots: [{ ...basePayload.p_material_snapshots[0], is_found_in_master_data: null as any }],
  });
  assert.equal(typeMismatchFound.error?.code, '22023');
  assert.match(typeMismatchFound.error?.message || '', /Layer 2 & Layer 4/i);

  // Verify DB state remained completely intact after all rejected payloads
  assert.equal(db.getSchedules().get(schId)!.notes, activeBaselineNotes);
  assert.equal(db.getWorksheets().get(`${schId}__ws-type-1`)?.or_number, activeBaselineWs.or_number);
  assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.received_qty, activeBaselineMat.received_qty);
  assert.equal(db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.status, activeBaselineMat.status);
  assert.equal(
    db.getMaterialSnapshots().get(`${schId}__ws-type-1__0`)?.is_found_in_master_data,
    activeBaselineMat.is_found_in_master_data
  );
});

test('SQL migration file contains required SECURITY INVOKER, ownership guards, strict JSON type & ISO date checks, and post-UPSERT checks', () => {
  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20261113_atomic_snapshot_sync_rpc.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /SUBSTRING\(p_notes FROM 20\)::JSONB/);
  assert.match(sql, /WITH ORDINALITY/);
  assert.doesNotMatch(sql, /schedule_id\s*=\s*EXCLUDED\.schedule_id/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /ELSE NULL/);
  assert.doesNotMatch(sql, /DD\/MM\/YYYY/);
  assert.match(sql, /jsonb_typeof\(v_mat->'receivedQty'\)\s*<>\s*'number'/);
  assert.match(sql, /jsonb_typeof\(v_mat->'status'\)\s*<>\s*'string'/);
  assert.match(sql, /jsonb_typeof\(v_mat->'isFoundInMasterData'\)\s*<>\s*'boolean'/);
  assert.match(sql, /v_mat_is_found IS FALSE AND \(v_mat_received_qty IS NOT NULL OR v_mat_status IS NOT NULL\)/);
  assert.match(sql, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
  assert.match(sql, /TO_CHAR\(v_test_date, 'YYYY-MM-DD'\) IS DISTINCT FROM v_raw_date/);
  assert.match(sql, /WHERE public\.production_schedule_worksheets\.schedule_id = p_schedule_id;/);
  assert.match(sql, /WHERE public\.production_schedule_material_snapshots\.schedule_id = p_schedule_id;/);
  assert.match(sql, /GET DIAGNOSTICS v_affected_rows = ROW_COUNT;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.sync_production_schedule_snapshots\(UUID, TEXT, JSONB, JSONB, JSONB\) TO anon;/);
});
