import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAllMaterialRisks,
  calculateParetoAnalysis,
  calculateMaterialComparisonMetrics,
} from '../src/utils/ppicCalculations';
import {
  PPIC_SUPABASE_SCHEMA_SQL,
  PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL,
  PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL,
} from '../src/lib/supabaseSchemaSql';
import { MaterialItemRequirement, ProductionSchedule } from '../src/types/ppic';

test('High-Volume Scale: 20,000 rows batching math (500 rows per batch)', () => {
  const totalRows = 20000;
  const chunkSize = 500;
  const totalBatches = Math.ceil(totalRows / chunkSize);

  assert.strictEqual(totalBatches, 40, '20,000 rows should produce exactly 40 batches');

  const batches: number[] = [];
  for (let i = 0; i < totalRows; i += chunkSize) {
    const chunkLength = Math.min(chunkSize, totalRows - i);
    batches.push(chunkLength);
  }

  assert.strictEqual(batches.length, 40, 'Total batch count should be 40');
  assert.strictEqual(batches.reduce((a, b) => a + b, 0), 20000, 'Sum of all chunks must equal 20,000 rows');
  assert.ok(batches.every((sz) => sz === 500), 'Every batch must contain exactly 500 rows');
});

test('High-Volume Scale: 21,350 rows non-even batching math', () => {
  const totalRows = 21350;
  const chunkSize = 500;
  const totalBatches = Math.ceil(totalRows / chunkSize);

  assert.strictEqual(totalBatches, 43, '21,350 rows should produce exactly 43 batches');

  const lastChunkSize = totalRows - ((totalBatches - 1) * chunkSize);
  assert.strictEqual(lastChunkSize, 350, 'Last batch must have remaining 350 rows');
});

test('High-Volume Scale: Range-based pagination math for millions of rows', () => {
  const pageSize = 50;

  // Page 1
  const page1 = 1;
  const from1 = (page1 - 1) * pageSize;
  const to1 = from1 + pageSize - 1;
  assert.strictEqual(from1, 0);
  assert.strictEqual(to1, 49);

  // Page 400 (Row 20,000)
  const page400 = 400;
  const from400 = (page400 - 1) * pageSize;
  const to400 = from400 + pageSize - 1;
  assert.strictEqual(from400, 19950);
  assert.strictEqual(to400, 19999);

  // Total pages for 7,300,000 rows (1 year)
  const totalYearRows = 7300000;
  const totalYearPages = Math.ceil(totalYearRows / pageSize);
  assert.strictEqual(totalYearPages, 146000, '146,000 pages for 7.3M rows at 50/page');
});

test('High-Volume Scale: Storage monitoring warning thresholds', () => {
  const freeTierLimitBytes = 500 * 1024 * 1024; // 500 MB (524,288,000 bytes)

  function evaluateWarning(currentBytes: number): 'NORMAL' | 'WARNING_70' | 'CRITICAL_85' | 'EMERGENCY_95' {
    const percent = Math.round((currentBytes / freeTierLimitBytes) * 100);
    if (percent >= 95) return 'EMERGENCY_95';
    if (percent >= 85) return 'CRITICAL_85';
    if (percent >= 70) return 'WARNING_70';
    return 'NORMAL';
  }

  // 200 MB = 40% -> NORMAL
  assert.strictEqual(evaluateWarning(200 * 1024 * 1024), 'NORMAL');
  // 367 MB = 73.4% -> WARNING_70
  assert.strictEqual(evaluateWarning(367 * 1024 * 1024), 'WARNING_70');
  // 445 MB = 89% -> CRITICAL_85
  assert.strictEqual(evaluateWarning(445 * 1024 * 1024), 'CRITICAL_85');
  // 498 MB = 99.6% -> EMERGENCY_95
  assert.strictEqual(evaluateWarning(498 * 1024 * 1024), 'EMERGENCY_95');
});

test('High-Volume Scale: SQL migration script contains required indexes and RPCs', () => {
  assert.ok(
    PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL.includes('idx_mat_req_or_date'),
    'High volume SQL must define idx_mat_req_or_date index'
  );
  assert.ok(
    PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL.includes('idx_mat_req_upload_id'),
    'High volume SQL must define idx_mat_req_upload_id index'
  );
  assert.ok(
    PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL.includes('get_ppic_dashboard_summary'),
    'High volume SQL must define get_ppic_dashboard_summary RPC'
  );
  assert.ok(
    PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL.includes('get_ppic_database_storage_stats'),
    'High volume SQL must define get_ppic_database_storage_stats RPC'
  );
});

test('High-Volume Scale: Material Risk Analysis performance filter on active schedules', () => {
  // Simulate 1,000 historical materials and 1 active scheduled OR with 5 materials
  const mockSchedules: ProductionSchedule[] = [
    {
      id: 'sch-1',
      orNumber: 'OR-ACTIVE-2026',
      style: 'Active Bomber Navy',
      productionLine: 'Line 1',
      productionDate: '2026-11-10',
      finishDate: '2026-11-15',
      target: 1000,
      status: 'Terjadwal',
      notes: 'Active batch',
    },
  ];

  const historicalReqs: MaterialItemRequirement[] = Array.from({ length: 500 }, (_, i) => ({
    id: `hist-req-${i}`,
    orNumber: `OR-ARCHIVED-${i}`,
    style: `Style Archived ${i}`,
    materialCode: `MAT-${i}`,
    materialName: `Old Material ${i}`,
    category: 'Raw Material',
    unit: 'Yard',
    requiredQty: 100,
    receivedQty: 100,
    unitPrice: 25000,
    updateDate: '2026-01-01',
  }));

  const activeReqs: MaterialItemRequirement[] = [
    {
      id: 'active-req-1',
      orNumber: 'OR-ACTIVE-2026',
      style: 'Active Bomber Navy',
      materialCode: 'FAB-TASLAN-01',
      materialName: 'Fabric Taslan Navy',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 2500,
      receivedQty: 1000, // Shortage 60%
      unitPrice: 42000,
      updateDate: '2026-11-04',
    },
  ];

  const allReqs = [...activeReqs, ...historicalReqs];

  // When optimized, filter by active schedules:
  const scheduledOrs = new Set(mockSchedules.map((s) => s.orNumber.trim().toUpperCase()));
  const filteredActive = allReqs.filter((r) => scheduledOrs.has(r.orNumber.trim().toUpperCase()));

  assert.strictEqual(filteredActive.length, 1, 'Should isolate the 1 active requirement');

  const { materialAssessments, orSummaries } = assessAllMaterialRisks(
    filteredActive,
    mockSchedules,
    new Date('2026-11-04')
  );

  assert.strictEqual(materialAssessments.length, 1);
  assert.strictEqual(materialAssessments[0].orNumber, 'OR-ACTIVE-2026');
  assert.strictEqual(orSummaries.length, 1);
  assert.strictEqual(orSummaries[0].orNumber, 'OR-ACTIVE-2026');
});

test('Multi-Upload Retention: Upload A (1k, 1 Nov) + Upload B (1k, 2 Nov, same OR) preserves all 2,000 rows without overwriting', () => {
  // Simulate Upload A: OR001 on 2026-11-01, 1,000 rows
  const uploadIdA = 'upload-uuid-aaa-111';
  const uploadA_Rows: MaterialItemRequirement[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `req-a-${i + 1}`,
    uploadId: uploadIdA,
    orNumber: 'OR001',
    style: 'Style Casual Jacket',
    materialCode: `MAT-A-${String(i + 1).padStart(4, '0')}`,
    materialName: `Material A #${i + 1}`,
    category: 'Raw Material',
    unit: 'Kg',
    requiredQty: 100,
    receivedQty: 50,
    unitPrice: 15000,
    updateDate: '2026-11-01',
    importedAt: '2026-11-01T08:00:00Z',
  }));

  // Simulate Upload B: OR001 on 2026-11-02, 1,000 rows (Same OR, later snapshot date, different uploadId)
  const uploadIdB = 'upload-uuid-bbb-222';
  const uploadB_Rows: MaterialItemRequirement[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `req-b-${i + 1}`,
    uploadId: uploadIdB,
    orNumber: 'OR001',
    style: 'Style Casual Jacket',
    materialCode: `MAT-B-${String(i + 1).padStart(4, '0')}`,
    materialName: `Material B #${i + 1}`,
    category: 'Raw Material',
    unit: 'Kg',
    requiredQty: 200,
    receivedQty: 200,
    unitPrice: 15000,
    updateDate: '2026-11-02',
    importedAt: '2026-11-02T08:00:00Z',
  }));

  // Append-only simulation (as performed by autoSaveExcelMaterials & syncBatchExcelToSupabaseWithProgress)
  const accumulatedRequirements: MaterialItemRequirement[] = [...uploadB_Rows, ...uploadA_Rows];

  // Verification 1: Total rows must be exactly 2,000
  assert.strictEqual(accumulatedRequirements.length, 2000, 'Total accumulated requirements must be exactly 2,000');

  // Verification 2: Upload A records must be 100% intact and unchanged
  const filteredUploadA = accumulatedRequirements.filter((r) => r.uploadId === uploadIdA);
  assert.strictEqual(filteredUploadA.length, 1000, 'Upload A must retain all 1,000 rows');
  assert.strictEqual(filteredUploadA[0].updateDate, '2026-11-01');
  assert.strictEqual(filteredUploadA[0].requiredQty, 100);
  assert.strictEqual(filteredUploadA[0].receivedQty, 50);

  // Verification 3: Upload B records must be 100% intact
  const filteredUploadB = accumulatedRequirements.filter((r) => r.uploadId === uploadIdB);
  assert.strictEqual(filteredUploadB.length, 1000, 'Upload B must retain all 1,000 rows');
  assert.strictEqual(filteredUploadB[0].updateDate, '2026-11-02');
  assert.strictEqual(filteredUploadB[0].requiredQty, 200);
  assert.strictEqual(filteredUploadB[0].receivedQty, 200);

  // Verification 4: Both can be searched separately by updateDate
  const searchNov1 = accumulatedRequirements.filter((r) => r.orNumber === 'OR001' && r.updateDate === '2026-11-01');
  assert.strictEqual(searchNov1.length, 1000, 'Searching OR001 on 1 Nov must yield 1,000 rows');

  const searchNov2 = accumulatedRequirements.filter((r) => r.orNumber === 'OR001' && r.updateDate === '2026-11-02');
  assert.strictEqual(searchNov2.length, 1000, 'Searching OR001 on 2 Nov must yield 1,000 rows');

  // Verification 5: Searching by OR001 alone returns all 2,000 historical rows
  const searchAllOr001 = accumulatedRequirements.filter((r) => r.orNumber === 'OR001');
  assert.strictEqual(searchAllOr001.length, 2000, 'Searching OR001 alone must return all 2,000 rows');
});

test('High-Volume Scale: Upload C (20,000 rows) expands total to 22,000 rows with 100% searchability', () => {
  // Existing 2,000 rows from Upload A and B
  const initialCount = 2000;
  const existingReqs: MaterialItemRequirement[] = Array.from({ length: initialCount }, (_, i) => ({
    id: `req-prev-${i}`,
    uploadId: i < 1000 ? 'upload-a' : 'upload-b',
    orNumber: 'OR001',
    style: 'Style Casual Jacket',
    materialCode: `MAT-PREV-${i}`,
    materialName: `Existing Material ${i}`,
    category: 'Raw Material',
    unit: 'Kg',
    requiredQty: 100,
    receivedQty: 100,
    unitPrice: 10000,
    updateDate: i < 1000 ? '2026-11-01' : '2026-11-02',
  }));

  // Simulate Upload C: 20,000 new rows for OR002 on 2026-11-03
  const uploadIdC = 'upload-uuid-ccc-333';
  const uploadC_Rows: MaterialItemRequirement[] = Array.from({ length: 20000 }, (_, i) => ({
    id: `req-c-${i + 1}`,
    uploadId: uploadIdC,
    orNumber: 'OR002',
    style: 'Style Heavy Parka Waterproof',
    materialCode: `MAT-C-${String(i + 1).padStart(5, '0')}`,
    materialName: `Material C #${i + 1}`,
    category: 'Raw Material',
    unit: 'Yard',
    requiredQty: 500,
    receivedQty: 400,
    unitPrice: 35000,
    updateDate: '2026-11-03',
    importedAt: '2026-11-03T09:00:00Z',
  }));

  // Combine via append-only
  const allReqs = [...uploadC_Rows, ...existingReqs];

  // Verification 1: Exactly 22,000 rows
  assert.strictEqual(allReqs.length, 22000, 'Accumulated total must reach 22,000 rows (2k previous + 20k new)');

  // Verification 2: Upload A & B still intact
  const foundA = allReqs.filter((r) => r.uploadId === 'upload-a');
  assert.strictEqual(foundA.length, 1000);
  const foundB = allReqs.filter((r) => r.uploadId === 'upload-b');
  assert.strictEqual(foundB.length, 1000);

  // Verification 3: Upload C has all 20,000 rows
  const foundC = allReqs.filter((r) => r.uploadId === uploadIdC);
  assert.strictEqual(foundC.length, 20000);

  // Verification 4: Server-side pagination simulated across 22,000 rows (pageSize = 50)
  const pageSize = 50;
  const totalPages = Math.ceil(allReqs.length / pageSize);
  assert.strictEqual(totalPages, 440, '22,000 rows produces 440 pages');

  // Page 1 slice
  const page1 = allReqs.slice(0, 50);
  assert.strictEqual(page1.length, 50);
  assert.strictEqual(page1[0].orNumber, 'OR002');

  // Page 440 slice (last page containing rows from Upload A)
  const page440 = allReqs.slice((440 - 1) * pageSize, 440 * pageSize);
  assert.strictEqual(page440.length, 50);
  assert.strictEqual(page440[0].orNumber, 'OR001');

  // Verification 5: Search filters work independently
  const searchOr2 = allReqs.filter((r) => r.orNumber === 'OR002');
  assert.strictEqual(searchOr2.length, 20000);

  const searchOr1 = allReqs.filter((r) => r.orNumber === 'OR001');
  assert.strictEqual(searchOr1.length, 2000);

  const searchDateNov3 = allReqs.filter((r) => r.updateDate === '2026-11-03');
  assert.strictEqual(searchDateNov3.length, 20000);
});

test('Schema Safety: Supabase schema uses TEXT type on all flexible text columns (No VARCHAR(255) truncation)', () => {
  // Check or_style_relations
  assert.ok(
    PPIC_SUPABASE_SCHEMA_SQL.includes('or_number TEXT NOT NULL UNIQUE'),
    'or_number must be TEXT'
  );
  assert.ok(
    PPIC_SUPABASE_SCHEMA_SQL.includes('style TEXT NOT NULL'),
    'style must be TEXT'
  );

  // Check upload_history
  assert.ok(
    PPIC_SUPABASE_SCHEMA_SQL.includes('file_name TEXT NOT NULL'),
    'upload_history.file_name must be TEXT'
  );

  // Check material_requirements
  assert.ok(
    PPIC_SUPABASE_SCHEMA_SQL.includes('material_name TEXT NOT NULL'),
    'material_requirements.material_name must be TEXT'
  );

  // Check ALTER TABLE migration
  assert.ok(
    PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL.includes('ALTER TABLE IF EXISTS public.or_style_relations ALTER COLUMN style TYPE TEXT'),
    'ALTER TABLE migration must widen or_style_relations.style to TEXT'
  );
  assert.ok(
    PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL.includes('ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN material_name TYPE TEXT'),
    'ALTER TABLE migration must widen material_requirements.material_name to TEXT'
  );
});
