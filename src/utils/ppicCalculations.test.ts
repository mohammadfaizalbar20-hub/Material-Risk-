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
import { layoutGanttLineSchedules } from './ganttScheduleUtils';
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

test('Jadwal tanpa Line Produksi (kosong) atau placeholder lama "Produksi" TIDAK boleh memicu konflik bentrok jadwal palsu', () => {
  const schedules: ProductionSchedule[] = [
    {
      id: 'un-a',
      orNumber: 'OR-101',
      productionDate: '2026-11-05',
      finishDate: '2026-11-12',
      productionLine: '',
      style: 'Style 101',
      target: 500,
    },
    {
      id: 'un-b',
      orNumber: 'OR-102',
      productionDate: '2026-11-05',
      finishDate: '2026-11-12',
      productionLine: 'Produksi',
      style: 'Style 102',
      target: 600,
    },
    {
      id: 'un-c',
      orNumber: 'OR-103',
      productionDate: '2026-11-06',
      finishDate: '2026-11-10',
      productionLine: 'Produksi',
      style: 'Style 103',
      target: 700,
    },
    {
      id: 'real-a',
      orNumber: 'OR-201',
      productionDate: '2026-11-05',
      finishDate: '2026-11-10',
      productionLine: 'Line 1',
      style: 'Style 201',
      target: 1000,
    },
    {
      id: 'real-b',
      orNumber: 'OR-202',
      productionDate: '2026-11-08',
      finishDate: '2026-11-12',
      productionLine: 'line 1',
      style: 'Style 202',
      target: 1000,
    },
  ];

  const conflicts = detectScheduleConflicts(schedules);
  assert.equal(conflicts.has('un-a'), false);
  assert.equal(conflicts.has('un-b'), false);
  assert.equal(conflicts.has('un-c'), false);
  assert.equal(conflicts.has('real-a'), true);
  assert.equal(conflicts.has('real-b'), true);
  assert.equal(conflicts.get('real-a')?.line, 'Line 1');

  const reqs: MaterialItemRequirement[] = [
    {
      id: 'req-p1',
      orNumber: 'OR-102',
      style: 'Style 102',
      materialCode: 'MAT-X',
      materialName: 'Material X',
      category: 'Raw Material',
      unit: 'Yard',
      requiredQty: 100,
      receivedQty: 40,
      unitPrice: 1000,
    },
  ];
  const { orSummaries } = assessAllMaterialRisks(reqs, schedules, new Date('2026-11-01'));
  const summary102 = orSummaries.find((s) => s.orNumber === 'OR-102');
  assert.ok(summary102);
  assert.equal(summary102.productionLine, '');
});

test('Aturan Bentrok Jadwal: No. OR sama dengan Style berbeda tidak bentrok (tetap pisah lane), No. OR berbeda bertumpuk tetap bentrok, tidak bertumpuk tidak bentrok', () => {
  // 1. OR 1023, Style A & Style B, Line 1, tanggal bertumpuk -> TIDAK ada peringatan Bentrok Jadwal
  const sameOrDiffStyle: ProductionSchedule[] = [
    {
      id: 'or1023-a',
      orNumber: '1023',
      style: 'Style A',
      productionLine: 'Line 1',
      productionDate: '2026-11-02',
      finishDate: '2026-11-08',
      target: 500,
    },
    {
      id: 'or1023-b',
      orNumber: '1023',
      style: 'Style B',
      productionLine: 'Line 1',
      productionDate: '2026-11-04',
      finishDate: '2026-11-10',
      target: 600,
    },
  ];
  const sameOrConflicts = detectScheduleConflicts(sameOrDiffStyle);
  assert.equal(sameOrConflicts.size, 0);
  assert.equal(sameOrConflicts.has('or1023-a'), false);
  assert.equal(sameOrConflicts.has('or1023-b'), false);

  // Gantt lanes must still separate overlapping bars for OR 1023 Style A and Style B
  const laneLayout = layoutGanttLineSchedules(sameOrDiffStyle, {
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });
  assert.equal(laneLayout.laneCount, 2);
  assert.deepEqual(
    laneLayout.items.map((item) => ({ id: item.schedule.id, lane: item.laneIndex })),
    [
      { id: 'or1023-a', lane: 0 },
      { id: 'or1023-b', lane: 1 },
    ]
  );

  // 2. OR 1023 dan OR 1024, Line 1, tanggal bertumpuk -> TETAP ada peringatan Bentrok Jadwal
  const diffOrOverlap: ProductionSchedule[] = [
    {
      id: 'or1023-x',
      orNumber: '1023',
      style: 'Style A',
      productionLine: 'Line 1',
      productionDate: '2026-11-02',
      finishDate: '2026-11-08',
      target: 500,
    },
    {
      id: 'or1024-y',
      orNumber: '1024',
      style: 'Style C',
      productionLine: 'Line 1',
      productionDate: '2026-11-05',
      finishDate: '2026-11-12',
      target: 700,
    },
  ];
  const diffOrConflicts = detectScheduleConflicts(diffOrOverlap);
  assert.equal(diffOrConflicts.has('or1023-x'), true);
  assert.equal(diffOrConflicts.has('or1024-y'), true);
  assert.deepEqual(
    diffOrConflicts.get('or1023-x')?.conflictingWith.map((c) => c.orNumber),
    ['1024']
  );

  // 3. OR berbeda dengan tanggal TIDAK bertumpuk -> TIDAK ada peringatan Bentrok Jadwal
  const diffOrNonOverlap: ProductionSchedule[] = [
    {
      id: 'or1023-seq',
      orNumber: '1023',
      style: 'Style A',
      productionLine: 'Line 1',
      productionDate: '2026-11-02',
      finishDate: '2026-11-06',
      target: 500,
    },
    {
      id: 'or1024-seq',
      orNumber: '1024',
      style: 'Style B',
      productionLine: 'Line 1',
      productionDate: '2026-11-07',
      finishDate: '2026-11-12',
      target: 700,
    },
  ];
  const nonOverlapConflicts = detectScheduleConflicts(diffOrNonOverlap);
  assert.equal(nonOverlapConflicts.size, 0);
});

