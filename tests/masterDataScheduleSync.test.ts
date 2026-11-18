import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MaterialItemRequirement,
  ProductionSchedule,
  UploadHistoryItem,
} from '../src/types/ppic';
import {
  applySyncedSchedulesToList,
  buildScheduleMaterialSyncUpdate,
  doesScheduleMatchOr,
  syncSchedulesForMasterDataOr,
  upsertPendingScheduleSyncRecord,
} from '../src/utils/masterDataScheduleSync';
import { buildAtomicSnapshotSyncPayload } from '../src/utils/scheduleSnapshotSync';
import { areOrNumbersMatching } from '../src/utils/pdfWorksheetParser';

function makeSchedule(params: {
  id: string;
  orNumber: string;
  wsOrNumber?: string;
  worksheetNo: string;
  style: string;
  line: string;
  start: string;
  finish: string;
  target: number;
  materials?: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    total: number;
    receivedQty: number | null;
    status: 'READY' | 'BELUM READY' | null;
    isFoundInMasterData?: boolean;
  }>;
}): ProductionSchedule {
  return {
    id: params.id,
    orNumber: params.orNumber,
    style: params.style,
    productionLine: params.line,
    productionDate: params.start,
    finishDate: params.finish,
    target: params.target,
    status: 'Terjadwal',
    notes: 'Catatan jadwal asli',
    worksheets: params.materials
      ? [
          {
            id: `ws-${params.id}`,
            fileName: `${params.worksheetNo}.xls`,
            orNumber: params.wsOrNumber ?? params.orNumber,
            rawOrNumber: `PO/${params.wsOrNumber ?? params.orNumber}`,
            worksheetNo: params.worksheetNo,
            style: params.style,
            target: params.target,
            uploadedAt: '2026-11-10T08:00:00.000Z',
            matchedUploadId: 'old-upload-id',
            matchedUploadDate: '2026-11-10',
            matchedUploadTime: '08:00:00 WIB',
            lastSyncedAt: '2026-11-10T08:00:00.000Z',
            materials: params.materials.map((m) => ({
              id: m.id,
              materialCode: m.code,
              materialName: m.name,
              unit: m.unit,
              total: m.total,
              receivedQty: m.receivedQty,
              status: m.status,
              isFoundInMasterData: m.isFoundInMasterData ?? (m.receivedQty !== null),
              matchedUploadId: 'old-upload-id',
              matchedUploadDate: '2026-11-10',
            })),
          },
        ]
      : undefined,
  };
}

test('1. Matching No. OR mendukung variasi format tersimpan tanpa false positive', () => {
  assert.equal(areOrNumbersMatching('1036', '1036'), true);
  assert.equal(areOrNumbersMatching('1036', 'OR. 1036'), true);
  assert.equal(areOrNumbersMatching('1036', 'NO. OR 1036'), true);
  assert.equal(areOrNumbersMatching('1036', 'OR-1036'), true);
  assert.equal(areOrNumbersMatching('1036', 'OR/2026/09/1036'), true);
  assert.equal(areOrNumbersMatching('1036', '01036'), true);
  assert.equal(areOrNumbersMatching('1036', '1097'), false);
  assert.equal(areOrNumbersMatching('1036', '11036'), false);
});

test('2. Upload ulang Master Data OR 1036 otomatis memperbarui SELURUH 5 jadwal OR 1036 tanpa menyentuh OR lain & tanpa merusak field jadwal', async () => {
  const schedules: ProductionSchedule[] = [
    makeSchedule({
      id: '11111111-1111-4111-8111-111111111101',
      orNumber: '1036',
      worksheetNo: 'WH/MO/00101',
      style: 'STYLE-A',
      line: 'Line 1',
      start: '2026-12-01',
      finish: '2026-12-05',
      target: 500,
      materials: [
        { id: 'r1', code: 'UNI-ACC9026', name: 'BUTTON SNAP', unit: 'Pcs', total: 500, receivedQty: 100, status: 'BELUM READY' },
        { id: 'r2', code: 'UNI-ACC9026', name: 'BUTTON SNAP', unit: 'Pcs', total: 1000, receivedQty: 200, status: 'BELUM READY' },
        { id: 'r3', code: 'FAB-001', name: 'KAIN TASLAN', unit: 'yard', total: 29.5, receivedQty: 10, status: 'BELUM READY' },
        { id: 'r4', code: 'MISSING-01', name: 'BENANG KHUSUS', unit: 'CNS', total: 5, receivedQty: 5, status: 'READY' },
      ],
    }),
    makeSchedule({
      id: '11111111-1111-4111-8111-111111111102',
      orNumber: 'OR. 1036',
      worksheetNo: 'WH/MO/00102',
      style: 'STYLE-B',
      line: 'Line 1',
      start: '2026-12-02',
      finish: '2026-12-06',
      target: 300,
      materials: [
        { id: 'r21', code: 'FAB-001', name: 'KAIN TASLAN', unit: 'yard', total: 20, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '11111111-1111-4111-8111-111111111103',
      orNumber: 'NO. OR 1036',
      worksheetNo: 'WH/MO/00103',
      style: 'STYLE-C',
      line: 'Line 3',
      start: '2026-12-03',
      finish: '2026-12-08',
      target: 250,
      materials: [
        { id: 'r31', code: 'UNI-ACC9026', name: 'BUTTON SNAP', unit: 'Pcs', total: 500, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '11111111-1111-4111-8111-111111111104',
      orNumber: 'OR-1036',
      worksheetNo: 'WH/MO/00104',
      style: 'STYLE-D',
      line: 'Line 4',
      start: '2026-12-04',
      finish: '2026-12-09',
      target: 400,
      materials: [
        { id: 'r41', code: 'FAB-001', name: 'KAIN TASLAN', unit: 'yard', total: 29.5, receivedQty: 15, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '11111111-1111-4111-8111-111111111105',
      orNumber: 'OR/2026/09/1036',
      worksheetNo: 'WH/MO/00105',
      style: 'STYLE-E',
      line: 'Line 5',
      start: '2026-12-05',
      finish: '2026-12-10',
      target: 600,
      materials: [
        { id: 'r51', code: 'FAB-001', name: 'KAIN TASLAN', unit: 'yard', total: 50, receivedQty: 10, status: 'BELUM READY' },
      ],
    }),
    // Jadwal OR berbeda (OR 1097) -> TIDAK BOLEH BERUBAH
    makeSchedule({
      id: '11111111-1111-4111-8111-111111111199',
      orNumber: '1097',
      worksheetNo: 'WH/MO/00999',
      style: 'STYLE-OTHER',
      line: 'Line 7',
      start: '2026-12-01',
      finish: '2026-12-10',
      target: 999,
      materials: [
        { id: 'r99', code: 'FAB-001', name: 'KAIN TASLAN', unit: 'yard', total: 100, receivedQty: 10, status: 'BELUM READY' },
      ],
    }),
    // Jadwal manual tanpa worksheet -> TIDAK DISINKRONKAN
    {
      id: '11111111-1111-4111-8111-111111111188',
      orNumber: '1036',
      style: 'MANUAL',
      productionLine: 'Line 1',
      productionDate: '2026-12-11',
      finishDate: '2026-12-12',
      target: 100,
      status: 'Terjadwal',
    },
  ];

  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'upload-1036-old',
      orNumber: '1036',
      style: 'STYLE-A',
      fileName: 'old.xlsx',
      updateDate: '2026-11-10',
      uploadTime: '08:00:00 WIB',
      rowCount: 3,
      status: 'Sukses',
      createdAt: '2026-11-10T01:00:00.000Z',
    },
    {
      id: 'upload-1036-new',
      orNumber: '1036',
      style: 'STYLE-A',
      fileName: 'new.xlsx',
      updateDate: '2026-11-18',
      uploadTime: '09:15:00 WIB',
      rowCount: 3,
      status: 'Sukses',
      createdAt: '2026-11-18T02:15:00.000Z',
    },
  ];

  const masterRequirements: MaterialItemRequirement[] = [
    // Upload lama -> harus diabaikan
    {
      id: 'req-old-1',
      uploadId: 'upload-1036-old',
      orNumber: '1036',
      style: 'STYLE-A',
      materialCode: 'FAB-001',
      materialName: 'KAIN TASLAN',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 29.5,
      receivedQty: 1,
      unitPrice: 1000,
      updateDate: '2026-11-10',
    },
    // Upload terbaru OR 1036 (dengan kode duplikat UNI-ACC9026 berbeda status)
    {
      id: 'req-new-1',
      uploadId: 'upload-1036-new',
      orNumber: '1036',
      style: 'STYLE-A',
      materialCode: 'UNI-ACC9026',
      materialName: 'BUTTON SNAP',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 500,
      receivedQty: 500,
      unitPrice: 1000,
      updateDate: '2026-11-18',
    },
    {
      id: 'req-new-2',
      uploadId: 'upload-1036-new',
      orNumber: '1036',
      style: 'STYLE-A',
      materialCode: 'UNI-ACC9026',
      materialName: 'BUTTON SNAP',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 1000,
      receivedQty: 750,
      unitPrice: 1000,
      updateDate: '2026-11-18',
    },
    {
      id: 'req-new-3',
      uploadId: 'upload-1036-new',
      orNumber: '1036',
      style: 'STYLE-A',
      materialCode: 'FAB-001',
      materialName: 'KAIN TASLAN',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 29.5,
      receivedQty: 29.5,
      unitPrice: 1000,
      updateDate: '2026-11-18',
    },
  ];

  const persistedPayloads: Array<{ id: string; validAtomic: boolean }> = [];

  const summary = await syncSchedulesForMasterDataOr({
    targetOr: '1036',
    uploadId: 'upload-1036-new',
    updateDate: '2026-11-18',
    schedules,
    masterRequirements,
    uploadHistory,
    persistScheduleSnapshot: async (updatedSchedule) => {
      const built = buildAtomicSnapshotSyncPayload(updatedSchedule.id, updatedSchedule);
      assert.equal(built.success, true, `Payload RPC jadwal ${updatedSchedule.id} wajib valid`);
      persistedPayloads.push({ id: updatedSchedule.id, validAtomic: built.success });
      return { success: true };
    },
    syncTimestampIso: '2026-11-18T02:20:00.000Z',
  });

  assert.equal(summary.status, 'success');
  assert.equal(summary.matchedScheduleCount, 5);
  assert.equal(summary.syncedScheduleIds.length, 5);
  assert.equal(summary.failedSchedules.length, 0);
  assert.equal(persistedPayloads.length, 5);

  const nextList = applySyncedSchedulesToList(schedules, summary.updatedSchedulesById);
  // Pastikan tidak ada duplikasi jadwal
  assert.equal(nextList.length, schedules.length);

  // Verifikasi Jadwal #1: metadata utuh, duplikat terpisah, missing material -> null ('-')
  const s1 = nextList[0];
  assert.equal(s1.orNumber, '1036');
  assert.equal(s1.style, 'STYLE-A');
  assert.equal(s1.productionLine, 'Line 1');
  assert.equal(s1.productionDate, '2026-12-01');
  assert.equal(s1.finishDate, '2026-12-05');
  assert.equal(s1.target, 500);
  assert.equal(s1.notes, 'Catatan jadwal asli');
  assert.equal(s1.worksheets?.[0].worksheetNo, 'WH/MO/00101');
  assert.equal(s1.worksheets?.[0].matchedUploadId, 'upload-1036-new');
  assert.equal(s1.worksheets?.[0].matchedUploadDate, '2026-11-18');

  const mats1 = s1.worksheets![0].materials;
  assert.equal(mats1.length, 4);
  // Baris duplikat #1 (500 vs diterima 500) -> READY
  assert.equal(mats1[0].materialCode, 'UNI-ACC9026');
  assert.equal(mats1[0].total, 500);
  assert.equal(mats1[0].receivedQty, 500);
  assert.equal(mats1[0].status, 'READY');
  // Baris duplikat #2 (1000 vs diterima 750) -> BELUM READY (tidak ikut jadi READY!)
  assert.equal(mats1[1].materialCode, 'UNI-ACC9026');
  assert.equal(mats1[1].total, 1000);
  assert.equal(mats1[1].receivedQty, 750);
  assert.equal(mats1[1].status, 'BELUM READY');
  // Desimal 29.5 vs 29.5 -> READY
  assert.equal(mats1[2].total, 29.5);
  assert.equal(mats1[2].receivedQty, 29.5);
  assert.equal(mats1[2].status, 'READY');
  // Tidak ada di Master Data terbaru -> null ('-')
  assert.equal(mats1[3].receivedQty, null);
  assert.equal(mats1[3].status, null);
  assert.equal(mats1[3].isFoundInMasterData, false);

  // Verifikasi Jadwal #2..#5 semua ikut terupdate ke upload terbaru
  for (let i = 1; i <= 4; i++) {
    assert.equal(nextList[i].worksheets?.[0].matchedUploadId, 'upload-1036-new');
  }
  assert.equal(nextList[4].worksheets?.[0].materials[0].receivedQty, 29.5);
  assert.equal(nextList[4].worksheets?.[0].materials[0].status, 'READY'); // 29.5 diterima >= 29.5 req di Master Data candidate -> READY sesuai rule existing

  // Verifikasi Jadwal OR berbeda (OR 1097) TIDAK ikut berubah sama sekali
  const sOther = nextList[5];
  assert.equal(sOther.orNumber, '1097');
  assert.equal(sOther.worksheets?.[0].matchedUploadId, 'old-upload-id');
  assert.equal(sOther.worksheets?.[0].materials[0].receivedQty, 10);
  assert.equal(sOther.worksheets?.[0].materials[0].status, 'BELUM READY');

  // Jadwal manual tanpa worksheet tetap utuh
  assert.equal(nextList[6].worksheets, undefined);
});

test('3. Kegagalan parsial RPC menandai partial_failure & mendukung Retry tanpa upload ulang dan tanpa duplikasi', async () => {
  const schedules: ProductionSchedule[] = [1, 2, 3, 4, 5].map((n) =>
    makeSchedule({
      id: `22222222-2222-4222-8222-22222222220${n}`,
      orNumber: '1036',
      worksheetNo: `WH/MO/0020${n}`,
      style: `STYLE-${n}`,
      line: 'Line 1',
      start: `2026-12-0${n}`,
      finish: `2026-12-1${n}`,
      target: 100 * n,
      materials: [
        {
          id: `mat-${n}`,
          code: 'FAB-001',
          name: 'KAIN TASLAN',
          unit: 'yard',
          total: 29.5,
          receivedQty: 0,
          status: 'BELUM READY',
        },
      ],
    })
  );

  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'upload-1036-v2',
      orNumber: '1036',
      style: 'STYLE-1',
      fileName: 'master_1036.xlsx',
      updateDate: '2026-11-18',
      uploadTime: '10:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-18T03:00:00.000Z',
    },
  ];

  const masterRequirements: MaterialItemRequirement[] = [
    {
      id: 'req-v2-1',
      uploadId: 'upload-1036-v2',
      orNumber: '1036',
      style: 'STYLE-1',
      materialCode: 'FAB-001',
      materialName: 'KAIN TASLAN',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 29.5,
      receivedQty: 30,
      unitPrice: 1000,
      updateDate: '2026-11-18',
    },
  ];

  const failingId = '22222222-2222-4222-8222-222222222203';

  // Langkah A: Jadwal #3 mengalami gangguan koneksi RPC sementara
  const firstRun = await syncSchedulesForMasterDataOr({
    targetOr: '1036',
    uploadId: 'upload-1036-v2',
    updateDate: '2026-11-18',
    schedules,
    masterRequirements,
    uploadHistory,
    persistScheduleSnapshot: async (sch) => {
      if (sch.id === failingId) {
        return { success: false, error: 'Timeout koneksi RPC Supabase' };
      }
      return { success: true };
    },
    syncTimestampIso: '2026-11-18T03:01:00.000Z',
  });

  // Tidak boleh mengklaim semua berhasil
  assert.equal(firstRun.status, 'partial_failure');
  assert.equal(firstRun.syncedScheduleIds.length, 4);
  assert.equal(firstRun.failedSchedules.length, 1);
  assert.equal(firstRun.failedSchedules[0].scheduleId, failingId);

  let afterFirst = applySyncedSchedulesToList(schedules, firstRun.updatedSchedulesById);
  // Jadwal #3 belum di-commit ke state lokal, sementara 1,2,4,5 sudah terupdate
  assert.equal(afterFirst[2].worksheets?.[0].matchedUploadId, 'old-upload-id');
  assert.equal(afterFirst[0].worksheets?.[0].matchedUploadId, 'upload-1036-v2');

  let pendingQueue = upsertPendingScheduleSyncRecord([], firstRun);
  assert.equal(pendingQueue.length, 1);
  assert.deepEqual(pendingQueue[0].failedScheduleIds, [failingId]);

  // Langkah B: Pengguna menekan "Sinkronkan Ulang Jadwal" tanpa upload ulang Master Data
  const retriedIds: string[] = [];
  const retryRun = await syncSchedulesForMasterDataOr({
    targetOr: pendingQueue[0].targetOr,
    uploadId: pendingQueue[0].uploadId,
    updateDate: pendingQueue[0].updateDate,
    schedules: afterFirst,
    masterRequirements,
    uploadHistory,
    targetScheduleIds: pendingQueue[0].failedScheduleIds,
    persistScheduleSnapshot: async (sch) => {
      retriedIds.push(sch.id);
      return { success: true };
    },
    syncTimestampIso: '2026-11-18T03:05:00.000Z',
  });

  // Hanya jadwal #3 yang di-retry; seluruhnya sukses
  assert.deepEqual(retriedIds, [failingId]);
  assert.equal(retryRun.status, 'success');
  assert.equal(retryRun.syncedScheduleIds.length, 1);
  assert.equal(retryRun.failedSchedules.length, 0);

  afterFirst = applySyncedSchedulesToList(afterFirst, retryRun.updatedSchedulesById);
  assert.equal(afterFirst.length, 5);
  assert.equal(afterFirst[2].worksheets?.[0].matchedUploadId, 'upload-1036-v2');
  assert.equal(afterFirst[2].worksheets?.[0].materials[0].receivedQty, 30);
  assert.equal(afterFirst[2].worksheets?.[0].materials[0].status, 'READY');

  pendingQueue = upsertPendingScheduleSyncRecord(pendingQueue, retryRun);
  assert.equal(pendingQueue.length, 0);
});

test('4. Worksheet OR lain di dalam satu jadwal (jika campuran) tidak ikut tertimpa & metadata jadwal tetap utuh', () => {
  const mixedSchedule: ProductionSchedule = {
    id: '33333333-3333-4333-8333-333333333301',
    orNumber: '1036',
    style: 'MIXED',
    productionLine: 'Line 4',
    productionDate: '2026-12-01',
    finishDate: '2026-12-10',
    target: 777,
    status: 'Sedang Berjalan',
    worksheets: [
      {
        id: 'ws-1036',
        fileName: '1036.xls',
        orNumber: '1036',
        worksheetNo: 'PROD-1036',
        style: 'MIXED-A',
        target: 400,
        uploadedAt: '2026-11-01T00:00:00.000Z',
        matchedUploadId: 'old-1036',
        materials: [
          { id: 'm1', materialCode: 'MAT-1', materialName: 'M1', unit: 'Pcs', total: 10, receivedQty: 0, status: 'BELUM READY' },
        ],
      },
      {
        id: 'ws-1097',
        fileName: '1097.xls',
        orNumber: '1097',
        worksheetNo: 'PROD-1097',
        style: 'MIXED-B',
        target: 377,
        uploadedAt: '2026-11-01T00:00:00.000Z',
        matchedUploadId: 'old-1097',
        materials: [
          { id: 'm2', materialCode: 'MAT-1', materialName: 'M1', unit: 'Pcs', total: 10, receivedQty: 2, status: 'BELUM READY' },
        ],
      },
    ],
  };

  assert.equal(doesScheduleMatchOr(mixedSchedule, '1036'), true);
  assert.equal(doesScheduleMatchOr(mixedSchedule, '9999'), false);

  const { hasMatchingWorksheet, updatedSchedule } = buildScheduleMaterialSyncUpdate(
    mixedSchedule,
    '1036',
    [
      {
        id: 'req-1',
        uploadId: 'new-1036',
        orNumber: '1036',
        style: 'MIXED-A',
        materialCode: 'MAT-1',
        materialName: 'M1',
        category: 'Auxiliary',
        unit: 'Pcs',
        requiredQty: 10,
        receivedQty: 10,
        unitPrice: 1000,
        updateDate: '2026-11-18',
      },
    ],
    [
      {
        id: 'new-1036',
        orNumber: '1036',
        style: 'MIXED-A',
        fileName: 'new.xlsx',
        updateDate: '2026-11-18',
        uploadTime: '11:00:00 WIB',
        rowCount: 1,
        status: 'Sukses',
        createdAt: '2026-11-18T04:00:00.000Z',
      },
    ],
    '2026-11-18T04:01:00.000Z'
  );

  assert.equal(hasMatchingWorksheet, true);
  assert.equal(updatedSchedule.productionLine, 'Line 4');
  assert.equal(updatedSchedule.status, 'Sedang Berjalan');
  assert.equal(updatedSchedule.target, 777);
  // Worksheet OR 1036 diperbarui
  assert.equal(updatedSchedule.worksheets![0].matchedUploadId, 'new-1036');
  assert.equal(updatedSchedule.worksheets![0].materials[0].receivedQty, 10);
  assert.equal(updatedSchedule.worksheets![0].materials[0].status, 'READY');
  // Worksheet OR 1097 tidak ikut berubah
  assert.equal(updatedSchedule.worksheets![1].matchedUploadId, 'old-1097');
  assert.equal(updatedSchedule.worksheets![1].materials[0].receivedQty, 2);
  assert.equal(updatedSchedule.worksheets![1].materials[0].status, 'BELUM READY');
});
