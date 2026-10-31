import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateShortageRatio,
  calculateShortageScore,
  calculateUrgencyScore,
  calculateRiskScore,
  getRiskCategory,
  detectScheduleConflicts,
  calculateParetoAnalysis,
  assessAllMaterialRisks,
} from './ppicCalculations';
import { MaterialItemRequirement, ProductionSchedule } from '../types/ppic';

test('Formula A: Rasio Kekurangan dihitung dengan benar', () => {
  // ((1000 - 800) / 1000) * 100 = 20%
  assert.equal(calculateShortageRatio(1000, 800), 20);
  // Diterima melebihi kebutuhan -> 0%
  assert.equal(calculateShortageRatio(1000, 1200), 0);
  // Kebutuhan 0 -> 0%
  assert.equal(calculateShortageRatio(0, 0), 0);
});

test('Formula B: Skor Kekurangan sesuai tabel ambang batas', () => {
  assert.equal(calculateShortageScore(0), 0);
  assert.equal(calculateShortageScore(5), 25); // >0-10%
  assert.equal(calculateShortageScore(10), 25);
  assert.equal(calculateShortageScore(15), 50); // >10-30%
  assert.equal(calculateShortageScore(30), 50);
  assert.equal(calculateShortageScore(35), 75); // >30-50%
  assert.equal(calculateShortageScore(50), 75);
  assert.equal(calculateShortageScore(55), 100); // >50%
  assert.equal(calculateShortageScore(100), 100);
});

test('Formula C: Skor Urgensi Produksi sesuai jarak hari', () => {
  assert.equal(calculateUrgencyScore(20), 0); // >14 hari
  assert.equal(calculateUrgencyScore(14), 25); // 8-14 hari
  assert.equal(calculateUrgencyScore(10), 25);
  assert.equal(calculateUrgencyScore(8), 25);
  assert.equal(calculateUrgencyScore(7), 50); // 4-7 hari
  assert.equal(calculateUrgencyScore(4), 50);
  assert.equal(calculateUrgencyScore(3), 75); // 1-3 hari
  assert.equal(calculateUrgencyScore(1), 75);
  assert.equal(calculateUrgencyScore(0), 100); // Hari ini
  assert.equal(calculateUrgencyScore(-2), 100); // Sudah lewat
});

test('Formula D & E: Rumus Risk Score dan Kategori Risiko', () => {
  // Risk Score = (60% x Skor Kekurangan) + (40% x Skor Urgensi)
  // Shortage: 100, Urgensi: 100 -> (60 + 40) = 100 (CRITICAL)
  const scoreMax = calculateRiskScore(100, 100);
  assert.equal(scoreMax, 100);
  assert.equal(getRiskCategory(scoreMax), 'CRITICAL');

  // Shortage: 75, Urgensi: 50 -> 45 + 20 = 65 (HIGH)
  const scoreHigh = calculateRiskScore(75, 50);
  assert.equal(scoreHigh, 65);
  assert.equal(getRiskCategory(scoreHigh), 'HIGH');

  // Shortage: 25, Urgensi: 50 -> 15 + 20 = 35 (MEDIUM)
  const scoreMed = calculateRiskScore(25, 50);
  assert.equal(scoreMed, 35);
  assert.equal(getRiskCategory(scoreMed), 'MEDIUM');

  // Shortage: 0, Urgensi: 50 -> 0 + 20 = 20 (LOW)
  const scoreLow = calculateRiskScore(0, 50);
  assert.equal(scoreLow, 20);
  assert.equal(getRiskCategory(scoreLow), 'LOW');
});

test('Deteksi bentrok jadwal pada lini yang sama ketika tanggal tumpang tindih', () => {
  const mockSchedules: ProductionSchedule[] = [
    {
      id: 'sch-1',
      orNumber: 'OR-001',
      productionDate: '2026-11-01',
      finishDate: '2026-11-05',
      productionLine: 'Line 1',
      style: 'Style A',
      target: 1000,
    },
    {
      id: 'sch-2',
      orNumber: 'OR-002',
      productionDate: '2026-11-03', // Overlaps with sch-1 on Line 1!
      finishDate: '2026-11-07',
      productionLine: 'Line 1',
      style: 'Style B',
      target: 1500,
    },
    {
      id: 'sch-3',
      orNumber: 'OR-003',
      productionDate: '2026-11-01',
      finishDate: '2026-11-05',
      productionLine: 'Line 2', // Different line -> no conflict
      style: 'Style C',
      target: 800,
    },
  ];

  const conflicts = detectScheduleConflicts(mockSchedules);
  assert.equal(conflicts.has('sch-1'), true);
  assert.equal(conflicts.has('sch-2'), true);
  assert.equal(conflicts.has('sch-3'), false);
  assert.equal(conflicts.get('sch-1')?.conflictingWith[0].orNumber, 'OR-002');
});

test('Pareto Analysis: Urutkan kekurangan terbesar dan kalkulasi persentase kumulatif', () => {
  const reqs: MaterialItemRequirement[] = [
    {
      id: 'r1',
      orNumber: 'OR-001',
      style: 'Style A',
      materialCode: 'MAT-A',
      materialName: 'Fabric Cotton',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 1000,
      receivedQty: 500, // Shortage = 500 * 10.000 = 5.000.000
      unitPrice: 10000,
    },
    {
      id: 'r2',
      orNumber: 'OR-001',
      style: 'Style A',
      materialCode: 'MAT-B',
      materialName: 'Yarn Spun',
      category: 'Raw Material',
      unit: 'Kg',
      requiredQty: 2000,
      receivedQty: 1000, // Shortage = 1000 * 20.000 = 20.000.000 (Terbesar!)
      unitPrice: 20000,
    },
    {
      id: 'r3',
      orNumber: 'OR-001',
      style: 'Style A',
      materialCode: 'MAT-C',
      materialName: 'Button Pearl',
      category: 'Packaging',
      unit: 'Pcs',
      requiredQty: 5000,
      receivedQty: 5000, // Shortage = 0 (Tidak masuk pareto shortage)
      unitPrice: 500,
    },
  ];

  const pareto = calculateParetoAnalysis(reqs);
  assert.equal(pareto.length, 2);
  // Item 1 must be MAT-B (20jt)
  assert.equal(pareto[0].materialCode, 'MAT-B');
  assert.equal(pareto[0].shortageValue, 20000000);
  assert.equal(pareto[0].contributionPercent, 80);
  assert.equal(pareto[0].cumulativePercent, 80);

  // Item 2 must be MAT-A (5jt)
  assert.equal(pareto[1].materialCode, 'MAT-A');
  assert.equal(pareto[1].shortageValue, 5000000);
  assert.equal(pareto[1].contributionPercent, 20);
  assert.equal(pareto[1].cumulativePercent, 100);
});
