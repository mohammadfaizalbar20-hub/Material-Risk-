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
