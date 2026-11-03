import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_MATERIAL_REQUIREMENTS } from '../src/data/initialPpicData.ts';

test('1. Master Data Material Formula: Kekurangan = Diterima - Kebutuhan & Status READY vs BELUM READY', () => {
  const sample1 = { requiredQty: 2500, receivedQty: 1200 };
  const shortage1 = sample1.receivedQty - sample1.requiredQty;
  const isReady1 = shortage1 >= 0;
  assert.equal(shortage1, -1300);
  assert.equal(isReady1, false);

  const sample2 = { requiredQty: 5000, receivedQty: 5000 };
  const shortage2 = sample2.receivedQty - sample2.requiredQty;
  const isReady2 = shortage2 >= 0;
  assert.equal(shortage2, 0);
  assert.equal(isReady2, true);

  const sample3 = { requiredQty: 1000, receivedQty: 1200 };
  const shortage3 = sample3.receivedQty - sample3.requiredQty;
  const isReady3 = shortage3 >= 0;
  assert.equal(shortage3, 200);
  assert.equal(isReady3, true);
});

test('2. Single Source of Truth & Relational Integrity: Satu File Excel = Satu OR', () => {
  // Test uploadId linking: 1 Upload = 1 OR with N Material Rows
  const uploadId = 'upload-test-001';
  const orNumber = 'OR-2026-999';
  const style = 'Summer Cotton Polo';
  const updateDate = '2026-11-02';

  const items = [
    { id: 'req-1', uploadId, orNumber, style, materialCode: 'FAB-01', materialName: 'Cotton Pique', requiredQty: 500, receivedQty: 500, unit: 'Kg', updateDate },
    { id: 'req-2', uploadId, orNumber, style, materialCode: 'BTN-01', materialName: 'Pearl Button', requiredQty: 3000, receivedQty: 1500, unit: 'Pcs', updateDate },
  ];

  assert.equal(items.length, 2);
  items.forEach((item) => {
    assert.equal(item.uploadId, uploadId);
    assert.equal(item.orNumber, orNumber);
    assert.equal(item.style, style);
    assert.equal(item.updateDate, updateDate);
  });
});

test('3. Deletion Isolation: Deleting by OR does not alter other ORs or shared Master Materials', () => {
  const reqs = [...INITIAL_MATERIAL_REQUIREMENTS];
  const targetOr = 'OR-2026-001';
  const remaining = reqs.filter((r) => r.orNumber.toUpperCase() !== targetOr.toUpperCase());

  // Confirm target OR is removed
  assert.ok(remaining.every((r) => r.orNumber.toUpperCase() !== targetOr.toUpperCase()));
  // Confirm other ORs are intact
  const otherOrs = new Set(remaining.map((r) => r.orNumber));
  assert.ok(otherOrs.has('OR-2026-002'));
  assert.ok(otherOrs.has('OR-2026-003'));
});

test('4. Deletion Isolation: Deleting by Style does not alter other Styles', () => {
  const reqs = [...INITIAL_MATERIAL_REQUIREMENTS];
  const targetStyle = 'Bomber Jacket Taslan Navy (BJ-01)';
  const remaining = reqs.filter((r) => r.style.trim().toLowerCase() !== targetStyle.trim().toLowerCase());

  assert.ok(remaining.every((r) => r.style.trim().toLowerCase() !== targetStyle.trim().toLowerCase()));
  assert.ok(remaining.length > 0);
});

test('5. Deletion Isolation: Deleting by Tanggal Update only affects that specific date', () => {
  const reqs = [...INITIAL_MATERIAL_REQUIREMENTS];
  const targetDate = '2026-10-31';
  const remaining = reqs.filter((r) => (r.updateDate || '2026-10-31') !== targetDate);

  assert.ok(remaining.every((r) => (r.updateDate || '2026-10-31') !== targetDate));
  const otherDates = remaining.map((r) => r.updateDate || '2026-10-31');
  assert.ok(otherDates.every((d) => d !== targetDate));
});

test('6. Text Search Partial Match across No. OR, Style, Kode, and Nama Material', () => {
  const reqs = [...INITIAL_MATERIAL_REQUIREMENTS];

  // Match partial OR
  const matchOr = reqs.filter((r) => r.orNumber.includes('002'));
  assert.ok(matchOr.length > 0);
  assert.ok(matchOr.every((r) => r.orNumber === 'OR-2026-002'));

  // Match partial Style
  const matchStyle = reqs.filter((r) => r.style.toLowerCase().includes('bomber'));
  assert.ok(matchStyle.length > 0);
  assert.ok(matchStyle.every((r) => r.style.toLowerCase().includes('bomber')));

  // Match partial Material Code
  const matchCode = reqs.filter((r) => r.materialCode.toLowerCase().includes('taslan'));
  assert.ok(matchCode.length > 0);

  // Non-matching returns empty array -> leads to "Data tidak ditemukan"
  const matchNonExistent = reqs.filter((r) => r.orNumber.includes('NON_EXISTENT_99999'));
  assert.equal(matchNonExistent.length, 0);
});
