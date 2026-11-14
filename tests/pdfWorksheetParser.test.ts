import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractOrNumberFromIdentifier,
  areOrNumbersMatching,
  parseWorksheetText,
  matchMaterialsWithMasterData,
  findLatestUploadForOr,
  buildWorksheetSnapshot,
  refreshScheduleWorksheetsSnapshot,
  ExtractedWorksheetMaterial,
} from '../src/utils/pdfWorksheetParser';
import {
  MaterialItemRequirement,
  UploadHistoryItem,
  WorksheetPdfItem,
} from '../src/types/ppic';

test('1. Ekstraksi No. OR empat digit setelah slash terakhir', () => {
  assert.equal(extractOrNumberFromIdentifier('OR/2026/09/1117'), '1117');
  assert.equal(extractOrNumberFromIdentifier('OR/1117'), '1117');
  assert.equal(extractOrNumberFromIdentifier('1117'), '1117');
  assert.equal(extractOrNumberFromIdentifier('ORDER/BATCH/2026/1120'), '1120');
});

test('2. Matching No. OR fleksibel dan aman antar-format', () => {
  assert.equal(areOrNumbersMatching('1117', 'OR/2026/09/1117'), true);
  assert.equal(areOrNumbersMatching('OR/2026/09/1117', '1117'), true);
  assert.equal(areOrNumbersMatching('1117', '1117'), true);
  assert.equal(areOrNumbersMatching('1117', '1118'), false);
  assert.equal(areOrNumbersMatching('OR/2026/09/1117', 'OR/2026/09/1118'), false);
});

test('3. Ekstraksi Informasi Produksi (No. OR, Style, Target) & 4 Kolom Material', () => {
  const sampleWorksheetText = `
PT. GARMENT NUSANTARA JAYA
WORKSHEET PRODUKSI
NO. OR : OR/2026/09/1117
STYLE : Polo Shirt Dry-Fit Men Navy
TOTAL QTY : 74 PCS

TABEL MATERIAL & KONSUMSI:
NO\tCODE ACC\tDESCRIPTION\tCONS\tUNIT\tTOTAL
1\tFAB-COT-30S\tKAIN DRY FIT NAVY\t1.2\tMTR\t88.8
2\tACC-BTN-01\tKANCING 3 HOLE NAVY\t3\tPCS\t222
3\tACC-LBL-01\tLABEL SIZE M\t1\tPCS\t74

CATATAN:
Harap perhatikan toleransi susut kain.
`;

  const parsed = parseWorksheetText(sampleWorksheetText, 'Worksheet_1117.pdf');
  assert.equal(parsed.success, true);
  assert.ok(parsed.data);

  // Informasi Produksi
  assert.equal(parsed.data.orNumber, '1117');
  assert.equal(parsed.data.style, 'Polo Shirt Dry-Fit Men Navy');
  assert.equal(parsed.data.target, 74);

  // 4 Kolom Material (CODE ACC, DESCRIPTION, UNIT, TOTAL)
  assert.equal(parsed.data.materials.length, 3);
  assert.equal(parsed.data.materials[0].materialCode, 'FAB-COT-30S');
  assert.equal(parsed.data.materials[0].materialName, 'KAIN DRY FIT NAVY');
  assert.equal(parsed.data.materials[0].unit, 'MTR');
  assert.equal(parsed.data.materials[0].total, 88.8);

  assert.equal(parsed.data.materials[1].materialCode, 'ACC-BTN-01');
  assert.equal(parsed.data.materials[1].total, 222);
});

test('4. Kode Material Duplikat dalam satu PDF tetap sebagai baris terpisah (tidak digabung)', () => {
  const sampleWithDuplicates = `
OR : OR/2026/09/1117
STYLE : Casual Jacket Bomber
TOTAL QTY : 120

MATERIAL & KONSUMSI
CODE ACC\tDESCRIPTION\tCONS\tUNIT\tTOTAL
ZIP-CHC-26\tZIPPER FRONT CHC 26\t1\tPCS\t120
ZIP-CHC-26\tZIPPER POCKET CHC 26\t2\tPCS\t240
THD-POLY-01\tBENANG JAHIT NAVY\t1\tCONE\t15

APPROVED BY: Production Manager
`;

  const parsed = parseWorksheetText(sampleWithDuplicates, 'Worksheet_Jacket.pdf');
  assert.equal(parsed.success, true);
  assert.ok(parsed.data);

  // Dua baris dengan kode ZIP-CHC-26 harus tetap terpisah
  assert.equal(parsed.data.materials.length, 3);
  assert.equal(parsed.data.materials[0].materialCode, 'ZIP-CHC-26');
  assert.equal(parsed.data.materials[0].total, 120);
  assert.equal(parsed.data.materials[1].materialCode, 'ZIP-CHC-26');
  assert.equal(parsed.data.materials[1].total, 240);
  assert.notEqual(parsed.data.materials[0].total, parsed.data.materials[1].total);
});

test('5. Pencocokan dengan Master Data berdasarkan No. OR dan Kode Material', () => {
  const extractedMaterials: ExtractedWorksheetMaterial[] = [
    { materialCode: 'FAB-COT-30S', materialName: 'KAIN DRY FIT NAVY', unit: 'MTR', total: 88.8 },
    { materialCode: 'ACC-BTN-01', materialName: 'KANCING 3 HOLE NAVY', unit: 'PCS', total: 222 },
    { materialCode: 'SPECIAL-THREAD-X', materialName: 'BENANG KHUSUS EMAS', unit: 'ROLL', total: 5 },
  ];

  const masterRequirements: MaterialItemRequirement[] = [
    // Material OR 1117 (cocok dan READY)
    {
      id: 'mr-1',
      orNumber: 'OR/2026/09/1117',
      style: 'Polo Shirt',
      materialCode: 'FAB-COT-30S',
      materialName: 'KAIN DRY FIT NAVY',
      category: 'Raw Material',
      unit: 'MTR' as any,
      requiredQty: 88.8,
      receivedQty: 100, // received >= required -> READY
      unitPrice: 35000,
    },
    // Material OR 1117 (cocok dan BELUM READY)
    {
      id: 'mr-2',
      orNumber: '1117',
      style: 'Polo Shirt',
      materialCode: 'ACC-BTN-01',
      materialName: 'KANCING 3 HOLE NAVY',
      category: 'Auxiliary',
      unit: 'PCS' as any,
      requiredQty: 222,
      receivedQty: 150, // received < required -> BELUM READY
      unitPrice: 500,
    },
    // Material di OR lain (OR 1118) dengan kode sama persis 'SPECIAL-THREAD-X'
    // WAJIB TIDAK BOLEH DIAMBIL UNTUK OR 1117!
    {
      id: 'mr-3',
      orNumber: 'OR/2026/09/1118',
      style: 'Other Style',
      materialCode: 'SPECIAL-THREAD-X',
      materialName: 'BENANG KHUSUS EMAS',
      category: 'Auxiliary',
      unit: 'ROLL' as any,
      requiredQty: 10,
      receivedQty: 10,
      unitPrice: 50000,
    },
  ];

  const matched = matchMaterialsWithMasterData(extractedMaterials, '1117', masterRequirements);
  assert.equal(matched.length, 3);

  // Item 1: Ditemukan di OR 1117 -> receivedQty: 100, status: 'READY'
  assert.equal(matched[0].materialCode, 'FAB-COT-30S');
  assert.equal(matched[0].receivedQty, 100);
  assert.equal(matched[0].status, 'READY');
  assert.equal(matched[0].isFoundInMasterData, true);

  // Item 2: Ditemukan di OR 1117 -> receivedQty: 150, status: 'BELUM READY'
  assert.equal(matched[1].materialCode, 'ACC-BTN-01');
  assert.equal(matched[1].receivedQty, 150);
  assert.equal(matched[1].status, 'BELUM READY');
  assert.equal(matched[1].isFoundInMasterData, true);

  // Item 3: SPECIAL-THREAD-X hanya ada di OR 1118, TIDAK ADA di OR 1117!
  // Maka receivedQty: null ('-'), status: null ('-')
  assert.equal(matched[2].materialCode, 'SPECIAL-THREAD-X');
  assert.equal(matched[2].receivedQty, null);
  assert.equal(matched[2].status, null);
  assert.equal(matched[2].isFoundInMasterData, false);
});

test('6. Penanganan Galat jika komponen wajib pada PDF tidak ditemukan', () => {
  // Tanpa No. OR
  const noOrText = 'STYLE: T-Shirt\nTOTAL QTY: 50\nMATERIAL & KONSUMSI\nFAB-01 Kain 1 YDS 50';
  const resNoOr = parseWorksheetText(noOrText, 'NoOr.pdf');
  assert.equal(resNoOr.success, false);
  assert.match(resNoOr.error || '', /No\. OR tidak ditemukan/i);

  // Tanpa Style
  const noStyleText = 'NO. OR: 1117\nTOTAL QTY: 50\nMATERIAL & KONSUMSI\nFAB-01 Kain 1 YDS 50';
  const resNoStyle = parseWorksheetText(noStyleText, 'NoStyle.pdf');
  assert.equal(resNoStyle.success, false);
  assert.match(resNoStyle.error || '', /Style tidak berhasil diekstrak/i);

  // Tanpa Target
  const noQtyText = 'NO. OR: 1117\nSTYLE: Shirt\nMATERIAL & KONSUMSI\nFAB-01 Kain 1 YDS 50';
  const resNoQty = parseWorksheetText(noQtyText, 'NoQty.pdf');
  assert.equal(resNoQty.success, false);
  assert.match(resNoQty.error || '', /Total Qty/i);

  // Tanpa Tabel
  const noTableText = 'NO. OR: 1117\nSTYLE: Shirt\nTOTAL QTY: 50\nCatatan Tambahan';
  const resNoTable = parseWorksheetText(noTableText, 'NoTable.pdf');
  assert.equal(resNoTable.success, false);
  assert.match(resNoTable.error || '', /MATERIAL & KONSUMSI/i);
});

test('7. Multi-PDF: Simulasi 4 PDF dalam 1 jadwal dengan variasi OR & Style', () => {
  const pdf1 = parseWorksheetText(`NO. OR: OR/2026/09/1117\nSTYLE: Style A\nTOTAL QTY: 74\nMATERIAL & KONSUMSI\nMAT-A Fabric A 1 MTR 74\nNOTES: Done`, 'pdf1.pdf');
  const pdf2 = parseWorksheetText(`NO. OR: 1117\nSTYLE: Style B\nTOTAL QTY: 120\nMATERIAL & KONSUMSI\nMAT-B Fabric B 1 MTR 120\nNOTES: Done`, 'pdf2.pdf');
  const pdf3 = parseWorksheetText(`NO. OR: OR/2026/09/1118\nSTYLE: Style C\nTOTAL QTY: 85\nMATERIAL & KONSUMSI\nMAT-C Fabric C 1 MTR 85\nNOTES: Done`, 'pdf3.pdf');
  const pdf4 = parseWorksheetText(`NO. OR: 1120\nSTYLE: Style D\nTOTAL QTY: 60\nMATERIAL & KONSUMSI\nMAT-D Fabric D 1 MTR 60\nNOTES: Done`, 'pdf4.pdf');

  assert.equal(pdf1.success, true);
  assert.equal(pdf2.success, true);
  assert.equal(pdf3.success, true);
  assert.equal(pdf4.success, true);

  assert.equal(pdf1.data?.orNumber, '1117');
  assert.equal(pdf1.data?.style, 'Style A');
  assert.equal(pdf1.data?.target, 74);

  assert.equal(pdf2.data?.orNumber, '1117');
  assert.equal(pdf2.data?.style, 'Style B');
  assert.equal(pdf2.data?.target, 120);

  assert.equal(pdf3.data?.orNumber, '1118');
  assert.equal(pdf3.data?.style, 'Style C');
  assert.equal(pdf3.data?.target, 85);

  assert.equal(pdf4.data?.orNumber, '1120');
  assert.equal(pdf4.data?.style, 'Style D');
  assert.equal(pdf4.data?.target, 60);

  // Total Target gabungan seluruh PDF dalam jadwal
  const totalCombinedTarget = (pdf1.data?.target || 0) + (pdf2.data?.target || 0) + (pdf3.data?.target || 0) + (pdf4.data?.target || 0);
  assert.equal(totalCombinedTarget, 339);
});

test('8. Skenario 1 & 2: Upload Excel Paling Terbaru Per No. OR (Tanpa Tanggal Global, Tanpa Fallback ke Upload Lama)', () => {
  const uploadHistory: UploadHistoryItem[] = [
    // OR 1117 punya 3 riwayat upload: 10 Nov, 12 Nov, 13 Nov (terbaru: up-1117-nov13)
    {
      id: 'up-1117-nov10',
      orNumber: 'OR/2026/09/1117',
      style: 'Polo Shirt',
      fileName: 'OR1117_10Nov.xlsx',
      updateDate: '2026-11-10',
      uploadTime: '09:00:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: '2026-11-10T02:00:00Z',
    },
    {
      id: 'up-1117-nov12',
      orNumber: '1117',
      style: 'Polo Shirt',
      fileName: 'OR1117_12Nov.xlsx',
      updateDate: '2026-11-12',
      uploadTime: '10:00:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: '2026-11-12T03:00:00Z',
    },
    {
      id: 'up-1117-nov13',
      orNumber: 'OR/2026/09/1117',
      style: 'Polo Shirt',
      fileName: 'OR1117_13Nov.xlsx',
      updateDate: '2026-11-13',
      uploadTime: '14:15:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-13T07:15:00Z',
    },
    // OR 1118 punya 2 riwayat upload: 9 Nov, 11 Nov (terbaru: up-1118-nov11, berbeda tanggal dengan 1117!)
    {
      id: 'up-1118-nov09',
      orNumber: 'OR/2026/09/1118',
      style: 'Hoodie',
      fileName: 'OR1118_09Nov.xlsx',
      updateDate: '2026-11-09',
      uploadTime: '08:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-09T01:00:00Z',
    },
    {
      id: 'up-1118-nov11',
      orNumber: '1118',
      style: 'Hoodie',
      fileName: 'OR1118_11Nov.xlsx',
      updateDate: '2026-11-11',
      uploadTime: '16:30:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-11T09:30:00Z',
    },
    // Upload gagal pada tanggal lebih baru harus diabaikan
    {
      id: 'up-1118-failed',
      orNumber: '1118',
      style: 'Hoodie',
      fileName: 'OR1118_14Nov_Failed.xlsx',
      updateDate: '2026-11-14',
      uploadTime: '08:00:00 WIB',
      rowCount: 0,
      status: 'Gagal',
      createdAt: '2026-11-14T01:00:00Z',
    },
  ];

  const masterRequirements: MaterialItemRequirement[] = [
    // OR 1117 - Upload lama 10 Nov
    {
      id: 'req-1117-old1',
      uploadId: 'up-1117-nov10',
      orNumber: '1117',
      style: 'Polo Shirt',
      materialCode: 'MAT-01',
      materialName: 'Fabric Cotton',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 100,
      receivedQty: 10,
      unitPrice: 50000,
      updateDate: '2026-11-10',
      createdAt: '2026-11-10T02:00:00Z',
    },
    // OR 1117 - Upload lama 12 Nov (punya MAT-LEGACY yang nanti hilang di 13 Nov)
    {
      id: 'req-1117-old2',
      uploadId: 'up-1117-nov12',
      orNumber: '1117',
      style: 'Polo Shirt',
      materialCode: 'MAT-01',
      materialName: 'Fabric Cotton',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 100,
      receivedQty: 50,
      unitPrice: 50000,
      updateDate: '2026-11-12',
      createdAt: '2026-11-12T03:00:00Z',
    },
    {
      id: 'req-1117-old-legacy',
      uploadId: 'up-1117-nov12',
      orNumber: '1117',
      style: 'Polo Shirt',
      materialCode: 'MAT-LEGACY',
      materialName: 'Old Trim Only in 12 Nov',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 200,
      receivedQty: 200,
      unitPrice: 1000,
      updateDate: '2026-11-12',
      createdAt: '2026-11-12T03:00:00Z',
    },
    // OR 1117 - Upload TERBARU 13 Nov (hanya ada MAT-01 dengan received 100 READY; MAT-LEGACY TIDAK ADA)
    {
      id: 'req-1117-new1',
      uploadId: 'up-1117-nov13',
      orNumber: 'OR/2026/09/1117',
      style: 'Polo Shirt',
      materialCode: 'MAT-01',
      materialName: 'Fabric Cotton',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 100,
      receivedQty: 100,
      unitPrice: 50000,
      updateDate: '2026-11-13',
      createdAt: '2026-11-13T07:15:00Z',
    },
    // OR 1118 - Upload lama 9 Nov
    {
      id: 'req-1118-old1',
      uploadId: 'up-1118-nov09',
      orNumber: '1118',
      style: 'Hoodie',
      materialCode: 'MAT-01',
      materialName: 'Fabric Fleece',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 300,
      receivedQty: 300,
      unitPrice: 60000,
      updateDate: '2026-11-09',
      createdAt: '2026-11-09T01:00:00Z',
    },
    // OR 1118 - Upload TERBARU 11 Nov (received 120 < 300 -> BELUM READY)
    {
      id: 'req-1118-new1',
      uploadId: 'up-1118-nov11',
      orNumber: '1118',
      style: 'Hoodie',
      materialCode: 'MAT-01',
      materialName: 'Fabric Fleece',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 300,
      receivedQty: 120,
      unitPrice: 60000,
      updateDate: '2026-11-11',
      createdAt: '2026-11-11T09:30:00Z',
    },
  ];

  // Resolusi independen per OR
  const res1117 = findLatestUploadForOr('1117', masterRequirements, uploadHistory);
  const res1118 = findLatestUploadForOr('1118', masterRequirements, uploadHistory);
  assert.equal(res1117.latestUpload?.id, 'up-1117-nov13');
  assert.equal(res1118.latestUpload?.id, 'up-1118-nov11');

  // Matching OR 1117: MAT-01 ambil dari 13 Nov (100 READY, BUKAN 10+50+100), MAT-LEGACY harus '-' (TIDAK fallback ke 12 Nov!)
  const matched1117 = matchMaterialsWithMasterData(
    [
      { materialCode: 'MAT-01', materialName: 'Fabric Cotton', unit: 'Yard', total: 100 },
      { materialCode: 'MAT-LEGACY', materialName: 'Old Trim Only in 12 Nov', unit: 'Pcs', total: 200 },
    ],
    '1117',
    masterRequirements,
    uploadHistory
  );

  assert.equal(matched1117[0].receivedQty, 100);
  assert.equal(matched1117[0].status, 'READY');
  assert.equal(matched1117[0].matchedUploadId, 'up-1117-nov13');
  assert.equal(matched1117[0].matchedUploadDate, '2026-11-13');

  assert.equal(matched1117[1].receivedQty, null, 'Material yg hanya ada di upload lama (12 Nov) TIDAK boleh fallback');
  assert.equal(matched1117[1].status, null, 'Status harus "-" (null), bukan BELUM READY');
  assert.equal(matched1117[1].isFoundInMasterData, false);

  // Matching OR 1118 dengan Kode Material SAMA ('MAT-01'): harus ambil 11 Nov (120 BELUM READY), terisolasi dari OR 1117!
  const matched1118 = matchMaterialsWithMasterData(
    [{ materialCode: 'MAT-01', materialName: 'Fabric Fleece', unit: 'Yard', total: 300 }],
    '1118',
    masterRequirements,
    uploadHistory
  );

  assert.equal(matched1118[0].receivedQty, 120);
  assert.equal(matched1118[0].status, 'BELUM READY');
  assert.equal(matched1118[0].matchedUploadId, 'up-1118-nov11');
  assert.equal(matched1118[0].matchedUploadDate, '2026-11-11');
});

test('9. Skenario 5 & 6: Multi-PDF dalam 1 Jadwal (OR Sama & OR Berbeda dengan Kode Material Identik)', () => {
  const uploadHistory: UploadHistoryItem[] = [
    {
      id: 'up-A-latest',
      orNumber: '2001',
      style: 'Style A',
      fileName: 'OR2001.xlsx',
      updateDate: '2026-11-13',
      uploadTime: '08:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-13T01:00:00Z',
    },
    {
      id: 'up-B-latest',
      orNumber: '2002',
      style: 'Style B',
      fileName: 'OR2002.xlsx',
      updateDate: '2026-11-13',
      uploadTime: '08:30:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-13T01:30:00Z',
    },
  ];

  const masterRequirements: MaterialItemRequirement[] = [
    {
      id: 'r-2001',
      uploadId: 'up-A-latest',
      orNumber: '2001',
      style: 'Style A',
      materialCode: 'SHARED-ZIP',
      materialName: 'ZIPPER #5 BLACK',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 500,
      receivedQty: 500, // READY di OR 2001
      unitPrice: 2500,
      updateDate: '2026-11-13',
    },
    {
      id: 'r-2002',
      uploadId: 'up-B-latest',
      orNumber: '2002',
      style: 'Style B',
      materialCode: 'SHARED-ZIP',
      materialName: 'ZIPPER #5 BLACK',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 400,
      receivedQty: 150, // BELUM READY di OR 2002
      unitPrice: 2500,
      updateDate: '2026-11-13',
    },
  ];

  const wsSameOr1: WorksheetPdfItem = {
    id: 'ws-1',
    fileName: 'PDF_1_OR2001.pdf',
    orNumber: '2001',
    style: 'Style A1',
    target: 200,
    materials: [{ materialCode: 'SHARED-ZIP', materialName: 'ZIPPER #5 BLACK', unit: 'Pcs', total: 200 }],
  };
  const wsSameOr2: WorksheetPdfItem = {
    id: 'ws-2',
    fileName: 'PDF_2_OR2001.pdf',
    orNumber: '2001',
    style: 'Style A2',
    target: 300,
    materials: [{ materialCode: 'SHARED-ZIP', materialName: 'ZIPPER #5 BLACK', unit: 'Pcs', total: 300 }],
  };
  const wsDiffOr3: WorksheetPdfItem = {
    id: 'ws-3',
    fileName: 'PDF_3_OR2002.pdf',
    orNumber: '2002',
    style: 'Style B1',
    target: 400,
    materials: [{ materialCode: 'SHARED-ZIP', materialName: 'ZIPPER #5 BLACK', unit: 'Pcs', total: 400 }],
  };

  const snap1 = buildWorksheetSnapshot(wsSameOr1, masterRequirements, uploadHistory);
  const snap2 = buildWorksheetSnapshot(wsSameOr2, masterRequirements, uploadHistory);
  const snap3 = buildWorksheetSnapshot(wsDiffOr3, masterRequirements, uploadHistory);

  // Dua PDF dengan OR sama tetap berdiri sendiri dengan PDF Total masing-masing (200 vs 300)
  assert.equal(snap1.materials[0].total, 200);
  assert.equal(snap2.materials[0].total, 300);
  assert.equal(snap1.materials[0].receivedQty, 500);
  assert.equal(snap2.materials[0].receivedQty, 500);
  assert.equal(snap1.materials[0].status, 'READY');
  assert.equal(snap2.materials[0].status, 'READY');

  // PDF OR 2002 dengan kode material sama persis terisolasi ke upload OR 2002 (150 BELUM READY)
  assert.equal(snap3.materials[0].total, 400);
  assert.equal(snap3.materials[0].receivedQty, 150);
  assert.equal(snap3.materials[0].status, 'BELUM READY');
  assert.equal(snap3.matchedUploadId, 'up-B-latest');
});

test('10. Skenario 8 & 9: Snapshot Tersimpan Tidak Berubah Otomatis + Manual Refresh Hanya Memperbarui Diterima/Status/Provenance', () => {
  const initialHistory: UploadHistoryItem[] = [
    {
      id: 'up-v1',
      orNumber: '3001',
      style: 'Jacket',
      fileName: 'Batch1.xlsx',
      updateDate: '2026-11-10',
      uploadTime: '09:00:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: '2026-11-10T02:00:00Z',
    },
  ];
  const initialReqs: MaterialItemRequirement[] = [
    {
      id: 'r-v1-a',
      uploadId: 'up-v1',
      orNumber: '3001',
      style: 'Jacket',
      materialCode: 'MAT-X',
      materialName: 'Canvas',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 100,
      receivedQty: 40, // BELUM READY pada saat jadwal disimpan
      unitPrice: 40000,
      updateDate: '2026-11-10',
    },
    {
      id: 'r-v1-b',
      uploadId: 'up-v1',
      orNumber: '3001',
      style: 'Jacket',
      materialCode: 'MAT-Y',
      materialName: 'Lining',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 100,
      receivedQty: 100, // READY pada saat jadwal disimpan
      unitPrice: 20000,
      updateDate: '2026-11-10',
    },
  ];

  const baseWs: WorksheetPdfItem = {
    id: 'ws-frozen-1',
    fileName: 'Worksheet_Jacket_3001.pdf',
    orNumber: '3001',
    style: 'Jacket Original PDF',
    target: 150,
    materials: [
      { materialCode: 'MAT-X', materialName: 'Canvas (Nama PDF)', unit: 'YDS', total: 100 },
      { materialCode: 'MAT-Y', materialName: 'Lining (Nama PDF)', unit: 'YDS', total: 100 },
    ],
  };

  // Simpan snapshot awal
  const savedSnapshot = buildWorksheetSnapshot(
    baseWs,
    initialReqs,
    initialHistory,
    '2026-11-10T03:00:00Z'
  );
  assert.equal(savedSnapshot.materials[0].receivedQty, 40);
  assert.equal(savedSnapshot.materials[0].status, 'BELUM READY');
  assert.equal(savedSnapshot.materials[1].receivedQty, 100);
  assert.equal(savedSnapshot.materials[1].status, 'READY');
  assert.equal(savedSnapshot.matchedUploadId, 'up-v1');

  // Simulasi: Upload Excel lama (up-v1) TERHAPUS oleh Rolling 4 Hari DAN ada upload baru (up-v2)
  // dimana MAT-X sekarang READY (100) tetapi MAT-Y tidak tercantum lagi di upload terbaru!
  const updatedHistory: UploadHistoryItem[] = [
    {
      id: 'up-v2',
      orNumber: '3001',
      style: 'Jacket',
      fileName: 'Batch2.xlsx',
      updateDate: '2026-11-15',
      uploadTime: '11:00:00 WIB',
      rowCount: 1,
      status: 'Sukses',
      createdAt: '2026-11-15T04:00:00Z',
    },
  ];
  const updatedReqs: MaterialItemRequirement[] = [
    {
      id: 'r-v2-a',
      uploadId: 'up-v2',
      orNumber: '3001',
      style: 'Jacket',
      materialCode: 'MAT-X',
      materialName: 'Canvas Master New Name',
      category: 'Raw Material',
      unit: 'Meter',
      requiredQty: 100,
      receivedQty: 100, // sekarang READY
      unitPrice: 40000,
      updateDate: '2026-11-15',
    },
  ];

  // Verifikasi snapshot tersimpan TIDAK berubah dengan sendirinya
  assert.equal(savedSnapshot.materials[0].receivedQty, 40);
  assert.equal(savedSnapshot.materials[0].status, 'BELUM READY');
  assert.equal(savedSnapshot.materials[1].receivedQty, 100);
  assert.equal(savedSnapshot.materials[1].status, 'READY');
  assert.equal(savedSnapshot.matchedUploadId, 'up-v1');

  // Jalankan Manual Refresh eksplisit oleh user
  const refreshedList = refreshScheduleWorksheetsSnapshot(
    [savedSnapshot],
    updatedReqs,
    updatedHistory,
    '2026-11-15T05:00:00Z'
  );
  const refreshed = refreshedList[0];

  // Field asli PDF WAJIB tetap utuh 100%
  assert.equal(refreshed.fileName, 'Worksheet_Jacket_3001.pdf');
  assert.equal(refreshed.orNumber, '3001');
  assert.equal(refreshed.style, 'Jacket Original PDF');
  assert.equal(refreshed.target, 150);
  assert.equal(refreshed.materials[0].materialName, 'Canvas (Nama PDF)');
  assert.equal(refreshed.materials[0].unit, 'YDS');
  assert.equal(refreshed.materials[0].total, 100);

  // Field hasil refresh:
  // 1) MAT-X terbarui ke upload terbaru up-v2 (100 READY)
  assert.equal(refreshed.matchedUploadId, 'up-v2');
  assert.equal(refreshed.matchedUploadDate, '2026-11-15');
  assert.equal(refreshed.lastSyncedAt, '2026-11-15T05:00:00Z');
  assert.equal(refreshed.materials[0].receivedQty, 100);
  assert.equal(refreshed.materials[0].status, 'READY');

  // 2) MAT-Y tidak ada di upload terbaru up-v2 -> harus menjadi '-' (null), tidak memakai nilai lama!
  assert.equal(refreshed.materials[1].receivedQty, null);
  assert.equal(refreshed.materials[1].status, null);
  assert.equal(refreshed.materials[1].isFoundInMasterData, false);
});

