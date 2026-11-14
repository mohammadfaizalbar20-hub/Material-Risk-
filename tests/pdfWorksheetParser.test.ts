import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractOrNumberFromIdentifier,
  areOrNumbersMatching,
  parseWorksheetText,
  parseExtractWorksheetHttpResponse,
  detectDocumentNumberLocale,
  parsePdfNumberWithContext,
  extractWorksheetFromPdfCoordinates,
  reconcileWorksheetExtractions,
  validateExtractedWorksheet,
  matchMaterialsWithMasterData,
  findLatestUploadForOr,
  buildWorksheetSnapshot,
  refreshScheduleWorksheetsSnapshot,
  ExtractedWorksheetMaterial,
  PdfCoordinatePage,
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

test('11. Safe HTTP Response Parser: JSON valid, plain text 404 ("The page could not be found"), HTML error page, 413/500, JSON rusak', () => {
  // 1) JSON valid
  const okRes = parseExtractWorksheetHttpResponse(
    200,
    'application/json; charset=utf-8',
    JSON.stringify({
      success: true,
      data: {
        id: 'ws-1',
        fileName: 'WORKSHEET - WH_MO_22512.pdf',
        orNumber: '1014',
        worksheetNo: 'WH/MO/22512 · Lot - 1',
        style: '[KAIS08-2] KAIS TOPI PRMI 05',
        target: 2498,
        materials: [],
      },
    })
  );
  assert.equal(okRes.success, true);
  assert.equal(okRes.data?.orNumber, '1014');
  assert.equal(okRes.data?.target, 2498);

  // 2) Plain text "The page could not be found" (HTTP 404)
  const plain404 = parseExtractWorksheetHttpResponse(
    404,
    'text/plain; charset=utf-8',
    'The page could not be found'
  );
  assert.equal(plain404.success, false);
  assert.equal(plain404.isNonJsonResponse, true);
  assert.match(plain404.error || '', /HTTP 404/i);
  assert.doesNotMatch(plain404.error || '', /Unexpected token/i);

  // 3) HTML gateway/proxy error page (HTTP 502)
  const html502 = parseExtractWorksheetHttpResponse(
    502,
    'text/html',
    '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>'
  );
  assert.equal(html502.success, false);
  assert.equal(html502.isNonJsonResponse, true);
  assert.match(html502.error || '', /502/);
  assert.doesNotMatch(html502.error || '', /Unexpected token/i);

  // 4) HTTP 413 Payload Too Large & HTTP 500 JSON rusak/terpotong
  const err413 = parseExtractWorksheetHttpResponse(413, 'text/plain', 'Payload Too Large');
  assert.equal(err413.success, false);
  assert.match(err413.error || '', /413|terlalu besar/i);

  const brokenJson500 = parseExtractWorksheetHttpResponse(500, 'application/json', '{"success": true, "data":');
  assert.equal(brokenJson500.success, false);
  assert.equal(brokenJson500.isNonJsonResponse, true);
  assert.match(brokenJson500.error || '', /JSON.*tidak valid|500/i);
});

test('12. Format Angka Indonesia vs US: 2.498 -> 2498, 104,9160 -> 104.916, 2.498,0000 -> 2498, 88.8 -> 88.8, & deteksi ambigu', () => {
  const idLocale = detectDocumentNumberLocale('TOTAL QTY: 2.498\n104,9160\n2.498,0000');
  assert.equal(idLocale, 'id');

  const nTotalQty = parsePdfNumberWithContext('2.498', idLocale, { isIntegerQtyContext: true });
  assert.equal(nTotalQty.value, 2498);
  assert.equal(nTotalQty.raw, '2.498');
  assert.equal(nTotalQty.isAmbiguous, false);

  const nDec1 = parsePdfNumberWithContext('104,9160', idLocale);
  assert.equal(nDec1.value, 104.916);
  assert.equal(nDec1.raw, '104,9160');
  assert.equal(nDec1.isAmbiguous, false);

  const nDec2 = parsePdfNumberWithContext('2.498,0000', idLocale);
  assert.equal(nDec2.value, 2498);
  assert.equal(nDec2.raw, '2.498,0000');
  assert.equal(nDec2.isAmbiguous, false);

  const usLocale = detectDocumentNumberLocale('TOTAL QTY: 74\n88.8');
  assert.equal(usLocale, 'us');
  const nUs = parsePdfNumberWithContext('88.8', usLocale);
  assert.equal(nUs.value, 88.8);
  assert.equal(nUs.raw, '88.8');
  assert.equal(nUs.isAmbiguous, false);

  // Standalone "2.498" tanpa konteks dokumen Indonesia/US harus ditandai ambigu
  const ambig = parsePdfNumberWithContext('2.498', 'unknown', { isIntegerQtyContext: true });
  assert.equal(ambig.value, 2498);
  assert.equal(ambig.isAmbiguous, true);
  assert.ok(ambig.reason);
});

test('13. Regresi WORKSHEET - WH_MO_22512.pdf (Koordinat 2 Halaman): Identitas, 4 Material, Kolom TOTAL Kosong != BALANCE, & Halaman 2 Material Card Diabaikan', () => {
  const pages: PdfCoordinatePage[] = [
    {
      pageNum: 1,
      width: 595,
      height: 842,
      items: [
        // Header block (2-column layout with BUYER & ITEM distractors)
        { str: 'NO. WORKSHEET :', x: 40, y: 780, width: 85, height: 10 },
        { str: 'WH/MO/22512 · Lot - 1', x: 135, y: 780, width: 110, height: 10 },
        { str: 'NO. OR :', x: 340, y: 780, width: 45, height: 10 },
        { str: 'OR/2026/05/1014', x: 405, y: 780, width: 95, height: 10 },

        { str: 'BUYER :', x: 40, y: 760, width: 42, height: 10 },
        { str: 'PT KAIS RETAIL INDONESIA', x: 135, y: 760, width: 130, height: 10 },
        { str: 'STYLE NO :', x: 340, y: 760, width: 55, height: 10 },
        { str: '[KAIS08-2] KAIS TOPI PRMI 05', x: 405, y: 760, width: 145, height: 10 },

        { str: 'ITEM :', x: 40, y: 740, width: 35, height: 10 },
        { str: 'TOPI PRMI DEWASA', x: 135, y: 740, width: 95, height: 10 },
        { str: 'TOTAL QTY :', x: 340, y: 740, width: 60, height: 10 },
        { str: '2.498', x: 405, y: 740, width: 30, height: 10 },

        // Section Title & Table Header
        { str: 'MATERIAL & KONSUMSI', x: 40, y: 700, width: 130, height: 11 },
        { str: 'NO', x: 30, y: 680, width: 15, height: 9 },
        { str: 'CODE ACC', x: 55, y: 680, width: 48, height: 9 },
        { str: 'DESCRIPTION', x: 135, y: 680, width: 65, height: 9 },
        { str: 'CONS', x: 325, y: 680, width: 28, height: 9 },
        { str: 'UNIT', x: 372, y: 680, width: 24, height: 9 },
        { str: 'TOTAL', x: 418, y: 680, width: 32, height: 9 },
        { str: 'RETURN', x: 472, y: 680, width: 38, height: 9 },
        { str: 'BALANCE', x: 525, y: 680, width: 42, height: 9 },

        // Row 1: TOTAL populated (104,9160)
        { str: '1', x: 32, y: 660, width: 8, height: 9 },
        { str: 'UNI-KAIS9122', x: 55, y: 660, width: 68, height: 9 },
        { str: 'BATIK COTTON UNTUK TOPI KAIS', x: 135, y: 660, width: 155, height: 9 },
        { str: '0,0420', x: 325, y: 660, width: 30, height: 9 },
        { str: 'yard', x: 372, y: 660, width: 20, height: 9 },
        { str: '104,9160', x: 416, y: 660, width: 40, height: 9 },
        { str: '0', x: 485, y: 660, width: 8, height: 9 },
        { str: '104,9160', x: 526, y: 660, width: 40, height: 9 },

        // Row 2: TOTAL empty while BALANCE has 2.498,0000
        { str: '2', x: 32, y: 640, width: 8, height: 9 },
        { str: 'UNI-ACC10141', x: 55, y: 640, width: 70, height: 9 },
        { str: 'HANGTAG TERATAI', x: 135, y: 640, width: 95, height: 9 },
        { str: '1,0000', x: 325, y: 640, width: 30, height: 9 },
        { str: 'Pcs', x: 374, y: 640, width: 16, height: 9 },
        { str: '0', x: 485, y: 640, width: 8, height: 9 },
        { str: '2.498,0000', x: 525, y: 640, width: 46, height: 9 },

        // Row 3: TOTAL empty while BALANCE has 2.498,0000
        { str: '3', x: 32, y: 620, width: 8, height: 9 },
        { str: 'UNI-ACC9174', x: 55, y: 620, width: 65, height: 9 },
        { str: 'TAG PIN 75 MILI', x: 135, y: 620, width: 85, height: 9 },
        { str: '1,0000', x: 325, y: 620, width: 30, height: 9 },
        { str: 'Pcs', x: 374, y: 620, width: 16, height: 9 },
        { str: '0', x: 485, y: 620, width: 8, height: 9 },
        { str: '2.498,0000', x: 525, y: 620, width: 46, height: 9 },

        // Row 4: TOTAL populated
        { str: '4', x: 32, y: 600, width: 8, height: 9 },
        { str: 'UNI-KAIS9123', x: 55, y: 600, width: 68, height: 9 },
        { str: 'COTTON POLOS COL. NAVY UNTUK TOPI KAIS', x: 135, y: 600, width: 175, height: 9 },
        { str: '0,1000', x: 325, y: 600, width: 30, height: 9 },
        { str: 'yard', x: 372, y: 600, width: 20, height: 9 },
        { str: '249,8000', x: 416, y: 600, width: 40, height: 9 },
        { str: '0', x: 485, y: 600, width: 8, height: 9 },
        { str: '249,8000', x: 526, y: 600, width: 40, height: 9 },

        // Summary line & footer
        { str: '4 ITEM MATERIAL', x: 40, y: 575, width: 90, height: 9 },
        { str: 'Page 1 of 2', x: 510, y: 30, width: 50, height: 8 },
      ],
    },
    {
      pageNum: 2,
      width: 595,
      height: 842,
      items: [
        { str: 'Material Card', x: 40, y: 780, width: 80, height: 12 },
        { str: 'Gambar material card belum tersedia', x: 180, y: 500, width: 220, height: 11 },
        { str: 'Page 2 of 2', x: 510, y: 30, width: 50, height: 8 },
      ],
    },
  ];

  const result = extractWorksheetFromPdfCoordinates(pages, 'WORKSHEET - WH_MO_22512.pdf');
  assert.equal(result.success, true);
  assert.ok(result.data);

  // Verifikasi Identitas tidak tertukar
  assert.equal(result.data.orNumber, '1014');
  assert.equal(result.data.rawOrNumber, 'OR/2026/05/1014');
  assert.equal(result.data.worksheetNo, 'WH/MO/22512 · Lot - 1');
  assert.equal(result.data.style, '[KAIS08-2] KAIS TOPI PRMI 05');
  assert.equal(result.data.target, 2498);
  assert.equal(result.data.rawTarget, '2.498');

  // Verifikasi tepat 4 baris material dalam urutan asli (tanpa baris ringkasan / Material Card)
  assert.equal(result.data.materials.length, 4);
  assert.deepEqual(
    result.data.materials.map((m) => m.materialCode),
    ['UNI-KAIS9122', 'UNI-ACC10141', 'UNI-ACC9174', 'UNI-KAIS9123']
  );

  // Row 1: desimal koma Indonesia presisi
  assert.equal(result.data.materials[0].materialName, 'BATIK COTTON UNTUK TOPI KAIS');
  assert.equal(result.data.materials[0].unit, 'yard');
  assert.equal(result.data.materials[0].total, 104.916);
  assert.equal(result.data.materials[0].rawTotal, '104,9160');

  // Row 2 & 3: TOTAL kosong tetap null, TIDAK mengambil BALANCE 2.498,0000!
  assert.equal(result.data.materials[1].materialName, 'HANGTAG TERATAI');
  assert.equal(result.data.materials[1].unit, 'Pcs');
  assert.equal(result.data.materials[1].total, null);
  assert.equal(result.data.materials[2].materialName, 'TAG PIN 75 MILI');
  assert.equal(result.data.materials[2].total, null);

  // Row 4: tetap terbaca lengkap
  assert.equal(result.data.materials[3].materialName, 'COTTON POLOS COL. NAVY UNTUK TOPI KAIS');
  assert.equal(result.data.materials[3].unit, 'yard');
  assert.equal(result.data.materials[3].total, 249.8);
});

test('14. Regresi Teks Tabular (No. OR tidak tertukar NO. WORKSHEET, Style tidak ambil "NO"/BUYER, Deskripsi mengandung UNIT/TOTAL tetap terbaca)', () => {
  const tabularText = `
NO. WORKSHEET : WH/MO/22512 · Lot - 1
NO. OR : OR/2026/05/1014
BUYER : PT KAIS RETAIL INDONESIA
STYLE NO : [KAIS08-2] KAIS TOPI PRMI 05
ITEM : TOPI PRMI
TOTAL QTY : 2.498

MATERIAL & KONSUMSI
NO\tCODE ACC\tDESCRIPTION\tCONS\tUNIT\tTOTAL\tRETURN\tBALANCE
1\tUNI-KAIS9122\tBATIK COTTON UNIT TOTAL TEST\t0,0420\tyard\t104,9160\t0\t104,9160
2\tUNI-ACC10141\tHANGTAG TERATAI\t1,0000\tPcs\t\t0\t2.498,0000
3\tUNI-ACC9174\tTAG PIN 75 MILI\t1,0000\tPcs\t\t0\t2.498,0000
4\tUNI-KAIS9123\tCOTTON POLOS COL. NAVY\t0,1000\tyard\t249,8000\t0\t249,8000
4 ITEM MATERIAL

Material Card
Gambar material card belum tersedia
`;

  const parsed = parseWorksheetText(tabularText, 'WORKSHEET - WH_MO_22512.pdf');
  assert.equal(parsed.success, true);
  assert.ok(parsed.data);
  assert.equal(parsed.data.orNumber, '1014');
  assert.equal(parsed.data.worksheetNo, 'WH/MO/22512 · Lot - 1');
  assert.equal(parsed.data.style, '[KAIS08-2] KAIS TOPI PRMI 05');
  assert.equal(parsed.data.target, 2498);
  assert.equal(parsed.data.materials.length, 4);
  assert.equal(parsed.data.materials[0].materialName, 'BATIK COTTON UNIT TOTAL TEST');
  assert.equal(parsed.data.materials[0].total, 104.916);
  assert.equal(parsed.data.materials[1].total, null);
  assert.equal(parsed.data.materials[2].total, null);
  assert.equal(parsed.data.materials[3].total, 249.8);
});

test('15. PDF Scan / Tanpa Text Layer + Rekonsiliasi & Flagging Konflik antara Teks Deterministik vs OCR/AI', () => {
  // 1) PDF tanpa lapisan teks
  const blankScanPages: PdfCoordinatePage[] = [{ pageNum: 1, items: [] }];
  const scanRes = extractWorksheetFromPdfCoordinates(blankScanPages, 'ScanOnly.pdf');
  assert.equal(scanRes.success, false);
  assert.match(scanRes.error || '', /tidak berisi lapisan teks|scan/i);

  // 2) Rekonsiliasi ketika hasil teks dan OCR/AI berbeda -> wajib menandai needsReview & fieldWarnings!
  const detWs = {
    id: 'ws-det',
    fileName: 'Conflict.pdf',
    orNumber: '1014',
    rawOrNumber: 'OR/2026/05/1014',
    worksheetNo: 'WH/MO/22512 · Lot - 1',
    style: '[KAIS08-2] KAIS TOPI PRMI 05',
    target: 2498,
    rawTarget: '2.498',
    materials: [
      { materialCode: 'UNI-KAIS9122', materialName: 'BATIK COTTON', unit: 'yard', total: 104.916, rawTotal: '104,9160' },
      { materialCode: 'UNI-ACC10141', materialName: 'HANGTAG TERATAI', unit: 'Pcs', total: null, rawTotal: '' },
    ],
  };

  const aiWs = {
    id: 'ws-ai',
    fileName: 'Conflict.pdf',
    orNumber: '1015', // berbeda dengan det!
    rawOrNumber: 'OR/2026/05/1015',
    worksheetNo: 'WH/MO/22512 · Lot - 1',
    style: '[KAIS08-2] KAIS TOPI PRMI 05',
    target: 2.498, // AI salah baca titik ribuan jadi desimal!
    rawTarget: '2.498',
    materials: [
      { materialCode: 'UNI-KAIS9122', materialName: 'BATIK COTTON', unit: 'yard', total: 104.916, rawTotal: '104,9160' },
      { materialCode: 'UNI-ACC10141', materialName: 'HANGTAG TERATAI', unit: 'Pcs', total: 2498, rawTotal: '2.498,0000' },
    ],
  };

  const reconciled = reconcileWorksheetExtractions(detWs, aiWs, 'Conflict.pdf');
  assert.equal(reconciled.extractionMethod, 'hybrid');
  assert.equal(reconciled.needsReview, true);
  assert.ok(reconciled.fieldWarnings?.some((w) => w.field === 'orNumber'));
  assert.ok(reconciled.fieldWarnings?.some((w) => w.field === 'target'));
  // Baris 2 (TOTAL kosong pada sumber PDF) TIDAK boleh diisi dari angka Gemini (2498)
  assert.equal(reconciled.materials[1].total, null);
  assert.equal(reconciled.materials[1].rawTotal, '');
  assert.equal(reconciled.materials[1].totalStatus, 'empty');
  assert.match(reconciled.materials[1].reviewNote || '', /kosong pada sumber PDF/i);
});

test('16. Ekstraksi Real PDF Binary Buffer via pdf-parse (PDFParse.load -> getTextContent -> extractWorksheetFromPdfCoordinates)', async () => {
  // Bangun PDF binary valid sederhana dengan sintaks PDF 1.4 standar (multi-halaman: Halaman 1 Worksheet, Halaman 2 Material Card)
  const buildSimplePdf = (pageStreams: string[]): Buffer => {
    const objects: string[] = [];
    // 1: Catalog, 2: Pages, 3: Font
    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    const pageObjNums = pageStreams.map((_, idx) => 4 + idx * 2);
    objects.push(
      `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageStreams.length} >>\nendobj\n`
    );
    objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

    pageStreams.forEach((stream, idx) => {
      const pageNum = 4 + idx * 2;
      const contentNum = pageNum + 1;
      objects.push(
        `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`
      );
      const len = Buffer.byteLength(stream, 'utf8');
      objects.push(
        `${contentNum} 0 obj\n<< /Length ${len} >>\nstream\n${stream}\nendstream\nendobj\n`
      );
    });

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += obj;
    }
    const xrefPos = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    return Buffer.from(pdf, 'utf8');
  };

  const escapePdfStr = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const drawAt = (x: number, y: number, text: string) =>
    `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfStr(text)}) Tj ET`;

  const page1Stream = [
    drawAt(40, 740, 'NO. WORKSHEET :'),
    drawAt(135, 740, 'WH/MO/22512 - Lot 1'),
    drawAt(330, 740, 'NO. OR :'),
    drawAt(395, 740, 'OR/2026/05/1014'),
    drawAt(40, 720, 'BUYER : PT KAIS'),
    drawAt(330, 720, 'STYLE NO :'),
    drawAt(395, 720, '[KAIS08-2] KAIS TOPI PRMI 05'),
    drawAt(330, 700, 'TOTAL QTY :'),
    drawAt(395, 700, '2.498'),
    drawAt(40, 665, 'MATERIAL & KONSUMSI'),
    drawAt(30, 645, 'NO'),
    drawAt(60, 645, 'CODE ACC'),
    drawAt(140, 645, 'DESCRIPTION'),
    drawAt(330, 645, 'CONS'),
    drawAt(380, 645, 'UNIT'),
    drawAt(425, 645, 'TOTAL'),
    drawAt(480, 645, 'RETURN'),
    drawAt(535, 645, 'BALANCE'),
    drawAt(30, 625, '1'),
    drawAt(60, 625, 'UNI-KAIS9122'),
    drawAt(140, 625, 'BATIK COTTON UNTUK TOPI KAIS'),
    drawAt(330, 625, '0,0420'),
    drawAt(380, 625, 'yard'),
    drawAt(425, 625, '104,9160'),
    drawAt(480, 625, '0'),
    drawAt(535, 625, '104,9160'),
    drawAt(30, 605, '2'),
    drawAt(60, 605, 'UNI-ACC10141'),
    drawAt(140, 605, 'HANGTAG TERATAI'),
    drawAt(330, 605, '1,0000'),
    drawAt(380, 605, 'Pcs'),
    drawAt(480, 605, '0'),
    drawAt(535, 605, '2.498,0000'),
    drawAt(40, 580, '2 ITEM MATERIAL'),
  ].join('\n');

  const page2Stream = [
    drawAt(40, 740, 'Material Card'),
    drawAt(180, 500, 'Gambar material card belum tersedia'),
  ].join('\n');

  const pdfBuffer = buildSimplePdf([page1Stream, page2Stream]);
  const { PDFParse } = await import('pdf-parse');
  const parser = new (PDFParse as any)({ data: pdfBuffer });
  try {
    const doc = await parser.load();
    const pages: PdfCoordinatePage[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const tc = await page.getTextContent();
      pages.push({
        pageNum,
        items: tc.items.map((it: any) => ({
          str: String(it.str || ''),
          x: Number(it.transform?.[4] ?? 0),
          y: Number(it.transform?.[5] ?? 0),
          width: Number(it.width ?? 0),
          height: Number(it.height ?? 9),
        })),
      });
    }

    const extracted = extractWorksheetFromPdfCoordinates(pages, 'WORKSHEET - WH_MO_22512.pdf');
    assert.equal(extracted.success, true);
    assert.equal(extracted.data?.orNumber, '1014');
    assert.equal(extracted.data?.worksheetNo, 'WH/MO/22512 - Lot 1');
    assert.equal(extracted.data?.style, '[KAIS08-2] KAIS TOPI PRMI 05');
    assert.equal(extracted.data?.target, 2498);
    assert.equal(extracted.data?.materials.length, 2);
    assert.equal(extracted.data?.materials[0].total, 104.916);
    assert.equal(extracted.data?.materials[1].total, null);

    // Validasi: gagal jika data wajib hilang
    const badCheck = validateExtractedWorksheet({
      id: 'ws-bad',
      fileName: 'Bad.pdf',
      orNumber: '',
      style: '',
      target: null,
      materials: [],
    });
    assert.equal(badCheck.needsReview, true);
    assert.ok(badCheck.fieldWarnings.some((w) => w.severity === 'error'));
  } finally {
    if (typeof parser.destroy === 'function') {
      await parser.destroy();
    }
  }
});

test('17. Regresi Kasus A: Deterministik TOTAL kosong + Gemini mengembalikan angka -> TOTAL tetap null, tidak ambil tebakan AI', () => {
  const detWs = {
    id: 'ws-a-det',
    fileName: 'KasusA.pdf',
    orNumber: '1014',
    rawOrNumber: 'OR/2026/05/1014',
    worksheetNo: 'WH/MO/22512 · Lot - 1',
    style: '[KAIS08-2] KAIS TOPI PRMI 05',
    target: 2498,
    rawTarget: '2.498',
    materials: [
      {
        materialCode: 'UNI-ACC10141',
        materialName: 'HANGTAG TERATAI',
        unit: 'Pcs',
        total: null,
        rawTotal: '',
        totalStatus: 'empty' as const,
        needsReview: false,
      },
      {
        materialCode: 'UNI-ACC9174',
        materialName: 'TAG PIN 75 MILI',
        unit: 'Pcs',
        total: null,
        rawTotal: '',
        totalStatus: 'empty' as const,
        needsReview: false,
      },
    ],
  };

  const aiWs = {
    id: 'ws-a-ai',
    fileName: 'KasusA.pdf',
    orNumber: '1014',
    rawOrNumber: 'OR/2026/05/1014',
    worksheetNo: 'WH/MO/22512 · Lot - 1',
    style: '[KAIS08-2] KAIS TOPI PRMI 05',
    target: 2498,
    rawTarget: '2.498',
    materials: [
      {
        materialCode: 'UNI-ACC10141',
        materialName: 'HANGTAG TERATAI',
        unit: 'Pcs',
        total: 2498,
        rawTotal: '2.498,0000',
      },
      {
        materialCode: 'UNI-ACC9174',
        materialName: 'TAG PIN 75 MILI',
        unit: 'Pcs',
        total: 2498,
        rawTotal: '2.498,0000',
      },
    ],
  };

  const reconciled = reconcileWorksheetExtractions(detWs, aiWs, 'KasusA.pdf');

  assert.equal(reconciled.materials.length, 2);
  assert.deepEqual(
    reconciled.materials.map((m) => m.materialCode),
    ['UNI-ACC10141', 'UNI-ACC9174']
  );
  assert.deepEqual(
    reconciled.materials.map((m) => m.materialName),
    ['HANGTAG TERATAI', 'TAG PIN 75 MILI']
  );
  assert.deepEqual(
    reconciled.materials.map((m) => m.unit),
    ['Pcs', 'Pcs']
  );

  for (const m of reconciled.materials) {
    assert.equal(m.total, null);
    assert.equal(m.rawTotal, '');
    assert.equal(m.totalStatus, 'empty');
    assert.match(m.reviewNote || '', /TOTAL kosong pada sumber PDF/i);
  }
});

test('18. Regresi Kasus B: Deterministik & Gemini sama-sama menemukan TOTAL -> nilai dipertahankan, warning muncul jika berbeda', () => {
  const detWs = {
    id: 'ws-b-det',
    fileName: 'KasusB.pdf',
    orNumber: '1014',
    style: '[KAIS08-2] KAIS TOPI PRMI 05',
    target: 2498,
    materials: [
      { materialCode: 'UNI-KAIS9122', materialName: 'BATIK COTTON', unit: 'yard', total: 104.916, rawTotal: '104,9160', totalStatus: 'present' as const },
      { materialCode: 'UNI-KAIS9123', materialName: 'COTTON POLOS', unit: 'yard', total: 249.8, rawTotal: '249,8000', totalStatus: 'present' as const },
    ],
  };

  const aiSame = {
    id: 'ws-b-ai-same',
    fileName: 'KasusB.pdf',
    orNumber: '1014',
    style: '[KAIS08-2] KAIS TOPI PRMI 05',
    target: 2498,
    materials: [
      { materialCode: 'UNI-KAIS9122', materialName: 'BATIK COTTON', unit: 'yard', total: 104.916, rawTotal: '104,9160' },
      { materialCode: 'UNI-KAIS9123', materialName: 'COTTON POLOS', unit: 'yard', total: 249.8, rawTotal: '249,8000' },
    ],
  };

  const sameResult = reconcileWorksheetExtractions(detWs, aiSame, 'KasusB.pdf');
  assert.equal(sameResult.materials[0].total, 104.916);
  assert.equal(sameResult.materials[1].total, 249.8);
  assert.equal(sameResult.needsReview, false);
  assert.equal(sameResult.fieldWarnings?.length, 0);

  const aiDiff = {
    ...aiSame,
    materials: [
      { materialCode: 'UNI-KAIS9122', materialName: 'BATIK COTTON', unit: 'yard', total: 104.916, rawTotal: '104,9160' },
      { materialCode: 'UNI-KAIS9123', materialName: 'COTTON POLOS', unit: 'yard', total: 250, rawTotal: '250,0000' },
    ],
  };

  const diffResult = reconcileWorksheetExtractions(detWs, aiDiff, 'KasusB.pdf');
  assert.equal(diffResult.materials[0].total, 104.916);
  assert.equal(diffResult.materials[1].total, 249.8);
  assert.equal(diffResult.needsReview, true);
  assert.equal(diffResult.materials[1].needsReview, true);
  assert.ok(diffResult.fieldWarnings?.some((w) => w.field === 'materials[1].total'));
});

test('19. Regresi Kasus C: Kolom TOTAL terbaca sebagai angka -> nilai tetap terbaca sesuai angka aslinya', () => {
  const pages: PdfCoordinatePage[] = [
    {
      pageNum: 1,
      items: [
        { str: 'NO. OR : OR/2026/05/1014', x: 40, y: 740, width: 150, height: 10 },
        { str: 'STYLE NO : [KAIS08-2] KAIS TOPI PRMI 05', x: 40, y: 720, width: 200, height: 10 },
        { str: 'TOTAL QTY : 2.498', x: 40, y: 700, width: 120, height: 10 },
        { str: 'MATERIAL & KONSUMSI', x: 40, y: 670, width: 140, height: 10 },
        { str: 'CODE ACC', x: 40, y: 650, width: 60, height: 9 },
        { str: 'DESCRIPTION', x: 130, y: 650, width: 120, height: 9 },
        { str: 'CONS', x: 320, y: 650, width: 40, height: 9 },
        { str: 'UNIT', x: 375, y: 650, width: 35, height: 9 },
        { str: 'TOTAL', x: 430, y: 650, width: 45, height: 9 },
        { str: 'RETURN', x: 490, y: 650, width: 45, height: 9 },
        { str: 'BALANCE', x: 545, y: 650, width: 50, height: 9 },
        { str: 'UNI-KAIS9122', x: 40, y: 630, width: 70, height: 9 },
        { str: 'BATIK COTTON', x: 130, y: 630, width: 110, height: 9 },
        { str: '0,0420', x: 320, y: 630, width: 40, height: 9 },
        { str: 'yard', x: 375, y: 630, width: 25, height: 9 },
        { str: '104,9160', x: 430, y: 630, width: 45, height: 9 },
        { str: '0', x: 490, y: 630, width: 15, height: 9 },
        { str: '104,9160', x: 545, y: 630, width: 45, height: 9 },
      ],
    },
  ];

  const extracted = extractWorksheetFromPdfCoordinates(pages, 'KasusC.pdf');
  assert.equal(extracted.success, true);
  assert.ok(extracted.data);
  assert.equal(extracted.data.materials[0].total, 104.916);
  assert.equal(extracted.data.materials[0].rawTotal, '104,9160');
  assert.equal(extracted.data.materials[0].totalStatus, 'present');

  const reconciled = reconcileWorksheetExtractions(extracted.data, null, 'KasusC.pdf');
  assert.equal(reconciled.materials[0].total, 104.916);
  assert.equal(reconciled.materials[0].totalStatus, 'present');
});

test('20. Regresi Kasus D: Kolom BALANCE dan RETURN berisi angka saat TOTAL kosong -> angka BALANCE/RETURN tidak pernah masuk ke TOTAL', () => {
  const pages: PdfCoordinatePage[] = [
    {
      pageNum: 1,
      items: [
        { str: 'NO. OR : OR/2026/05/1014', x: 40, y: 740, width: 150, height: 10 },
        { str: 'STYLE NO : [KAIS08-2] KAIS TOPI PRMI 05', x: 40, y: 720, width: 200, height: 10 },
        { str: 'TOTAL QTY : 2.498', x: 40, y: 700, width: 120, height: 10 },
        { str: 'MATERIAL & KONSUMSI', x: 40, y: 670, width: 140, height: 10 },
        { str: 'CODE ACC', x: 40, y: 650, width: 60, height: 9 },
        { str: 'DESCRIPTION', x: 130, y: 650, width: 120, height: 9 },
        { str: 'CONS', x: 320, y: 650, width: 40, height: 9 },
        { str: 'UNIT', x: 375, y: 650, width: 35, height: 9 },
        { str: 'TOTAL', x: 430, y: 650, width: 45, height: 9 },
        { str: 'RETURN', x: 490, y: 650, width: 45, height: 9 },
        { str: 'BALANCE', x: 545, y: 650, width: 50, height: 9 },
        // Baris dengan TOTAL kosong, RETURN = 15, BALANCE = 2.498,0000
        { str: 'UNI-ACC10141', x: 40, y: 630, width: 70, height: 9 },
        { str: 'HANGTAG TERATAI', x: 130, y: 630, width: 110, height: 9 },
        { str: '1,0000', x: 320, y: 630, width: 40, height: 9 },
        { str: 'Pcs', x: 375, y: 630, width: 25, height: 9 },
        { str: '15,0000', x: 490, y: 630, width: 40, height: 9 },
        { str: '2.498,0000', x: 545, y: 630, width: 50, height: 9 },
      ],
    },
  ];

  const extracted = extractWorksheetFromPdfCoordinates(pages, 'KasusD.pdf');
  assert.equal(extracted.success, true);
  assert.ok(extracted.data);
  assert.equal(extracted.data.materials.length, 1);
  assert.equal(extracted.data.materials[0].total, null);
  assert.equal(extracted.data.materials[0].rawTotal, '');
  assert.equal(extracted.data.materials[0].totalStatus, 'empty');

  // Simulasikan Gemini salah mengambil angka BALANCE (2498) atau RETURN (15) sebagai TOTAL
  const aiMisreadBalance = {
    ...extracted.data,
    id: 'ws-d-ai',
    materials: [
      {
        materialCode: 'UNI-ACC10141',
        materialName: 'HANGTAG TERATAI',
        unit: 'Pcs',
        total: 2498,
        rawTotal: '2.498,0000',
      },
    ],
  };

  const reconciled = reconcileWorksheetExtractions(extracted.data, aiMisreadBalance, 'KasusD.pdf');
  assert.equal(reconciled.materials[0].total, null);
  assert.equal(reconciled.materials[0].rawTotal, '');
  assert.equal(reconciled.materials[0].totalStatus, 'empty');
  assert.match(reconciled.materials[0].reviewNote || '', /kosong pada sumber PDF/i);
});

test('21. Pembedaan TOTAL kosong vs TOTAL gagal terbaca (unreadable): tidak menebak angka dan wajib beri peringatan pemeriksaan', () => {
  // Kasus 1: sel TOTAL berisi teks rusak non-numerik ("???") pada koordinat kolom TOTAL
  const garbledPages: PdfCoordinatePage[] = [
    {
      pageNum: 1,
      items: [
        { str: 'NO. OR : OR/2026/05/1014', x: 40, y: 740, width: 150, height: 10 },
        { str: 'STYLE NO : [KAIS08-2] KAIS TOPI PRMI 05', x: 40, y: 720, width: 200, height: 10 },
        { str: 'TOTAL QTY : 2.498', x: 40, y: 700, width: 120, height: 10 },
        { str: 'MATERIAL & KONSUMSI', x: 40, y: 670, width: 140, height: 10 },
        { str: 'CODE ACC', x: 40, y: 650, width: 60, height: 9 },
        { str: 'DESCRIPTION', x: 130, y: 650, width: 120, height: 9 },
        { str: 'UNIT', x: 375, y: 650, width: 35, height: 9 },
        { str: 'TOTAL', x: 430, y: 650, width: 45, height: 9 },
        { str: 'UNI-ACC10141', x: 40, y: 630, width: 70, height: 9 },
        { str: 'HANGTAG TERATAI', x: 130, y: 630, width: 110, height: 9 },
        { str: 'Pcs', x: 375, y: 630, width: 25, height: 9 },
        { str: '???', x: 430, y: 630, width: 25, height: 9 },
      ],
    },
  ];

  const garbledRes = extractWorksheetFromPdfCoordinates(garbledPages, 'UnreadableTotal.pdf');
  assert.equal(garbledRes.success, true);
  assert.ok(garbledRes.data);
  assert.equal(garbledRes.data.materials[0].total, null);
  assert.equal(garbledRes.data.materials[0].totalStatus, 'unreadable');
  assert.equal(garbledRes.data.materials[0].needsReview, true);
  assert.equal(garbledRes.data.needsReview, true);
  assert.ok(garbledRes.data.fieldWarnings?.some((w) => w.field === 'materials[0].total'));

  // Rekonsiliasi dengan Gemini tetap tidak boleh menebak angka untuk baris unreadable
  const aiGuess = {
    ...garbledRes.data,
    id: 'ws-u-ai',
    materials: [
      { materialCode: 'UNI-ACC10141', materialName: 'HANGTAG TERATAI', unit: 'Pcs', total: 999, rawTotal: '999' },
    ],
  };
  const reconciledUnreadable = reconcileWorksheetExtractions(garbledRes.data, aiGuess, 'UnreadableTotal.pdf');
  assert.equal(reconciledUnreadable.materials[0].total, null);
  assert.equal(reconciledUnreadable.materials[0].totalStatus, 'unreadable');
  assert.equal(reconciledUnreadable.materials[0].needsReview, true);
  assert.equal(reconciledUnreadable.needsReview, true);
  assert.ok(reconciledUnreadable.fieldWarnings?.some((w) => w.field === 'materials[0].total'));
});



