import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MaterialItemRequirement,
  ProductionSchedule,
  UploadHistoryItem,
} from '../src/types/ppic';
import {
  GlobalScheduleSyncProgressInfo,
  ScheduleSyncProgressInfo,
  applySyncedSchedulesToList,
  buildScheduleMaterialSyncUpdate,
  deduplicateCanonicalOrs,
  doesFetchedScheduleMatchOr,
  doesScheduleMatchOr,
  syncAllOrSchedulesWithMasterData,
  syncSchedulesForMasterDataOr,
  upsertPendingScheduleSyncRecord,
} from '../src/utils/masterDataScheduleSync';
import {
  fetchDistinctMasterDataOrsFromSupabase,
  fetchSchedulesMatchingOrFromSupabase,
  mapModelToDbSchedule,
} from '../src/lib/supabase';
import { buildAtomicSnapshotSyncPayload } from '../src/utils/scheduleSnapshotSync';
import { areOrNumbersMatching, extractOrSearchTokens } from '../src/utils/pdfWorksheetParser';

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

test('5. extractOrSearchTokens menghasilkan token pencarian aman lintas format OR', () => {
  assert.deepEqual(extractOrSearchTokens('1036'), ['1036']);
  assert.deepEqual(extractOrSearchTokens('01036'), ['1036', '01036']);
  assert.deepEqual(extractOrSearchTokens('OR/2026/09/1036'), ['1036', 'OR/2026/09/1036']);
  assert.deepEqual(extractOrSearchTokens('OR-2026-001'), ['2026-001', 'OR-2026-001']);
  assert.deepEqual(extractOrSearchTokens(''), []);
  // Karakter spesial PostgREST disanitasi
  const sanitized = extractOrSearchTokens('OR-1036,("test")');
  assert.ok(sanitized.every((t) => !/[,()%*"'\\]/.test(t)));
});

test('6. Progress tracking melaporkan total jadwal, berhasil, gagal, & persentase akurat (tidak pernah 100% sebelum selesai)', async () => {
  const schedules: ProductionSchedule[] = [1, 2, 3, 4].map((n) =>
    makeSchedule({
      id: `44444444-4444-4444-8444-44444444440${n}`,
      orNumber: '1036',
      worksheetNo: `WH/MO/0040${n}`,
      style: `STYLE-${n}`,
      line: `Line ${n}`,
      start: `2026-12-0${n}`,
      finish: `2026-12-1${n}`,
      target: 100,
      materials: [
        { id: `m-${n}`, code: 'FAB-001', name: 'KAIN TASLAN', unit: 'yard', total: 29.5, receivedQty: 0, status: 'BELUM READY' },
      ],
    })
  );

  const masterRequirements: MaterialItemRequirement[] = [
    {
      id: 'req-prog-1',
      uploadId: 'up-prog-1',
      orNumber: '1036',
      style: 'STYLE-1',
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

  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'up-prog-1',
      orNumber: '1036',
      style: 'STYLE-1',
      fileName: 'up.xlsx',
      updateDate: '2026-11-18',
      uploadTime: '12:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-18T05:00:00.000Z',
    },
  ];

  const progressEvents: ScheduleSyncProgressInfo[] = [];
  const summary = await syncSchedulesForMasterDataOr({
    targetOr: '1036',
    uploadId: 'up-prog-1',
    updateDate: '2026-11-18',
    schedules,
    masterRequirements,
    uploadHistory,
    concurrency: 2,
    onProgress: (info) => progressEvents.push({ ...info }),
    persistScheduleSnapshot: async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { success: true };
    },
    syncTimestampIso: '2026-11-18T05:01:00.000Z',
  });

  assert.equal(summary.status, 'success');
  assert.equal(progressEvents.length, 5); // 1 initial + 4 completions
  assert.equal(progressEvents[0].percent, 0);
  assert.equal(progressEvents[0].totalSchedules, 4);
  assert.equal(progressEvents[0].completedSchedules, 0);
  // Intermediate events must never report 100% before all 4 finish
  for (let i = 1; i < progressEvents.length - 1; i++) {
    assert.ok(progressEvents[i].percent < 100, 'Progres menengah tidak boleh 100%');
    assert.equal(progressEvents[i].syncedSchedules, i);
    assert.equal(progressEvents[i].failedSchedules, 0);
  }
  const last = progressEvents[progressEvents.length - 1];
  assert.equal(last.percent, 100);
  assert.equal(last.completedSchedules, 4);
  assert.equal(last.syncedSchedules, 4);
  assert.equal(last.failedSchedules, 0);
});

test('7. Benchmark & Integritas 239 baris material + 10 jadwal: eksekusi paralel terukur jauh lebih cepat dari serial dengan hasil identik', async () => {
  // Bangun 239 baris Master Data (termasuk duplikat & angka desimal persis)
  const masterRequirements: MaterialItemRequirement[] = Array.from({ length: 239 }, (_, i) => {
    const isDup = i === 1 || i === 2;
    const code = isDup ? 'UNI-ACC9026' : `MAT-${String(i + 1).padStart(4, '0')}`;
    const reqQty = i === 2 ? 1000 : i % 3 === 0 ? 29.5 : 11.88;
    const recQty = i === 2 ? 750 : reqQty;
    return {
      id: `req-bench-${i}`,
      uploadId: 'upload-239',
      orNumber: '1036',
      style: 'BENCH-STYLE',
      materialCode: code,
      materialName: `Material ${code}`,
      category: 'Raw Material',
      unit: i % 2 === 0 ? 'Pcs' : 'yard',
      requiredQty: reqQty,
      receivedQty: recQty,
      unitPrice: 1000,
      updateDate: '2026-11-18',
    };
  });

  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'upload-239',
      orNumber: '1036',
      style: 'BENCH-STYLE',
      fileName: 'mrp_239.xlsx',
      updateDate: '2026-11-18',
      uploadTime: '13:00:00 WIB',
      rowCount: 239,
      status: 'Sukses',
      createdAt: '2026-11-18T06:00:00.000Z',
    },
  ];

  // Bangun 10 jadwal OR 1036 masing-masing membawa 40 baris material (termasuk duplikat UNI-ACC9026 & desimal)
  const schedules: ProductionSchedule[] = Array.from({ length: 10 }, (_, sIdx) =>
    makeSchedule({
      id: `55555555-5555-4555-8555-5555555555${String(sIdx + 1).padStart(2, '0')}`,
      orNumber: '1036',
      worksheetNo: `WH/MO/50${sIdx + 1}`,
      style: `STYLE-${sIdx + 1}`,
      line: `Line ${(sIdx % 5) + 1}`,
      start: '2026-12-01',
      finish: '2026-12-10',
      target: 500,
      materials: Array.from({ length: 40 }, (__, mIdx) => {
        const isDup1 = mIdx === 1;
        const isDup2 = mIdx === 2;
        const code = isDup1 || isDup2 ? 'UNI-ACC9026' : `MAT-${String(mIdx + 1).padStart(4, '0')}`;
        const total = isDup2 ? 1000 : mIdx % 3 === 0 ? 29.5 : 11.88;
        return {
          id: `ws-${sIdx}-m-${mIdx}`,
          code,
          name: `Material ${code}`,
          unit: mIdx % 2 === 0 ? 'Pcs' : 'yard',
          total,
          receivedQty: 0,
          status: 'BELUM READY',
        };
      }),
    })
  );

  const simulatedRpc = async () => {
    await new Promise((r) => setTimeout(r, 40));
    return { success: true };
  };

  const t0Serial = performance.now();
  const serialRes = await syncSchedulesForMasterDataOr({
    targetOr: '1036',
    uploadId: 'upload-239',
    updateDate: '2026-11-18',
    schedules,
    masterRequirements,
    uploadHistory,
    concurrency: 1,
    persistScheduleSnapshot: simulatedRpc,
    syncTimestampIso: '2026-11-18T06:05:00.000Z',
  });
  const serialMs = performance.now() - t0Serial;

  const t0Concurrent = performance.now();
  const concurrentRes = await syncSchedulesForMasterDataOr({
    targetOr: '1036',
    uploadId: 'upload-239',
    updateDate: '2026-11-18',
    schedules,
    masterRequirements,
    uploadHistory,
    concurrency: 5,
    persistScheduleSnapshot: simulatedRpc,
    syncTimestampIso: '2026-11-18T06:05:00.000Z',
  });
  const concurrentMs = performance.now() - t0Concurrent;

  assert.equal(serialRes.status, 'success');
  assert.equal(concurrentRes.status, 'success');
  assert.deepEqual(concurrentRes.syncedScheduleIds, serialRes.syncedScheduleIds);
  assert.deepEqual(concurrentRes.updatedSchedulesById, serialRes.updatedSchedulesById);
  assert.ok(
    concurrentMs < serialMs * 0.5,
    `Eksekusi paralel (${concurrentMs.toFixed(1)}ms) harus jauh lebih cepat dari serial (${serialMs.toFixed(1)}ms)`
  );

  // Validasi duplikat & desimal tetap presisi
  const firstUpdated = concurrentRes.updatedSchedulesById[schedules[0].id];
  const mats = firstUpdated.worksheets![0].materials;
  assert.equal(mats[1].materialCode, 'UNI-ACC9026');
  assert.equal(mats[1].receivedQty, 11.88);
  assert.equal(mats[1].status, 'READY');
  assert.equal(mats[2].materialCode, 'UNI-ACC9026');
  assert.equal(mats[2].receivedQty, 750);
  assert.equal(mats[2].status, 'BELUM READY');
  assert.equal(mats[3].receivedQty, 29.5);
  assert.equal(mats[3].status, 'READY');
});

test('8. fetchSchedulesMatchingOrFromSupabase bebas false positive substring (1036 vs 11036/10360/notes) & konsisten 01036/OR-path', async () => {
  const rawModels: ProductionSchedule[] = [
    makeSchedule({
      id: '88888888-8888-4888-8888-888888888801',
      orNumber: '1036',
      worksheetNo: 'WH/MO/1036-A',
      style: 'STYLE-1036',
      line: 'Line 1',
      start: '2026-12-01',
      finish: '2026-12-03',
      target: 100,
      materials: [
        { id: 'm1', code: 'FAB-001', name: 'KAIN', unit: 'yard', total: 10, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '88888888-8888-4888-8888-888888888802',
      orNumber: '01036',
      worksheetNo: 'WH/MO/01036-B',
      style: 'STYLE-01036',
      line: 'Line 2',
      start: '2026-12-02',
      finish: '2026-12-04',
      target: 120,
      materials: [
        { id: 'm2', code: 'FAB-001', name: 'KAIN', unit: 'yard', total: 10, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '88888888-8888-4888-8888-888888888803',
      orNumber: 'OR/2026/09/1036',
      style: 'STYLE-PATH-1036',
      worksheetNo: 'WH/MO/1036-C',
      line: 'Line 3',
      start: '2026-12-03',
      finish: '2026-12-05',
      target: 150,
      materials: [
        { id: 'm3', code: 'FAB-001', name: 'KAIN', unit: 'yard', total: 10, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    // False positive substring: 11036
    makeSchedule({
      id: '88888888-8888-4888-8888-888888888804',
      orNumber: '11036',
      worksheetNo: 'WH/MO/11036',
      style: 'STYLE-11036',
      line: 'Line 4',
      start: '2026-12-04',
      finish: '2026-12-06',
      target: 200,
      materials: [
        { id: 'm4', code: 'FAB-001', name: 'KAIN', unit: 'yard', total: 10, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    // False positive substring: 10360
    makeSchedule({
      id: '88888888-8888-4888-8888-888888888805',
      orNumber: '10360',
      worksheetNo: 'WH/MO/10360',
      style: 'STYLE-10360',
      line: 'Line 5',
      start: '2026-12-05',
      finish: '2026-12-07',
      target: 220,
      materials: [
        { id: 'm5', code: 'FAB-001', name: 'KAIN', unit: 'yard', total: 10, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    // False positive via notes: OR 814 yang kebetulan menyebut "1036" di catatan
    {
      ...makeSchedule({
        id: '88888888-8888-4888-8888-888888888806',
        orNumber: '814',
        worksheetNo: 'WH/MO/814',
        style: 'STYLE-814',
        line: 'Line 6',
        start: '2026-12-06',
        finish: '2026-12-08',
        target: 300,
        materials: [
          { id: 'm6', code: 'FAB-001', name: 'KAIN', unit: 'yard', total: 10, receivedQty: 0, status: 'BELUM READY' },
        ],
      }),
      notes: 'Catatan menyebutkan pengiriman bersama OR 1036',
    },
  ];
  const dbRows = rawModels.map(mapModelToDbSchedule);

  // Simulasikan query .or('or_number.ilike.%1036%,notes.ilike.%1036%') di PostgREST yang mengembalikan semua substring match
  let capturedOrClause = '';
  const mockSupabaseClient = {
    from: (table: string) => {
      assert.equal(table, 'production_schedules');
      return {
        select: () => ({
          or: (clause: string) => {
            capturedOrClause = clause;
            return {
              order: async () => {
                // Simulasikan SQL .ilike '%1036%' (mengembalikan 1036, 01036, OR/2026/09/1036, 11036, 10360, & OR 814 yg notesnya ada 1036)
                const sqlMatched = dbRows.filter(
                  (r) => r.or_number.includes('1036') || (r.notes || '').includes('1036')
                );
                return { data: sqlMatched, error: null };
              },
            };
          },
        }),
      };
    },
  };

  const res = await fetchSchedulesMatchingOrFromSupabase('1036', mockSupabaseClient);
  assert.equal(res.connected, true);
  assert.ok(capturedOrClause.includes('or_number.ilike.%1036%'));

  // Hanya 1036, 01036, dan OR/2026/09/1036 yang terambil
  const returnedOrs = res.schedules.map((s) => s.orNumber);
  assert.deepEqual(returnedOrs, ['1036', '01036', 'OR/2026/09/1036']);

  // Pastikan 11036, 10360, dan 814 TIDAK terambil
  assert.equal(returnedOrs.includes('11036'), false);
  assert.equal(returnedOrs.includes('10360'), false);
  assert.equal(returnedOrs.includes('814'), false);

  // Validasi helper murni doesFetchedScheduleMatchOr
  assert.equal(
    doesFetchedScheduleMatchOr(
      {
        id: 'manual-11036',
        orNumber: '11036',
        style: 'S',
        productionLine: 'Line 1',
        productionDate: '2026-12-01',
        finishDate: '2026-12-02',
        target: 10,
        status: 'Terjadwal',
      },
      '1036'
    ),
    false
  );
  assert.equal(
    doesFetchedScheduleMatchOr(
      {
        id: 'manual-01036',
        orNumber: '01036',
        style: 'S',
        productionLine: 'Line 1',
        productionDate: '2026-12-01',
        finishDate: '2026-12-02',
        target: 10,
        status: 'Terjadwal',
      },
      '1036'
    ),
    true
  );

  // Sinkronisasi ke hasil fetchSchedulesMatchingOrFromSupabase hanya memperbarui 3 jadwal OR 1036
  const syncRes = await syncSchedulesForMasterDataOr({
    targetOr: '1036',
    schedules: res.schedules,
    masterRequirements: [
      {
        id: 'req-1036',
        uploadId: 'up-1036',
        orNumber: '1036',
        style: 'STYLE-1036',
        materialCode: 'FAB-001',
        materialName: 'KAIN',
        category: 'Raw Material',
        unit: 'yard',
        requiredQty: 10,
        receivedQty: 10,
        unitPrice: 1000,
        updateDate: '2026-11-19',
      },
    ],
    uploadHistory: [
      {
        id: 'up-1036',
        orNumber: '1036',
        style: 'STYLE-1036',
        fileName: 'or1036.xlsx',
        updateDate: '2026-11-19',
        uploadTime: '09:00:00 WIB',
        rowCount: 1,
        status: 'Sukses',
        createdAt: '2026-11-19T02:00:00.000Z',
      },
    ],
    persistScheduleSnapshot: async () => ({ success: true }),
    syncTimestampIso: '2026-11-19T02:05:00.000Z',
  });

  assert.equal(syncRes.status, 'success');
  assert.equal(syncRes.matchedScheduleCount, 3);
  assert.deepEqual(syncRes.syncedScheduleIds, [
    '88888888-8888-4888-8888-888888888801',
    '88888888-8888-4888-8888-888888888802',
    '88888888-8888-4888-8888-888888888803',
  ]);
});

test('9. syncAllOrSchedulesWithMasterData menyinkronkan multi-OR global secara terisolasi & akurat', async () => {
  // Upload History untuk 4 OR (termasuk upload lama OR 1036 & OR 814 yg harus diabaikan)
  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'up-814-old',
      orNumber: '814',
      style: 'S814',
      fileName: '814_old.xlsx',
      updateDate: '2026-11-10',
      uploadTime: '08:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-10T01:00:00.000Z',
    },
    {
      id: 'up-814-new',
      orNumber: '814',
      style: 'S814',
      fileName: '814_new.xlsx',
      updateDate: '2026-11-19',
      uploadTime: '08:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-19T01:00:00.000Z',
    },
    {
      id: 'up-979-new',
      orNumber: '979',
      style: 'S979',
      fileName: '979.xlsx',
      updateDate: '2026-11-19',
      uploadTime: '08:05:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-19T01:05:00.000Z',
    },
    {
      id: 'up-1036-new',
      orNumber: 'OR/2026/09/1036',
      style: 'S1036',
      fileName: '1036.xlsx',
      updateDate: '2026-11-19',
      uploadTime: '08:10:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: '2026-11-19T01:10:00.000Z',
    },
    {
      id: 'up-1097-new',
      orNumber: '1097',
      style: 'S1097',
      fileName: '1097.xlsx',
      updateDate: '2026-11-19',
      uploadTime: '08:15:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-19T01:15:00.000Z',
    },
  ];

  const masterRequirements: MaterialItemRequirement[] = [
    // Upload lama 814 (receivedQty = 1 -> harus diabaikan)
    {
      id: 'r-814-old',
      uploadId: 'up-814-old',
      orNumber: '814',
      style: 'S814',
      materialCode: 'SHARED-MAT',
      materialName: 'Kain Shared',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 50,
      receivedQty: 1,
      unitPrice: 1000,
      updateDate: '2026-11-10',
    },
    // Upload terbaru 814 (receivedQty = 50 -> READY)
    {
      id: 'r-814-new',
      uploadId: 'up-814-new',
      orNumber: '814',
      style: 'S814',
      materialCode: 'SHARED-MAT',
      materialName: 'Kain Shared',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 50,
      receivedQty: 50,
      unitPrice: 1000,
      updateDate: '2026-11-19',
    },
    // Upload terbaru 979 (receivedQty = 12.5 dari 20 -> BELUM READY; jangan pernah bercampur ke OR lain!)
    {
      id: 'r-979-new',
      uploadId: 'up-979-new',
      orNumber: '979',
      style: 'S979',
      materialCode: 'SHARED-MAT',
      materialName: 'Kain Shared',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 20,
      receivedQty: 12.5,
      unitPrice: 1000,
      updateDate: '2026-11-19',
    },
    // Upload terbaru 1036 dengan kode duplikat UNI-ACC9026 1-to-1 + angka desimal persis
    {
      id: 'r-1036-dup1',
      uploadId: 'up-1036-new',
      orNumber: 'OR/2026/09/1036',
      style: 'S1036',
      materialCode: 'UNI-ACC9026',
      materialName: 'SNAP',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 100,
      receivedQty: 100,
      unitPrice: 500,
      updateDate: '2026-11-19',
    },
    {
      id: 'r-1036-dup2',
      uploadId: 'up-1036-new',
      orNumber: 'OR/2026/09/1036',
      style: 'S1036',
      materialCode: 'UNI-ACC9026',
      materialName: 'SNAP',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 200,
      receivedQty: 150,
      unitPrice: 500,
      updateDate: '2026-11-19',
    },
    // Upload terbaru 1097
    {
      id: 'r-1097-new',
      uploadId: 'up-1097-new',
      orNumber: '1097',
      style: 'S1097',
      materialCode: 'SHARED-MAT',
      materialName: 'Kain Shared',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 29.5,
      receivedQty: 29.5,
      unitPrice: 1000,
      updateDate: '2026-11-19',
    },
  ];

  const allSchedules: ProductionSchedule[] = [
    makeSchedule({
      id: '99999999-9999-4999-8999-999999999901',
      orNumber: '814',
      worksheetNo: 'WH/MO/814',
      style: 'S814',
      line: 'Line 1',
      start: '2026-12-01',
      finish: '2026-12-02',
      target: 100,
      materials: [
        { id: 'm814', code: 'SHARED-MAT', name: 'Kain Shared', unit: 'yard', total: 50, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '99999999-9999-4999-8999-999999999902',
      orNumber: '979',
      worksheetNo: 'WH/MO/979',
      style: 'S979',
      line: 'Line 2',
      start: '2026-12-01',
      finish: '2026-12-02',
      target: 100,
      materials: [
        { id: 'm979', code: 'SHARED-MAT', name: 'Kain Shared', unit: 'yard', total: 20, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '99999999-9999-4999-8999-999999999903',
      orNumber: '1036',
      worksheetNo: 'WH/MO/1036',
      style: 'S1036',
      line: 'Line 3',
      start: '2026-12-01',
      finish: '2026-12-02',
      target: 100,
      materials: [
        { id: 'm1036-1', code: 'UNI-ACC9026', name: 'SNAP', unit: 'Pcs', total: 100, receivedQty: 0, status: 'BELUM READY' },
        { id: 'm1036-2', code: 'UNI-ACC9026', name: 'SNAP', unit: 'Pcs', total: 200, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    makeSchedule({
      id: '99999999-9999-4999-8999-999999999904',
      orNumber: '1097',
      worksheetNo: 'WH/MO/1097',
      style: 'S1097',
      line: 'Line 4',
      start: '2026-12-01',
      finish: '2026-12-02',
      target: 100,
      materials: [
        { id: 'm1097', code: 'SHARED-MAT', name: 'Kain Shared', unit: 'yard', total: 29.5, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
    // Jadwal dengan OR yg BELUM PUNYA Master Data -> tidak boleh meminjam data OR lain!
    makeSchedule({
      id: '99999999-9999-4999-8999-999999999905',
      orNumber: '555',
      worksheetNo: 'WH/MO/555',
      style: 'S555',
      line: 'Line 5',
      start: '2026-12-01',
      finish: '2026-12-02',
      target: 100,
      materials: [
        { id: 'm555', code: 'SHARED-MAT', name: 'Kain Shared', unit: 'yard', total: 10, receivedQty: 3, status: 'BELUM READY' },
      ],
    }),
    // Jadwal substring neighbor OR 11036 yg punya SHARED-MAT namun bukan target Master Data
    makeSchedule({
      id: '99999999-9999-4999-8999-999999999906',
      orNumber: '11036',
      worksheetNo: 'WH/MO/11036',
      style: 'S11036',
      line: 'Line 6',
      start: '2026-12-01',
      finish: '2026-12-02',
      target: 100,
      materials: [
        { id: 'm11036', code: 'UNI-ACC9026', name: 'SNAP', unit: 'Pcs', total: 100, receivedQty: 0, status: 'BELUM READY' },
      ],
    }),
  ];

  // Deduplikasi kanonis harus mengelompokkan 1036 + 01036 + OR/2026/09/1036 menjadi satu, dan tetap memisah 11036
  const canonical = deduplicateCanonicalOrs(['814', '979', '1036', '01036', 'OR/2026/09/1036', '1097', '555']);
  assert.deepEqual(canonical, ['814', '979', '1036', '1097', '555']);

  const progressHistory: GlobalScheduleSyncProgressInfo[] = [];
  const persistedIds: string[] = [];

  const summary = await syncAllOrSchedulesWithMasterData({
    targetOrs: ['814', '979', '1036', '01036', '1097', '555'],
    concurrency: 5,
    syncTimestampIso: '2026-11-19T03:00:00.000Z',
    onProgress: (info) => progressHistory.push({ ...info }),
    fetchMasterDataForOrs: async () => ({
      connected: true,
      uploadHistory,
      materialRequirements: masterRequirements,
    }),
    fetchSchedulesForOr: async (targetOr) => ({
      connected: true,
      // Sengaja sertakan semua schedules agar validasi strict filter OR diuji berlapis
      schedules: allSchedules,
    }),
    persistScheduleSnapshot: async (sch) => {
      persistedIds.push(sch.id);
      return { success: true };
    },
  });

  assert.equal(summary.status, 'success');
  assert.equal(summary.totalOrs, 4); // Hanya 814, 979, 1036, 1097 (555 tidak punya Master Data!)
  assert.equal(summary.succeededOrs, 4);
  assert.equal(summary.failedOrs, 0);
  assert.equal(summary.totalSchedules, 4);
  assert.equal(summary.syncedScheduleIds.length, 4);
  assert.equal(summary.failedSchedules.length, 0);
  assert.deepEqual(persistedIds.sort(), [
    '99999999-9999-4999-8999-999999999901',
    '99999999-9999-4999-8999-999999999902',
    '99999999-9999-4999-8999-999999999903',
    '99999999-9999-4999-8999-999999999904',
  ]);

  // Isolasi per OR: masing-masing pakai nilai Master Data terbarunya sendiri
  const merged = applySyncedSchedulesToList(allSchedules, summary.updatedSchedulesById);
  assert.equal(merged[0].worksheets![0].materials[0].receivedQty, 50);
  assert.equal(merged[0].worksheets![0].materials[0].status, 'READY');
  assert.equal(merged[1].worksheets![0].materials[0].receivedQty, 12.5);
  assert.equal(merged[1].worksheets![0].materials[0].status, 'BELUM READY');

  // Duplikat 1-to-1 OR 1036 terjaga (baris 1 READY, baris 2 BELUM READY)
  assert.equal(merged[2].worksheets![0].materials[0].receivedQty, 100);
  assert.equal(merged[2].worksheets![0].materials[0].status, 'READY');
  assert.equal(merged[2].worksheets![0].materials[1].receivedQty, 150);
  assert.equal(merged[2].worksheets![0].materials[1].status, 'BELUM READY');

  // Desimal OR 1097 terjaga
  assert.equal(merged[3].worksheets![0].materials[0].receivedQty, 29.5);
  assert.equal(merged[3].worksheets![0].materials[0].status, 'READY');

  // OR 555 (tanpa Master Data) & OR 11036 (substring) tetap utuh tak tersentuh
  assert.equal(merged[4].worksheets![0].materials[0].receivedQty, 3);
  assert.equal(merged[5].worksheets![0].materials[0].receivedQty, 0);

  // Progress tidak pernah 100% sebelum selesai penuh
  assert.ok(progressHistory.length >= 3);
  for (let i = 0; i < progressHistory.length - 1; i++) {
    assert.ok(progressHistory[i].percent < 100, `Event ke-${i} tidak boleh 100%`);
  }
  const finalProg = progressHistory[progressHistory.length - 1];
  assert.equal(finalProg.phase, 'completed');
  assert.equal(finalProg.percent, 100);
  assert.equal(finalProg.syncedSchedules, 4);
  assert.equal(finalProg.failedSchedules, 0);
  assert.equal(finalProg.succeededOrs, 4);
});

test('10. syncAllOrSchedulesWithMasterData menangani 0 jadwal, error Supabase, partial_failure (<100%) & discovery OR', async () => {
  // 10A. Kasus 0 jadwal terkait -> no_schedules bersih
  const noSchRes = await syncAllOrSchedulesWithMasterData({
    targetOrs: ['814'],
    fetchMasterDataForOrs: async () => ({
      connected: true,
      uploadHistory: [
        {
          id: 'u1',
          orNumber: '814',
          style: 'S',
          fileName: 'f.xlsx',
          updateDate: '2026-11-19',
          uploadTime: '09:00:00 WIB',
          rowCount: 1,
          status: 'Sukses',
        },
      ],
      materialRequirements: [
        {
          id: 'r1',
          uploadId: 'u1',
          orNumber: '814',
          style: 'S',
          materialCode: 'M1',
          materialName: 'Mat 1',
          category: 'Raw Material',
          unit: 'Pcs',
          requiredQty: 10,
          receivedQty: 10,
          unitPrice: 100,
        },
      ],
    }),
    fetchSchedulesForOr: async () => ({ connected: true, schedules: [] }),
    persistScheduleSnapshot: async () => ({ success: true }),
  });
  assert.equal(noSchRes.status, 'no_schedules');
  assert.equal(noSchRes.totalSchedules, 0);

  // 10B. Kasus kegagalan parsial RPC -> status partial_failure, percent < 100, & pending queue mencatat detail OR gagal
  const progressEvents: GlobalScheduleSyncProgressInfo[] = [];
  const partialRes = await syncAllOrSchedulesWithMasterData({
    targetOrs: ['814', '979'],
    syncTimestampIso: '2026-11-19T04:00:00.000Z',
    onProgress: (info) => progressEvents.push({ ...info }),
    fetchMasterDataForOrs: async () => ({
      connected: true,
      uploadHistory: [
        {
          id: 'u814',
          orNumber: '814',
          style: 'S814',
          fileName: '814.xlsx',
          updateDate: '2026-11-19',
          uploadTime: '09:00:00 WIB',
          rowCount: 1,
          status: 'Sukses',
        },
        {
          id: 'u979',
          orNumber: '979',
          style: 'S979',
          fileName: '979.xlsx',
          updateDate: '2026-11-19',
          uploadTime: '09:05:00 WIB',
          rowCount: 1,
          status: 'Sukses',
        },
      ],
      materialRequirements: [
        {
          id: 'r814',
          uploadId: 'u814',
          orNumber: '814',
          style: 'S814',
          materialCode: 'M1',
          materialName: 'M1',
          category: 'Raw Material',
          unit: 'Pcs',
          requiredQty: 10,
          receivedQty: 10,
          unitPrice: 100,
        },
        {
          id: 'r979',
          uploadId: 'u979',
          orNumber: '979',
          style: 'S979',
          materialCode: 'M1',
          materialName: 'M1',
          category: 'Raw Material',
          unit: 'Pcs',
          requiredQty: 10,
          receivedQty: 5,
          unitPrice: 100,
        },
      ],
    }),
    fetchSchedulesForOr: async (targetOr) => ({
      connected: true,
      schedules: [
        makeSchedule({
          id: targetOr === '814' ? 'aaaa1111-1111-4111-8111-111111111111' : 'bbbb2222-2222-4222-8222-222222222222',
          orNumber: targetOr,
          worksheetNo: `WH/${targetOr}`,
          style: `S${targetOr}`,
          line: 'Line 1',
          start: '2026-12-01',
          finish: '2026-12-02',
          target: 100,
          materials: [
            { id: `mat-${targetOr}`, code: 'M1', name: 'M1', unit: 'Pcs', total: 10, receivedQty: 0, status: 'BELUM READY' },
          ],
        }),
      ],
    }),
    persistScheduleSnapshot: async (sch) => {
      if (sch.orNumber === '979') {
        return { success: false, error: 'Koneksi database terputus saat menyimpan OR 979' };
      }
      return { success: true };
    },
  });

  assert.equal(partialRes.status, 'partial_failure');
  assert.equal(partialRes.succeededOrs, 1);
  assert.equal(partialRes.failedOrs, 1);
  assert.equal(partialRes.syncedScheduleIds.length, 1);
  assert.equal(partialRes.failedSchedules.length, 1);
  assert.equal(partialRes.failedSchedules[0].orNumber, '979');
  const finalPartialProg = progressEvents[progressEvents.length - 1];
  assert.equal(finalPartialProg.phase, 'partial_failure');
  assert.ok(finalPartialProg.percent < 100, 'Partial failure tidak boleh melapor 100%');

  // Pending queue mencatat OR 979 saja, tidak mengikutkan OR 814 yg sudah sukses
  let pending: ReturnType<typeof upsertPendingScheduleSyncRecord> = [];
  for (const orSum of partialRes.orSummaries) {
    pending = upsertPendingScheduleSyncRecord(pending, orSum);
  }
  assert.equal(pending.length, 1);
  assert.equal(pending[0].targetOr, '979');

  // 10C. Discovery OR dari upload_history Supabase memfilter status Gagal dan menduplikasi dengan aman
  const mockDiscoveryClient = {
    from: () => ({
      select: () => ({
        neq: () => ({
          order: () => ({
            limit: async () => ({
              data: [
                { or_number: '814' },
                { or_number: '979' },
                { or_number: '814' },
                { or_number: '1036' },
                { or_number: '-' },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  const discRes = await fetchDistinctMasterDataOrsFromSupabase(mockDiscoveryClient);
  assert.equal(discRes.connected, true);
  assert.deepEqual(discRes.orNumbers, ['814', '979', '1036']);
});


