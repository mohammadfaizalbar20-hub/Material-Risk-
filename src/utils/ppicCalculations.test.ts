import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateShortageRatio,
  calculateShortageScore,
  calculateUrgencyScore,
  calculateRiskScore,
  getRiskCategory,
  detectScheduleConflicts,
  normalizeOrNumberForConflict,
  resolveScheduleOrForConflict,
  summarizeLineConflicts,
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

test('Kasus Lanjutan Bentrok Jadwal: OR 1097 & OR 1036 multi-style, normalisasi No. OR, dan bentrok lintas OR', () => {
  // Normalisasi No. OR menangani spasi, NBSP, prefix OR, dan format slash
  assert.equal(normalizeOrNumberForConflict('1097'), '1097');
  assert.equal(normalizeOrNumberForConflict(' 1097\u00A0'), '1097');
  assert.equal(normalizeOrNumberForConflict('OR 1097'), '1097');
  assert.equal(normalizeOrNumberForConflict('or-1097'), '1097');
  assert.equal(normalizeOrNumberForConflict('OR/2026/06/1097'), '1097');
  assert.equal(normalizeOrNumberForConflict('10 97'), '1097');
  assert.equal(normalizeOrNumberForConflict('ORDER-1097'), 'ORDER-1097');
  assert.notEqual(normalizeOrNumberForConflict('1097'), normalizeOrNumberForConflict('1036'));

  // Case 1: OR 1097, dua Style berbeda (target 1018 & 1062) + variasi format OR, Line 1, tanggal bertumpuk -> TIDAK bentrok
  const or1097Schedules: ProductionSchedule[] = [
    {
      id: '1097-1',
      orNumber: '1097',
      style: 'Style Polo Knit',
      productionLine: 'Line 1',
      productionDate: '2026-11-02',
      finishDate: '2026-11-09',
      target: 1018,
    },
    {
      id: '1097-2',
      orNumber: ' OR 1097\u00A0',
      style: 'Style Chino Short',
      productionLine: 'Line  1',
      productionDate: '2026-11-04',
      finishDate: '2026-11-11',
      target: 1062,
    },
    {
      id: '1097-same-style',
      orNumber: 'OR/2026/06/1097',
      style: 'Style Polo Knit', // Even if style text matches on the same OR, same OR is never a conflict!
      productionLine: 'Line 1',
      productionDate: '2026-11-05',
      finishDate: '2026-11-08',
      target: 500,
    },
  ];
  assert.equal(detectScheduleConflicts(or1097Schedules).size, 0);

  const or1097Layout = layoutGanttLineSchedules(or1097Schedules, {
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });
  assert.equal(or1097Layout.laneCount, 3);
  assert.equal(or1097Layout.items.length, 3);

  // Case 2: OR 1036, dua Style berbeda, Line 1, tanggal bertumpuk -> TIDAK bentrok
  const or1036Schedules: ProductionSchedule[] = [
    {
      id: '1036-1',
      orNumber: '1036',
      style: 'Style Jacket A',
      productionLine: 'Line 1',
      productionDate: '2026-11-12',
      finishDate: '2026-11-18',
      target: 800,
    },
    {
      id: '1036-2',
      orNumber: 'OR-1036',
      style: 'Style Jacket B',
      productionLine: 'Line 1',
      productionDate: '2026-11-14',
      finishDate: '2026-11-20',
      target: 900,
    },
  ];
  assert.equal(detectScheduleConflicts(or1036Schedules).size, 0);

  // Gabungan OR 1097 (tgl 2-11) dan OR 1036 (tgl 12-20) di Line 1 tanpa irisan lintas OR -> tetap TIDAK bentrok
  assert.equal(detectScheduleConflicts([...or1097Schedules, ...or1036Schedules]).size, 0);

  // Case 3: OR 1097 dan OR 1036 pada Line 1 dengan tanggal bertumpuk -> TETAP bentrok
  const overlappingCrossOr: ProductionSchedule[] = [
    {
      id: 'x-1097',
      orNumber: '1097',
      style: 'Style A',
      productionLine: 'Line 1',
      productionDate: '2026-11-02',
      finishDate: '2026-11-10',
      target: 1018,
    },
    {
      id: 'x-1036',
      orNumber: '1036',
      style: 'Style B',
      productionLine: 'Line 1',
      productionDate: '2026-11-08',
      finishDate: '2026-11-15',
      target: 950,
    },
  ];
  const crossConflicts = detectScheduleConflicts(overlappingCrossOr);
  assert.equal(crossConflicts.has('x-1097'), true);
  assert.equal(crossConflicts.has('x-1036'), true);
  assert.deepEqual(
    crossConflicts.get('x-1097')?.conflictingWith.map((c) => c.orNumber),
    ['1036']
  );

  // Case 4: Dua OR berbeda dengan tanggal TIDAK bertumpuk -> TIDAK bentrok
  const nonOverlappingCrossOr: ProductionSchedule[] = [
    {
      id: 'n-1097',
      orNumber: '1097',
      style: 'Style A',
      productionLine: 'Line 1',
      productionDate: '2026-11-02',
      finishDate: '2026-11-10',
      target: 1018,
    },
    {
      id: 'n-1036',
      orNumber: '1036',
      style: 'Style B',
      productionLine: 'Line 1',
      productionDate: '2026-11-11',
      finishDate: '2026-11-18',
      target: 950,
    },
  ];
  assert.equal(detectScheduleConflicts(nonOverlappingCrossOr).size, 0);
});

test('Normalisasi No. OR lanjutan, fallback worksheets, dan summarizeLineConflicts pada 6 jadwal Line 1', () => {
  assert.equal(normalizeOrNumberForConflict('OR.1036'), '1036');
  assert.equal(normalizeOrNumberForConflict('OR. 1036'), '1036');
  assert.equal(normalizeOrNumberForConflict('NO. OR 1036'), '1036');
  assert.equal(normalizeOrNumberForConflict('NO OR-1036'), '1036');
  assert.equal(normalizeOrNumberForConflict('01036'), '1036');
  assert.equal(normalizeOrNumberForConflict('OR\u20131036'), '1036');

  // Fallback ke worksheets snapshot bila kolom orNumber pada baris tersimpan kosong/"-"
  assert.equal(
    resolveScheduleOrForConflict({
      orNumber: '',
      worksheets: [
        {
          id: 'ws-1',
          fileName: 'mrp.xls',
          orNumber: '1036',
          rawOrNumber: 'OR/2026/06/1036',
          worksheetNo: 'WH/MO/22744',
          style: 'Style A',
          target: 500,
          materials: [],
          uploadedAt: '2026-11-01T00:00:00Z',
        },
      ],
    }),
    '1036'
  );

  // Simulasi 6 jadwal pada Line 1 dengan 2 baris lane:
  // - 3 jadwal OR 1036 (nomor produksi berbeda & format OR berbeda) bertumpuk tgl 2-8 -> BUKAN bentrok
  // - 2 jadwal OR 1097 bertumpuk tgl 10-16 -> BUKAN bentrok
  // - 1 jadwal OR 1050 tidak bertumpuk tgl 18-22 -> BUKAN bentrok
  const sixNoConflict: ProductionSchedule[] = [
    { id: 's1', orNumber: '1036', style: 'Style 1', productionLine: 'Line 1', productionDate: '2026-11-02', finishDate: '2026-11-06', target: 500 },
    { id: 's2', orNumber: 'OR. 1036', style: 'Style 2', productionLine: 'Line 1', productionDate: '2026-11-03', finishDate: '2026-11-08', target: 600 },
    { id: 's3', orNumber: 'NO. OR 1036', style: 'Style 3', productionLine: 'Line 1', productionDate: '2026-11-07', finishDate: '2026-11-09', target: 400 },
    { id: 's4', orNumber: '1097', style: 'Style 4', productionLine: 'Line 1', productionDate: '2026-11-10', finishDate: '2026-11-15', target: 1018 },
    { id: 's5', orNumber: 'OR/2026/06/1097', style: 'Style 5', productionLine: 'Line 1', productionDate: '2026-11-12', finishDate: '2026-11-16', target: 1062 },
    { id: 's6', orNumber: '1050', style: 'Style 6', productionLine: 'Line 1', productionDate: '2026-11-18', finishDate: '2026-11-22', target: 700 },
  ];

  const conflictsNone = detectScheduleConflicts(sixNoConflict);
  const summaryNone = summarizeLineConflicts(sixNoConflict, conflictsNone);
  assert.equal(summaryNone.hasConflict, false);
  assert.equal(summaryNone.conflictingScheduleCount, 0);
  assert.equal(summaryNone.conflictPairs.length, 0);

  // Jika s4 (OR 1097) digeser mulai tgl 9 -> hanya bertumpuk dengan s3 (tgl 7-9), bukan s2 (tgl 3-8)
  const withOnePairCrossOr = sixNoConflict.map((s) =>
    s.id === 's4' ? { ...s, productionDate: '2026-11-09' } : s
  );
  const conflictsOnePair = detectScheduleConflicts(withOnePairCrossOr);
  const summaryOnePair = summarizeLineConflicts(withOnePairCrossOr, conflictsOnePair);
  assert.equal(summaryOnePair.hasConflict, true);
  assert.equal(summaryOnePair.conflictingScheduleCount, 2);
  assert.equal(summaryOnePair.conflictPairs.length, 1);
  assert.equal(summaryOnePair.conflictPairs[0].scheduleA.id, 's3');
  assert.equal(summaryOnePair.conflictPairs[0].scheduleB.id, 's4');

  // Jika s4 (OR 1097) digeser mulai tgl 8 -> bertumpuk dengan s2 (s/d tgl 8) DAN s3 (tgl 7-9) -> 3 jadwal & 2 pasangan
  const withTwoPairsCrossOr = sixNoConflict.map((s) =>
    s.id === 's4' ? { ...s, productionDate: '2026-11-08' } : s
  );
  const conflictsTwoPairs = detectScheduleConflicts(withTwoPairsCrossOr);
  const summaryTwoPairs = summarizeLineConflicts(withTwoPairsCrossOr, conflictsTwoPairs);
  assert.equal(summaryTwoPairs.hasConflict, true);
  assert.equal(summaryTwoPairs.conflictingScheduleCount, 3);
  assert.equal(summaryTwoPairs.conflictPairs.length, 2);
});



