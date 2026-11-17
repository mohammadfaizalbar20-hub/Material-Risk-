import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  extractOrNumberFromSource,
  parseScheduleExcelBuffer,
  parseScheduleExcelRows,
} from '../src/utils/scheduleExcelParser';
import {
  buildWorksheetSnapshot,
  matchMaterialsWithMasterData,
  refreshScheduleWorksheetsSnapshot,
} from '../src/utils/pdfWorksheetParser';
import { formatPpicNumber } from '../src/utils/excelMaterialParser';
import { isFinishBeforeStart } from '../src/utils/ganttScheduleUtils';
import {
  mapDbScheduleToModel,
  mapModelToDbSchedule,
  safeDbDate,
} from '../src/lib/supabase';
import { buildAtomicSnapshotSyncPayload } from '../src/utils/scheduleSnapshotSync';
import {
  MaterialItemRequirement,
  ProductionSchedule,
  UploadHistoryItem,
  WorksheetPdfItem,
} from '../src/types/ppic';

function createExcelBufferFromRows(
  rows: Record<string, unknown>[],
  bookType: XLSX.BookType = 'xlsx'
): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MRP Production');
  return XLSX.write(wb, { type: 'array', bookType }) as Uint8Array;
}

test('1. extractOrNumberFromSource strictly extracts segment after last slash and never uses Reference/PO', () => {
  assert.equal(extractOrNumberFromSource('OR/2026/06/1036'), '1036');
  assert.equal(extractOrNumberFromSource('OR/2026/11/1045'), '1045');
  assert.equal(extractOrNumberFromSource('OR/2026/06/1036/'), '1036');
  assert.equal(extractOrNumberFromSource('1050'), '1050');
  assert.equal(extractOrNumberFromSource('  OR / 2026 / 07 / 1088  '), '1088');
  assert.equal(extractOrNumberFromSource(''), '');
  assert.equal(extractOrNumberFromSource(null), '');
});

test('2-7. Parses .xls (BIFF8) & .xlsx Odoo mrp.production export: row 0 header+material, blank subsequent rows, duplicates, exact units, decimals, ignores Delivery/Done/Deadline', () => {
  const rows: Record<string, unknown>[] = [
    {
      Source: 'OR/2026/06/1036',
      Reference: 'WH/MO/22743',
      'Style List/Display Name': 'JACKET WINDBREAKER NAVY',
      'Quantity To Produce': 1250,
      'Deadline Start': '2026-06-01 08:00:00',
      'Deadline End': '2026-06-02 17:00:00',
      'Delivery Date': '2026-06-25',
      'Line Produksi': 'Line 3',
      'Quantity Done': 500,
      'Raw Materials/Product/Internal Reference': 'FAB-001',
      'Raw Materials/Product/Display Name': 'Nylon Ripstop Navy',
      'Raw Materials/Product/Unit of Measure': 'yard',
      'Raw Materials/Initial Demand': 104.9165,
      'Raw Materials/Done': 50,
    },
    {
      Source: null,
      Reference: null,
      'Style List/Display Name': null,
      'Quantity To Produce': null,
      'Deadline Start': null,
      'Deadline End': null,
      'Delivery Date': null,
      'Line Produksi': null,
      'Quantity Done': null,
      'Raw Materials/Product/Internal Reference': 'THR-002',
      'Raw Materials/Product/Display Name': 'Benang Jahit Poly',
      'Raw Materials/Product/Unit of Measure': 'CNS',
      'Raw Materials/Initial Demand': 0.125,
      'Raw Materials/Done': 0,
    },
    {
      Source: null,
      Reference: null,
      'Style List/Display Name': null,
      'Quantity To Produce': null,
      'Raw Materials/Product/Internal Reference': 'BTN-003',
      'Raw Materials/Product/Display Name': 'Snap Button Metal',
      'Raw Materials/Product/Unit of Measure': 'Pcs',
      'Raw Materials/Initial Demand': 2500,
    },
    {
      Source: null,
      Reference: null,
      'Style List/Display Name': null,
      'Quantity To Produce': null,
      'Raw Materials/Product/Internal Reference': 'LBL-004',
      'Raw Materials/Product/Display Name': 'Care Label Satin',
      'Raw Materials/Product/Unit of Measure': 'Rol',
      'Raw Materials/Initial Demand': 12.5,
    },
    {
      // Duplicate material code on purpose! Must stay separate
      Source: null,
      Reference: null,
      'Style List/Display Name': null,
      'Quantity To Produce': null,
      'Raw Materials/Product/Internal Reference': 'FAB-001',
      'Raw Materials/Product/Display Name': 'Nylon Ripstop Navy (Cadangan)',
      'Raw Materials/Product/Unit of Measure': 'Set',
      'Raw Materials/Initial Demand': 3.375,
    },
  ];

  for (const bookType of ['biff8', 'xlsx'] as XLSX.BookType[]) {
    const ext = bookType === 'biff8' ? 'xls' : 'xlsx';
    const buf = createExcelBufferFromRows(rows, bookType);
    const parsed = parseScheduleExcelBuffer(buf, `mrp.production (9).${ext}`);

    // Header info strictly from Source / Reference / Style List/Display Name / Quantity To Produce
    assert.equal(parsed.orNumber, '1036');
    assert.equal(parsed.rawSource, 'OR/2026/06/1036');
    assert.equal(parsed.productionNumber, 'WH/MO/22743');
    assert.equal(parsed.style, 'JACKET WINDBREAKER NAVY');
    assert.equal(parsed.target, 1250);
    assert.equal(parsed.needsReview, false);

    // Row 0 material is included + duplicate FAB-001 rows remain separate (5 total rows)
    assert.equal(parsed.materials.length, 5);
    assert.deepEqual(
      parsed.materials.map((m) => m.materialCode),
      ['FAB-001', 'THR-002', 'BTN-003', 'LBL-004', 'FAB-001']
    );

    // Exact verbatim units (no kg fallback, no case normalization)
    assert.deepEqual(
      parsed.materials.map((m) => m.unit),
      ['yard', 'CNS', 'Pcs', 'Rol', 'Set']
    );

    // Exact unrounded decimal precision
    assert.equal(parsed.materials[0].total, 104.9165);
    assert.equal(parsed.materials[1].total, 0.125);
    assert.equal(parsed.materials[2].total, 2500);
    assert.equal(parsed.materials[3].total, 12.5);
    assert.equal(parsed.materials[4].total, 3.375);

    assert.equal(formatPpicNumber(parsed.materials[0].total), '104,9165');
    assert.equal(formatPpicNumber(parsed.materials[1].total), '0,125');
  }
});

test('8. Multiple Excel files are parsed independently (1 file = 1 schedule) without cross-contamination', () => {
  const file1Buf = createExcelBufferFromRows([
    {
      Source: 'OR/2026/06/1036',
      Reference: 'WH/MO/22743',
      'Style List/Display Name': 'STYLE A',
      'Quantity To Produce': 1000,
      'Raw Materials/Product/Internal Reference': 'MAT-A1',
      'Raw Materials/Product/Display Name': 'Material A1',
      'Raw Materials/Product/Unit of Measure': 'yard',
      'Raw Materials/Initial Demand': 250.5,
    },
  ]);

  const file2Buf = createExcelBufferFromRows([
    {
      Source: 'OR/2026/06/1041',
      Reference: 'WH/MO/22744',
      'Style List/Display Name': 'STYLE B',
      'Quantity To Produce': 750,
      'Raw Materials/Product/Internal Reference': 'MAT-B1',
      'Raw Materials/Product/Display Name': 'Material B1',
      'Raw Materials/Product/Unit of Measure': 'CNS',
      'Raw Materials/Initial Demand': 15.25,
    },
  ]);

  const parsed1 = parseScheduleExcelBuffer(file1Buf, 'schedule_1.xls');
  const parsed2 = parseScheduleExcelBuffer(file2Buf, 'schedule_2.xls');

  assert.equal(parsed1.orNumber, '1036');
  assert.equal(parsed1.productionNumber, 'WH/MO/22743');
  assert.equal(parsed1.materials.length, 1);
  assert.equal(parsed1.materials[0].materialCode, 'MAT-A1');

  assert.equal(parsed2.orNumber, '1041');
  assert.equal(parsed2.productionNumber, 'WH/MO/22744');
  assert.equal(parsed2.materials.length, 1);
  assert.equal(parsed2.materials[0].materialCode, 'MAT-B1');
});

test('9. Manual production start & finish dates validation and Excel comma decimals', () => {
  assert.equal(isFinishBeforeStart('2026-06-14', '2026-06-10'), true);
  assert.equal(isFinishBeforeStart('2026-06-10', '2026-06-14'), false);
  assert.equal(isFinishBeforeStart('2026-06-14', '2026-06-14'), false);

  const parsedComma = parseScheduleExcelRows(
    [
      {
        Source: 'PO/REF-999/OR/1055',
        Reference: 'WH/MO/22999',
        'Style List/Display Name': 'VEST OUTDOOR',
        'Quantity To Produce': '1.500',
        'Raw Materials/Product/Internal Reference': 'ZIP-09',
        'Raw Materials/Product/Display Name': 'YKK Zipper',
        'Raw Materials/Product/Unit of Measure': 'Pcs',
        'Raw Materials/Initial Demand': '104,9165',
      },
    ],
    'comma.xls'
  );

  assert.equal(parsedComma.orNumber, '1055');
  assert.equal(parsedComma.productionNumber, 'WH/MO/22999');
  assert.equal(parsedComma.target, 1500);
  assert.equal(parsedComma.materials[0].total, 104.9165);
});

test('10-11. Master Data matching via Nomor OR + Kode Material from ONLY latest upload, frozen snapshot, and safe Refresh', () => {
  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'upl-old',
      orNumber: '1036',
      style: 'JACKET WINDBREAKER NAVY',
      fileName: 'old_upload.xlsx',
      updateDate: '2026-06-01',
      uploadTime: '09:00:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: '2026-06-01T02:00:00.000Z',
    },
    {
      id: 'upl-latest',
      orNumber: '1036',
      style: 'JACKET WINDBREAKER NAVY',
      fileName: 'latest_upload.xlsx',
      updateDate: '2026-06-05',
      uploadTime: '14:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-06-05T07:00:00.000Z',
    },
    {
      id: 'upl-other-or',
      orNumber: '9999',
      style: 'OTHER STYLE',
      fileName: 'other.xlsx',
      updateDate: '2026-06-06',
      uploadTime: '10:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-06-06T03:00:00.000Z',
    },
  ];

  const initialMasterReqs: MaterialItemRequirement[] = [
    // Old upload has BOTH FAB-001 and THR-002
    {
      id: 'req-old-1',
      uploadId: 'upl-old',
      orNumber: '1036',
      style: 'JACKET WINDBREAKER NAVY',
      materialCode: 'FAB-001',
      materialName: 'Nylon Ripstop Navy',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 100,
      receivedQty: 100,
      unitPrice: 0,
      updateDate: '2026-06-01',
      createdAt: '2026-06-01T02:00:00.000Z',
    },
    {
      id: 'req-old-2',
      uploadId: 'upl-old',
      orNumber: '1036',
      style: 'JACKET WINDBREAKER NAVY',
      materialCode: 'THR-002',
      materialName: 'Benang Jahit Poly',
      category: 'Auxiliary',
      unit: 'CNS',
      requiredQty: 10,
      receivedQty: 10,
      unitPrice: 0,
      updateDate: '2026-06-01',
      createdAt: '2026-06-01T02:00:00.000Z',
    },
    // Latest upload for OR 1036 has ONLY FAB-001 (partial received -> BELUM READY), THR-002 removed -> must NOT fall back to upl-old!
    {
      id: 'req-new-1',
      uploadId: 'upl-latest',
      orNumber: '1036',
      style: 'JACKET WINDBREAKER NAVY',
      materialCode: 'FAB-001',
      materialName: 'Nylon Ripstop Navy',
      category: 'Raw Material',
      unit: 'yard',
      requiredQty: 104.9165,
      receivedQty: 80.5,
      unitPrice: 0,
      updateDate: '2026-06-05',
      createdAt: '2026-06-05T07:00:00.000Z',
    },
    // Different OR has THR-002 -> must NEVER match OR 1036
    {
      id: 'req-other-1',
      uploadId: 'upl-other-or',
      orNumber: '9999',
      style: 'OTHER STYLE',
      materialCode: 'THR-002',
      materialName: 'Benang Jahit Poly',
      category: 'Auxiliary',
      unit: 'CNS',
      requiredQty: 1,
      receivedQty: 1,
      unitPrice: 0,
      updateDate: '2026-06-06',
      createdAt: '2026-06-06T03:00:00.000Z',
    },
  ];

  const matched = matchMaterialsWithMasterData(
    [
      { materialCode: 'FAB-001', materialName: 'Nylon Ripstop Navy', unit: 'yard', total: 104.9165 },
      { materialCode: 'THR-002', materialName: 'Benang Jahit Poly', unit: 'CNS', total: 0.125 },
      { materialCode: 'FAB-001', materialName: 'Nylon Ripstop Navy (Cadangan)', unit: 'Set', total: 3.375 },
    ],
    '1036',
    initialMasterReqs,
    uploadHistory
  );

  // FAB-001 matched against upl-latest (80.5 < 104.9165 -> BELUM READY)
  assert.equal(matched[0].receivedQty, 80.5);
  assert.equal(matched[0].status, 'BELUM READY');
  assert.equal(matched[0].unit, 'yard');
  assert.equal(matched[0].total, 104.9165);

  // THR-002 not in upl-latest -> MUST be null ('-'), NO fallback to upl-old or OR 9999!
  assert.equal(matched[1].receivedQty, null);
  assert.equal(matched[1].status, null);
  assert.equal(matched[1].unit, 'CNS');

  // Duplicate FAB-001 row stays separate with its own unit 'Set' and total 3.375
  assert.equal(matched[2].receivedQty, 80.5);
  assert.equal(matched[2].status, 'BELUM READY');
  assert.equal(matched[2].unit, 'Set');
  assert.equal(matched[2].total, 3.375);

  const frozenSnapshot: WorksheetPdfItem = buildWorksheetSnapshot(
    {
      id: 'ws-1036',
      fileName: 'mrp.production (9).xls',
      orNumber: '1036',
      rawOrNumber: 'OR/2026/06/1036',
      worksheetNo: 'WH/MO/22743',
      style: 'JACKET WINDBREAKER NAVY',
      target: 1250,
      materials: matched.map((m, idx) => ({
        ...m,
        id: `wsm-${idx + 1}`,
        total: Number(m.total ?? 0),
      })),
    },
    initialMasterReqs,
    uploadHistory,
    '2026-06-05T08:00:00.000Z'
  );

  assert.equal(frozenSnapshot.worksheetNo, 'WH/MO/22743');
  assert.equal(frozenSnapshot.rawOrNumber, 'OR/2026/06/1036');
  assert.equal(frozenSnapshot.materials[0].receivedQty, 80.5);

  // Simulate newer upload arriving later in Master Data:
  const newerUploadHistory: UploadHistoryItem[] = [
    ...uploadHistory,
    {
      id: 'upl-newest',
      orNumber: '1036',
      style: 'JACKET WINDBREAKER NAVY',
      fileName: 'newest_upload.xlsx',
      updateDate: '2026-06-10',
      uploadTime: '09:00:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: '2026-06-10T02:00:00.000Z',
    },
  ];
  const newerMasterReqs: MaterialItemRequirement[] = [
    ...initialMasterReqs,
    {
      id: 'req-newest-1',
      uploadId: 'upl-newest',
      orNumber: '1036',
      style: 'JACKET WINDBREAKER NAVY',
      materialCode: 'FAB-001',
      materialName: 'CHANGED MASTER NAME SHOULD NOT OVERWRITE EXCEL',
      category: 'Raw Material',
      unit: 'Kg',
      requiredQty: 104.9165,
      receivedQty: 110,
      unitPrice: 0,
      updateDate: '2026-06-10',
      createdAt: '2026-06-10T02:00:00.000Z',
    },
  ];

  // Before Refresh, frozenSnapshot stays untouched
  assert.equal(frozenSnapshot.materials[0].receivedQty, 80.5);
  assert.equal(frozenSnapshot.materials[0].status, 'BELUM READY');

  // After Refresh, ONLY Diterima & Status Kesiapan update; Excel source fields remain verbatim!
  const refreshed = refreshScheduleWorksheetsSnapshot(
    [frozenSnapshot],
    newerMasterReqs,
    newerUploadHistory,
    '2026-06-10T03:00:00.000Z'
  );

  assert.equal(refreshed[0].orNumber, '1036');
  assert.equal(refreshed[0].worksheetNo, 'WH/MO/22743');
  assert.equal(refreshed[0].style, 'JACKET WINDBREAKER NAVY');
  assert.equal(refreshed[0].target, 1250);
  assert.equal(refreshed[0].materials[0].materialName, 'Nylon Ripstop Navy'); // NOT overwritten by Master Data name
  assert.equal(refreshed[0].materials[0].unit, 'yard'); // NOT overwritten by 'Kg'
  assert.equal(refreshed[0].materials[0].total, 104.9165); // NOT overwritten
  assert.equal(refreshed[0].materials[0].receivedQty, 110); // Updated!
  assert.equal(refreshed[0].materials[0].status, 'READY'); // Updated!
  assert.equal(refreshed[0].materials[1].receivedQty, null); // Still '-'
  assert.equal(refreshed[0].materials[1].status, null);
});

test('12. Supabase DB mapper & Atomic Snapshot Sync RPC payload preserve worksheetNo (Nomor Produksi), rawOrNumber, units, and decimals', () => {
  const schedule: ProductionSchedule = {
    id: '11111111-2222-4333-8444-555555555555',
    orNumber: '1036',
    productionDate: '2026-06-05',
    finishDate: '2026-06-14',
    productionLine: 'Produksi',
    style: 'JACKET WINDBREAKER NAVY',
    target: 1250,
    status: 'Terjadwal',
    worksheets: [
      {
        id: 'ws-excel-1',
        fileName: 'mrp.production (9).xls',
        orNumber: '1036',
        rawOrNumber: 'OR/2026/06/1036',
        worksheetNo: 'WH/MO/22743',
        style: 'JACKET WINDBREAKER NAVY',
        target: 1250,
        materials: [
          {
            id: 'wsm-1',
            materialCode: 'THR-002',
            materialName: 'Benang Jahit Poly',
            unit: 'CNS',
            total: 0.125,
            receivedQty: null,
            status: null,
            isFoundInMasterData: false,
          },
        ],
      },
    ],
  };

  const dbRow = mapModelToDbSchedule(schedule);
  const roundTrip = mapDbScheduleToModel(dbRow);

  assert.equal(roundTrip.orNumber, '1036');
  assert.equal(roundTrip.productionDate, '2026-06-05');
  assert.equal(roundTrip.finishDate, '2026-06-14');
  assert.equal(roundTrip.worksheets?.[0]?.worksheetNo, 'WH/MO/22743');
  assert.equal(roundTrip.worksheets?.[0]?.rawOrNumber, 'OR/2026/06/1036');
  assert.equal(roundTrip.worksheets?.[0]?.materials[0].unit, 'CNS');
  assert.equal(roundTrip.worksheets?.[0]?.materials[0].total, 0.125);
  assert.equal(roundTrip.worksheets?.[0]?.materials[0].receivedQty, null);

  const rpcPayload = buildAtomicSnapshotSyncPayload(schedule.id, schedule, safeDbDate);
  assert.equal(rpcPayload.success, true);
  if (rpcPayload.success) {
    assert.equal(rpcPayload.payload.p_worksheets_snapshot[0].worksheetNo, 'WH/MO/22743');
    assert.equal(rpcPayload.payload.p_worksheets_snapshot[0].materials[0].total, 0.125);
    assert.equal(rpcPayload.payload.p_worksheets_snapshot[0].materials[0].unit, 'CNS');
  }
});

test('13. Recognizes Odoo UoM column aliases, hidden zero-width chars, leading title rows, ignores Routing, and never defaults missing UoM column', () => {
  // Case A: Odoo exports Raw Materials/Unit of Measure directly on stock.move (plus Routing column which must be ignored)
  const aoaWithTitleAndAlias = [
    ['MRP PRODUCTION EXPORT', null, null],
    [],
    [
      'Source\u200B',
      'Reference',
      'Style List/Display Name',
      'Quantity To Produce',
      'Routing',
      'Raw Materials/Product/Internal Reference',
      'Raw Materials/Product/Display Name',
      'Raw Materials/Unit of Measure',
      'Raw Materials/Initial Demand',
    ],
    [
      'OR/2026/08/1090',
      'WH/MO/22810',
      'OUTDOOR PARKA',
      900,
      'Routing Line A',
      'ZIP-88',
      'Resleting YKK',
      'Gros',
      12.5,
    ],
  ];
  const wsA = XLSX.utils.aoa_to_sheet(aoaWithTitleAndAlias);
  const wbA = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbA, wsA, 'Sheet1');
  const bufA = XLSX.write(wbA, { type: 'array', bookType: 'biff8' }) as Uint8Array;

  const parsedA = parseScheduleExcelBuffer(bufA, 'odoo_uom_alias.xls');
  assert.equal(parsedA.orNumber, '1090');
  assert.equal(parsedA.productionNumber, 'WH/MO/22810');
  assert.equal(parsedA.style, 'OUTDOOR PARKA');
  assert.equal(parsedA.target, 900);
  assert.equal(parsedA.materials[0].unit, 'Gros');
  assert.equal(parsedA.materials[0].total, 12.5);

  // Case B: Raw Materials/Product/Unit of Measure/Display Name
  const bufB = createExcelBufferFromRows([
    {
      Source: 'OR/2026/08/1091',
      Reference: 'WH/MO/22811',
      'Style List/Display Name': 'CARGO PANT',
      'Quantity To Produce': 500,
      'Raw Materials/Product/Internal Reference': 'BTN-10',
      'Raw Materials/Product/Display Name': 'Kancing Logam',
      'Raw Materials/Product/Unit of Measure/Display Name': 'Pcs',
      'Raw Materials/Initial Demand': 1500,
    },
  ]);
  const parsedB = parseScheduleExcelBuffer(bufB, 'odoo_uom_display_name.xlsx');
  assert.equal(parsedB.materials[0].unit, 'Pcs');

  // Case C: Missing UoM column must still fail validation loudly (never default to Kg)
  const bufMissing = createExcelBufferFromRows([
    {
      Source: 'OR/2026/08/1092',
      Reference: 'WH/MO/22812',
      'Style List/Display Name': 'INVALID FILE',
      'Quantity To Produce': 100,
      'Raw Materials/Product/Internal Reference': 'MAT-1',
      'Raw Materials/Product/Display Name': 'Sample Material',
      'Raw Materials/Initial Demand': 50,
    },
  ]);
  assert.throws(
    () => parseScheduleExcelBuffer(bufMissing, 'missing_uom.xlsx'),
    /Kolom wajib tidak ditemukan: Raw Materials\/Product\/Unit of Measure/
  );
});

test('14. matchMaterialsWithMasterData does NOT merge/sum duplicate Master Data material codes with differing readiness', () => {
  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'upl-dup-latest',
      orNumber: '1044',
      style: 'JACKET MULTI-TRIM',
      fileName: 'master_1044.xlsx',
      updateDate: '2026-07-10',
      uploadTime: '10:00:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: '2026-07-10T03:00:00.000Z',
    },
  ];

  // Two Master Data rows with identical code TRM-01 but DIFFERENT Kebutuhan/Diterima/Status:
  // Row 1: Kebutuhan 500, Diterima 500 -> READY
  // Row 2: Kebutuhan 300, Diterima 100 -> BELUM READY
  // Previous bug summed them (800 req vs 600 rec) and marked BOTH BELUM READY with receivedQty=600!
  const masterReqs: MaterialItemRequirement[] = [
    {
      id: 'req-dup-1',
      uploadId: 'upl-dup-latest',
      orNumber: '1044',
      style: 'JACKET MULTI-TRIM',
      materialCode: 'TRM-01',
      materialName: 'Trim Ribbon Hitam',
      category: 'Auxiliary',
      unit: 'Yard',
      requiredQty: 500,
      receivedQty: 500,
      unitPrice: 0,
      updateDate: '2026-07-10',
      createdAt: '2026-07-10T03:00:00.000Z',
    },
    {
      id: 'req-dup-2',
      uploadId: 'upl-dup-latest',
      orNumber: '1044',
      style: 'JACKET MULTI-TRIM',
      materialCode: 'TRM-01',
      materialName: 'Trim Ribbon Hitam',
      category: 'Auxiliary',
      unit: 'Yard',
      requiredQty: 300,
      receivedQty: 100,
      unitPrice: 0,
      updateDate: '2026-07-10',
      createdAt: '2026-07-10T03:00:00.000Z',
    },
  ];

  const matched = matchMaterialsWithMasterData(
    [
      { materialCode: 'TRM-01', materialName: 'Trim Ribbon Hitam', unit: 'Yard', total: 500 },
      { materialCode: 'TRM-01', materialName: 'Trim Ribbon Hitam', unit: 'Yard', total: 300 },
      { materialCode: 'TRM-01', materialName: 'Trim Ribbon Hitam (Extra)', unit: 'Yard', total: 50 },
    ],
    '1044',
    masterReqs,
    uploadHistory
  );

  assert.equal(matched.length, 3);
  assert.equal(matched[0].receivedQty, 500);
  assert.equal(matched[0].status, 'READY');
  assert.equal(matched[1].receivedQty, 100);
  assert.equal(matched[1].status, 'BELUM READY');
  // 3rd duplicate Schedule row has no remaining Master Data candidate -> must stay null ('-') rather than double-counting!
  assert.equal(matched[2].receivedQty, null);
  assert.equal(matched[2].status, null);
  assert.equal(matched[2].isFoundInMasterData, false);
});

