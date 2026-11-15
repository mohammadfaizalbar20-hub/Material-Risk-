import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  EXCEL_SHEET_TO_JSON_OPTIONS,
  cleanFloatPrecision,
  filterNonEmptyExcelRows,
  formatPpicNumber,
  parseExcelNumberDetailed,
  parseExcelRowsToMaterials,
  parseNumberSafe,
  preserveSourceUnit,
} from '../src/utils/excelMaterialParser.ts';
import {
  calculateMaterialComparisonMetrics,
  calculateParetoAnalysis,
} from '../src/utils/ppicCalculations.ts';
import {
  mapDbMaterialToModel,
  mapDbRequirementToModel,
  mapModelToDbMaterial,
  mapModelToDbRequirement,
} from '../src/lib/supabase.ts';
import { Material } from '../src/types/ppic.ts';

function readRowsFromSyntheticWorkbook(rows: Record<string, any>[]): any[] {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Order_Lines');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const parsedWb = XLSX.read(buf, { type: 'buffer' });
  const sheet = parsedWb.Sheets[parsedWb.SheetNames[0]];
  return filterNonEmptyExcelRows(XLSX.utils.sheet_to_json(sheet, EXCEL_SHEET_TO_JSON_OPTIONS));
}

test('1. Unit preservation: keeps exact Excel UoM strings without fallback to Kg', () => {
  const units = ['Gros', 'kg', 'Pcs', 'yard', 'Dozen(s)', 'CNS', 'Set'];
  for (const unit of units) {
    assert.equal(preserveSourceUnit(unit), unit);
  }
  assert.equal(preserveSourceUnit('  Gros  '), 'Gros');
  assert.equal(preserveSourceUnit(''), '');
  assert.equal(preserveSourceUnit(null), '');
  assert.equal(preserveSourceUnit(undefined), '');
});

test('2. Real XLSX workbook preserves Gros, lowercase kg/yard, Dozen(s), CNS, Set, and blank unit even if catalog has Kg', () => {
  const existingCatalog: Material[] = [
    {
      id: 'mat-btn-01',
      code: 'BTN-01',
      name: 'Kancing Baju 4 Lubang',
      category: 'Auxiliary',
      unit: 'Kg',
      totalStock: 0,
      allocatedStock: 0,
      safetyStock: 0,
      leadTimeDays: 7,
      supplierName: 'PT Kancing',
      defaultWarehouse: 'WH-01',
      unitPrice: 12000,
      minOrderQty: 1,
    },
  ];

  const excelRows = [
    {
      'Order Lines/Product/Display Name': '[BTN-01] Kancing Baju 4 Lubang',
      'Order Lines/Quantity': 50,
      'Order Lines/Received Qty': 25,
      'Order Lines/Product Unit of Measure/Display Name': 'Gros',
    },
    {
      'Order Lines/Product/Display Name': '[THR-02] Benang Obras',
      'Order Lines/Quantity': 12.5,
      'Order Lines/Received Qty': 12.5,
      'Order Lines/Product Unit of Measure/Display Name': 'CNS',
    },
    {
      'Order Lines/Product/Display Name': '[FAB-03] Kain Katun Combed',
      'Order Lines/Quantity': 100,
      'Order Lines/Received Qty': 80,
      'Order Lines/Product Unit of Measure/Display Name': 'kg',
    },
    {
      'Order Lines/Product/Display Name': '[LIN-04] Interlining Fusible',
      'Order Lines/Quantity': 200,
      'Order Lines/Received Qty': 200,
      'Order Lines/Product Unit of Measure/Display Name': 'yard',
    },
    {
      'Order Lines/Product/Display Name': '[ACC-05] Elastic Band',
      'Order Lines/Quantity': 15,
      'Order Lines/Received Qty': 10,
      'Order Lines/Product Unit of Measure/Display Name': 'Dozen(s)',
    },
    {
      'Order Lines/Product/Display Name': '[SET-06] Hangtag & Care Label Set',
      'Order Lines/Quantity': 500,
      'Order Lines/Received Qty': 500,
      'Order Lines/Product Unit of Measure/Display Name': 'Set',
    },
    {
      'Order Lines/Product/Display Name': '[PCS-07] Polybag Packaging',
      'Order Lines/Quantity': 1000,
      'Order Lines/Received Qty': 900,
      'Order Lines/Product Unit of Measure/Display Name': 'Pcs',
    },
    {
      'Order Lines/Product/Display Name': '[EMPTY-08] Material Tanpa Satuan',
      'Order Lines/Quantity': 10,
      'Order Lines/Received Qty': 5,
      'Order Lines/Product Unit of Measure/Display Name': null,
    },
  ];

  const rawJson = readRowsFromSyntheticWorkbook(excelRows);
  const parsed = parseExcelRowsToMaterials(rawJson, existingCatalog, 'OR-TEST-UNIT', 'Test Jacket', '2026-11-15');

  assert.equal(parsed.requirements.length, 8);
  assert.deepEqual(
    parsed.requirements.map((r) => r.unit),
    ['Gros', 'CNS', 'kg', 'yard', 'Dozen(s)', 'Set', 'Pcs', '']
  );
  // Existing catalog unit must NOT override Excel 'Gros'
  assert.equal(parsed.requirements[0].materialCode, 'BTN-01');
  assert.equal(parsed.requirements[0].unit, 'Gros');
});

test('3. Number parsing preserves decimals, Indonesian/US separators, and numeric 0 without corruption', () => {
  assert.equal(parseNumberSafe('104,9160'), 104.916);
  assert.equal(parseNumberSafe('2.498,0000'), 2498);
  assert.equal(parseNumberSafe('2,498.0000'), 2498);
  assert.equal(parseNumberSafe(104.9167), 104.9167);
  assert.equal(parseNumberSafe(0), 0);
  assert.equal(parseNumberSafe('0'), 0);

  const emptyResult = parseExcelNumberDetailed(null, 0);
  assert.equal(emptyResult.isEmpty, true);
  assert.equal(emptyResult.value, 0);

  const zeroResult = parseExcelNumberDetailed(0, 0);
  assert.equal(zeroResult.isEmpty, false);
  assert.equal(zeroResult.value, 0);

  assert.equal(formatPpicNumber(104.9167), '104,9167');
  assert.equal(formatPpicNumber(104.916), '104,916');
  assert.equal(formatPpicNumber(2498), '2.498');
  assert.equal(formatPpicNumber(0), '0');
});

test('4. Column isolation: blank Quantity/Received/UoM cells never steal values from adjacent columns', () => {
  const excelRows = [
    {
      'Order Lines/Product/Display Name': '[M-01] Blank Quantity With Populated Received',
      'Order Lines/Quantity': null,
      'Order Lines/Received Qty': 150,
      'Order Lines/Product Unit of Measure/Display Name': 'Pcs',
      'Unit Price': 99000,
    },
    {
      'Order Lines/Product/Display Name': '[M-02] Blank Received With Populated Quantity',
      'Order Lines/Quantity': 75,
      'Order Lines/Received Qty': null,
      'Order Lines/Product Unit of Measure/Display Name': null,
      'Unit Price': 85000,
    },
    {
      'Order Lines/Product/Display Name': '[M-03] Explicit Zero Quantity & Received',
      'Order Lines/Quantity': 0,
      'Order Lines/Received Qty': 0,
      'Order Lines/Product Unit of Measure/Display Name': 'Gros',
      'Unit Price': 12500,
    },
  ];

  const rawJson = readRowsFromSyntheticWorkbook(excelRows);
  const parsed = parseExcelRowsToMaterials(rawJson, [], 'OR-ISOLATION', 'Style A', '2026-11-15');

  // All 3 rows must be preserved (zero/empty rows are never dropped)
  assert.equal(parsed.requirements.length, 3);

  // Row 1: blank Quantity stays 0, does not become 150
  assert.equal(parsed.requirements[0].materialCode, 'M-01');
  assert.equal(parsed.requirements[0].requiredQty, 0);
  assert.equal(parsed.requirements[0].receivedQty, 150);
  assert.equal(parsed.requirements[0].unit, 'Pcs');

  // Row 2: blank Received stays 0, blank UoM stays '' (does NOT become '85000' from Unit Price)
  assert.equal(parsed.requirements[1].materialCode, 'M-02');
  assert.equal(parsed.requirements[1].requiredQty, 75);
  assert.equal(parsed.requirements[1].receivedQty, 0);
  assert.equal(parsed.requirements[1].unit, '');

  // Row 3: numeric 0 preserved, Gros preserved
  assert.equal(parsed.requirements[2].materialCode, 'M-03');
  assert.equal(parsed.requirements[2].requiredQty, 0);
  assert.equal(parsed.requirements[2].receivedQty, 0);
  assert.equal(parsed.requirements[2].unit, 'Gros');
});

test('5. Row preservation: duplicate material codes and localized decimal sheet remain distinct and unmerged', () => {
  const excelRows = [
    {
      'Order Lines/Product/Display Name': '[FAB-DUP] Kain Rib Warna Navy',
      'Order Lines/Quantity': '104,9160',
      'Order Lines/Received Qty': '104,9160',
      'Order Lines/Product Unit of Measure/Display Name': 'kg',
    },
    {
      'Order Lines/Product/Display Name': '[FAB-DUP] Kain Rib Warna Navy',
      'Order Lines/Quantity': '2.498,0000',
      'Order Lines/Received Qty': '1.000,5000',
      'Order Lines/Product Unit of Measure/Display Name': 'Gros',
    },
    {
      'Order Lines/Product/Display Name': null,
      'Order Lines/Quantity': null,
      'Order Lines/Received Qty': null,
      'Order Lines/Product Unit of Measure/Display Name': null,
    },
  ];

  const rawJson = readRowsFromSyntheticWorkbook(excelRows);
  // Truly all-blank 3rd row filtered out; 2 valid rows remain distinct
  assert.equal(rawJson.length, 2);

  const parsed = parseExcelRowsToMaterials(rawJson, [], 'OR-DUP-01', 'Style Dup', '2026-11-15');
  assert.equal(parsed.requirements.length, 2);

  assert.equal(parsed.requirements[0].materialCode, 'FAB-DUP');
  assert.equal(parsed.requirements[0].requiredQty, 104.916);
  assert.equal(parsed.requirements[0].receivedQty, 104.916);
  assert.equal(parsed.requirements[0].unit, 'kg');

  assert.equal(parsed.requirements[1].materialCode, 'FAB-DUP');
  assert.equal(parsed.requirements[1].requiredQty, 2498);
  assert.equal(parsed.requirements[1].receivedQty, 1000.5);
  assert.equal(parsed.requirements[1].unit, 'Gros');
});

test('6. End-to-end parity: Excel -> Preview -> Supabase mappers -> Master Data -> Dashboard', () => {
  const excelRows = [
    {
      'Order Lines/Product/Display Name': '[BTN-GROS] Kancing Metal Snap',
      'Order Lines/Quantity': 104.9167,
      'Order Lines/Received Qty': 100.4167,
      'Order Lines/Product Unit of Measure/Display Name': 'Gros',
      'Harga Satuan (IDR)': 15000,
    },
    {
      'Order Lines/Product/Display Name': '[ZERO-ITEM] Benang Cadangan',
      'Order Lines/Quantity': 0,
      'Order Lines/Received Qty': 0,
      'Order Lines/Product Unit of Measure/Display Name': 'CNS',
      'Harga Satuan (IDR)': 5000,
    },
  ];

  const rawJson = readRowsFromSyntheticWorkbook(excelRows);
  const parsed = parseExcelRowsToMaterials(rawJson, [], 'OR-E2E-001', 'E2E Parka', '2026-11-15');

  // Preview shortage & readiness
  const previewShortages = parsed.requirements.map((r) => cleanFloatPrecision(r.receivedQty - r.requiredQty));
  assert.deepEqual(previewShortages, [-4.5, 0]);
  assert.equal(formatPpicNumber(parsed.requirements[0].requiredQty), '104,9167');
  assert.equal(formatPpicNumber(parsed.requirements[0].receivedQty), '100,4167');

  // Supabase roundtrip serialization/deserialization (simulated NUMERIC string & exact unit)
  const dbRows = parsed.requirements.map((req) => {
    const dbPayload = mapModelToDbRequirement({
      ...req,
      id: '11111111-1111-4111-8111-111111111111',
      uploadId: '22222222-2222-4222-8222-222222222222',
    });
    return {
      ...dbPayload,
      required_qty: String(dbPayload.required_qty),
      received_qty: String(dbPayload.received_qty),
      unit_price: String(dbPayload.unit_price),
      imported_at: req.importedAt,
      created_at: req.importedAt,
    };
  });

  const roundtripped = dbRows.map(mapDbRequirementToModel);
  assert.equal(roundtripped[0].unit, 'Gros');
  assert.equal(roundtripped[0].requiredQty, 104.9167);
  assert.equal(roundtripped[0].receivedQty, 100.4167);
  assert.equal(roundtripped[1].unit, 'CNS');
  assert.equal(roundtripped[1].requiredQty, 0);
  assert.equal(roundtripped[1].receivedQty, 0);

  // Master material roundtrip preserves unit and precision
  const dbMaster = mapModelToDbMaterial({
    ...parsed.newMasterMaterials[0],
    id: '33333333-3333-4333-8333-333333333333',
  });
  const masterRoundtrip = mapDbMaterialToModel(dbMaster);
  assert.equal(masterRoundtrip.unit, 'Gros');
  assert.equal(masterRoundtrip.allocatedStock, 104.9167);
  assert.equal(masterRoundtrip.totalStock, 100.4167);

  // Dashboard metrics preserve 4-decimal sums instead of rounding to integers
  const metrics = calculateMaterialComparisonMetrics(roundtripped, 'OR-E2E-001');
  assert.equal(metrics.totalRequired, 104.9167);
  assert.equal(metrics.totalReceived, 100.4167);
  assert.equal(metrics.shortageTotal, 4.5);
  assert.equal(metrics.readyCount, 1);
  assert.equal(metrics.notReadyCount, 1);

  const pareto = calculateParetoAnalysis(roundtripped, 'OR-E2E-001');
  assert.equal(pareto.length, 1);
  assert.equal(pareto[0].unit, 'Gros');
  assert.equal(pareto[0].shortageQty, 4.5);
});
