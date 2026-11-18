import {
  MaterialItemRequirement,
  ProductionSchedule,
  MaterialRiskAssessment,
  OrRiskSummary,
  RiskLevel,
  ParetoItem,
  ScheduleConflict,
} from '../types/ppic';
import { cleanFloatPrecision, formatPpicNumber } from './excelMaterialParser';
import { doDateRangesOverlap, normalizeAssignedProductionLine } from './ganttScheduleUtils';

/**
 * A. Rasio Kekurangan:
 * Rasio Kekurangan = ((Kebutuhan - Diterima) / Kebutuhan) x 100%
 */
export function calculateShortageRatio(required: number, received: number): number {
  if (required <= 0 || received >= required) {
    return 0;
  }
  const shortage = required - received;
  return (shortage / required) * 100;
}

/**
 * B. Skor Kekurangan:
 * 0% -> 0
 * >0–10% -> 25
 * >10–30% -> 50
 * >30–50% -> 75
 * >50% -> 100
 */
export function calculateShortageScore(ratio: number): number {
  if (ratio <= 0) return 0;
  if (ratio <= 10) return 25;
  if (ratio <= 30) return 50;
  if (ratio <= 50) return 75;
  return 100;
}

/**
 * C. Skor Urgensi Produksi:
 * Lebih dari 14 hari -> 0
 * 8–14 hari -> 25
 * 4–7 hari -> 50
 * 1–3 hari -> 75
 * Hari ini atau sudah lewat (<= 0 hari) -> 100
 */
export function calculateUrgencyScore(daysToProduction: number): number {
  if (daysToProduction > 14) return 0;
  if (daysToProduction >= 8) return 25;
  if (daysToProduction >= 4) return 50;
  if (daysToProduction >= 1) return 75;
  return 100;
}

/**
 * D. Rumus Risk Score:
 * Risk Score = (60% x Skor Kekurangan) + (40% x Skor Urgensi)
 */
export function calculateRiskScore(shortageScore: number, urgencyScore: number): number {
  const score = (0.6 * shortageScore) + (0.4 * urgencyScore);
  return Math.round(score * 10) / 10;
}

/**
 * E. Kategori Risiko:
 * 0–29: LOW
 * 30–59: MEDIUM
 * 60–79: HIGH
 * 80–100: CRITICAL
 */
export function getRiskCategory(riskScore: number): RiskLevel {
  if (riskScore < 30) return 'LOW';
  if (riskScore < 60) return 'MEDIUM';
  if (riskScore < 80) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Hitung selisih hari antara referensi tanggal (hari ini) dengan target tanggal (YYYY-MM-DD)
 */
export function getDaysDifference(targetDateStr: string, referenceDate: Date = new Date()): number {
  if (!targetDateStr) return 999;
  const target = new Date(targetDateStr);
  const ref = new Date(referenceDate);
  // Zero out time
  target.setHours(0, 0, 0, 0);
  ref.setHours(0, 0, 0, 0);
  const diffTime = target.getTime() - ref.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Normalisasi No. OR untuk perbandingan konflik jadwal agar variasi format penyimpanan
 * (spasi berlebih, NBSP/zero-width, Unicode dash, prefix "OR ", "OR.", "OR-", "NO. OR",
 * leading zero numerik, atau path "OR/YYYY/MM/1097") tidak membuat No. OR yang sama dianggap berbeda.
 */
export function normalizeOrNumberForConflict(rawOr: string | null | undefined): string {
  const cleaned = String(rawOr || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .trim()
    .toUpperCase();

  if (!cleaned || cleaned === '-') return '';

  let segment = cleaned;
  if (segment.includes('/')) {
    const parts = segment
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    segment = parts.length > 0 ? parts[parts.length - 1] : '';
  }

  // Hapus prefix opsional "NO" / "NO." / "NOMOR" di depan OR/angka
  segment = segment.replace(/^(?:NOMOR|NO)(?:[.\s\-_:#]+|(?=\d|OR\b))/i, '').trim();

  // Hapus prefix opsional "OR" apabila diikuti pemisah/titik atau langsung angka (mis. "OR 1097", "OR.1097", "OR-1097", "OR1097")
  segment = segment.replace(/^OR(?:[.\s\-_:#]+|(?=\d))/i, '');

  // Hilangkan seluruh spasi internal yang tidak diperlukan
  segment = segment.replace(/\s+/g, '');

  // Normalisasi angka murni berawalan nol (mis. "01036" -> "1036")
  if (/^\d+$/.test(segment)) {
    segment = segment.replace(/^0+(?=\d)/, '');
  }

  return segment;
}

/**
 * Mengambil No. OR ter-normalisasi dari jadwal tersimpan;
 * jika kolom orNumber kosong/"-", fallback ke snapshot worksheets agar jadwal lama tetap konsisten.
 */
export function resolveScheduleOrForConflict(
  schedule: Pick<ProductionSchedule, 'orNumber' | 'worksheets'>
): string {
  const primary = normalizeOrNumberForConflict(schedule.orNumber);
  if (primary) return primary;

  if (Array.isArray(schedule.worksheets)) {
    for (const ws of schedule.worksheets) {
      const fromWs = normalizeOrNumberForConflict(ws?.orNumber || ws?.rawOrNumber);
      if (fromWs) return fromWs;
    }
  }
  return '';
}

/**
 * Deteksi bentrok jadwal pada lini yang sama.
 * Aturan:
 * 1. No. OR sama + Line sama + tanggal bertumpuk = BUKAN BENTROK.
 * 2. No. OR berbeda + Line sama + tanggal bertumpuk = BENTROK.
 * 3. No. OR berbeda + tanggal tidak bertumpuk = BUKAN BENTROK.
 * Overlap: startA <= finishB && finishA >= startB
 */
export function detectScheduleConflicts(schedules: ProductionSchedule[]): Map<string, ScheduleConflict> {
  const conflictMap = new Map<string, ScheduleConflict>();

  for (let i = 0; i < schedules.length; i++) {
    const s1 = schedules[i];
    const line1 = normalizeAssignedProductionLine(s1.productionLine);
    if (!line1) {
      // Unassigned schedules or legacy placeholder ('Produksi') must never generate false line collisions
      continue;
    }

    const or1 = resolveScheduleOrForConflict(s1);
    const conflictingWith: ScheduleConflict['conflictingWith'] = [];

    for (let j = 0; j < schedules.length; j++) {
      if (i === j) continue;
      const s2 = schedules[j];
      const line2 = normalizeAssignedProductionLine(s2.productionLine);
      if (!line2 || line1.toLowerCase() !== line2.toLowerCase()) continue;

      const or2 = resolveScheduleOrForConflict(s2);
      if (or1 && or2 && or1 === or2) {
        // Same normalized No. OR on the same Production Line is NEVER a schedule conflict
        continue;
      }

      if (doDateRangesOverlap(s1.productionDate, s1.finishDate, s2.productionDate, s2.finishDate)) {
        conflictingWith.push({
          id: s2.id,
          orNumber: s2.orNumber,
          worksheetNo: s2.worksheets?.[0]?.worksheetNo || undefined,
          style: s2.style,
          productionDate: s2.productionDate,
          finishDate: s2.finishDate,
        });
      }
    }

    if (conflictingWith.length > 0) {
      conflictMap.set(s1.id, {
        scheduleId: s1.id,
        orNumber: s1.orNumber,
        line: line1,
        productionDate: s1.productionDate,
        finishDate: s1.finishDate,
        conflictingWith,
      });
    }
  }

  return conflictMap;
}

export interface LineConflictPair {
  key: string;
  scheduleA: {
    id: string;
    orNumber: string;
    normalizedOr: string;
    worksheetNo?: string;
    style: string;
    productionDate: string;
    finishDate: string;
  };
  scheduleB: {
    id: string;
    orNumber: string;
    normalizedOr: string;
    worksheetNo?: string;
    style: string;
    productionDate: string;
    finishDate: string;
  };
  reason: string;
}

export interface LineConflictSummary {
  hasConflict: boolean;
  conflictingScheduleCount: number;
  conflictingScheduleIds: Set<string>;
  conflictPairs: LineConflictPair[];
}

/**
 * Menghitung ringkasan konflik aktual pada satu baris Line Produksi berdasarkan hasil detectScheduleConflicts.
 * Digunakan bersama oleh badge Bentrok Jadwal, garis kuning bar Gantt, dan perhitungan jumlah jadwal konflik.
 */
export function summarizeLineConflicts(
  lineSchedules: ProductionSchedule[],
  conflictMap: Map<string, ScheduleConflict>
): LineConflictSummary {
  const conflictingScheduleIds = new Set<string>();
  const pairMap = new Map<string, LineConflictPair>();

  for (const sch of lineSchedules) {
    const conflict = conflictMap.get(sch.id);
    if (!conflict) continue;
    conflictingScheduleIds.add(sch.id);

    const normA = resolveScheduleOrForConflict(sch);
    const prodA = sch.worksheets?.[0]?.worksheetNo || undefined;

    for (const other of conflict.conflictingWith) {
      const sortedIds = [sch.id, other.id].sort();
      const pairKey = `${sortedIds[0]}__${sortedIds[1]}`;
      if (pairMap.has(pairKey)) continue;

      const normB = normalizeOrNumberForConflict(other.orNumber);
      const isFirstA = sch.id <= other.id;

      const itemA = {
        id: sch.id,
        orNumber: sch.orNumber,
        normalizedOr: normA,
        worksheetNo: prodA,
        style: sch.style,
        productionDate: sch.productionDate,
        finishDate: sch.finishDate,
      };
      const itemB = {
        id: other.id,
        orNumber: other.orNumber,
        normalizedOr: normB,
        worksheetNo: other.worksheetNo,
        style: other.style,
        productionDate: other.productionDate,
        finishDate: other.finishDate,
      };

      const first = isFirstA ? itemA : itemB;
      const second = isFirstA ? itemB : itemA;

      pairMap.set(pairKey, {
        key: pairKey,
        scheduleA: first,
        scheduleB: second,
        reason: `Line sama (${conflict.line}), No. OR berbeda (${first.normalizedOr || first.orNumber || '-'} vs ${second.normalizedOr || second.orNumber || '-'}), dan tanggal tumpang tindih (${first.productionDate} s/d ${first.finishDate} vs ${second.productionDate} s/d ${second.finishDate}).`,
      });
    }
  }

  return {
    hasConflict: conflictingScheduleIds.size > 0,
    conflictingScheduleCount: conflictingScheduleIds.size,
    conflictingScheduleIds,
    conflictPairs: Array.from(pairMap.values()),
  };
}

/**
 * 6. Material Risk Analysis Penilaian Lengkap:
 * - Ambil OR dari jadwal produksi
 * - Bandingkan kebutuhan dengan jumlah diterima
 * - Hitung skor kekurangan, urgensi, dan risk score
 * - Tangani OR tanpa jadwal dan data tidak lengkap
 */
export function assessAllMaterialRisks(
  requirements: MaterialItemRequirement[],
  schedules: ProductionSchedule[],
  today: Date = new Date()
): {
  materialAssessments: MaterialRiskAssessment[];
  orSummaries: OrRiskSummary[];
} {
  const materialAssessments: MaterialRiskAssessment[] = [];
  const orSummariesMap = new Map<string, OrRiskSummary>();

  // Map schedules by OR Number. An OR may have multiple schedules!
  const schedulesByOr = new Map<string, ProductionSchedule[]>();
  for (const sch of schedules) {
    const existing = schedulesByOr.get(sch.orNumber) || [];
    existing.push(sch);
    schedulesByOr.set(sch.orNumber, existing);
  }

  for (const req of requirements) {
    // Validate complete data
    const isComplete =
      Boolean(req.orNumber && req.materialCode && req.requiredQty !== undefined && req.receivedQty !== undefined);

    const matchingSchedules = schedulesByOr.get(req.orNumber) || [];

    // If no schedule exists for this OR:
    if (matchingSchedules.length === 0) {
      const shortage = Math.max(0, req.requiredQty - req.receivedQty);
      const ratio = calculateShortageRatio(req.requiredQty, req.receivedQty);
      const shortageScore = calculateShortageScore(ratio);

      materialAssessments.push({
        id: `risk-nosch-${req.id}`,
        orNumber: req.orNumber,
        style: req.style || '-',
        materialCode: req.materialCode,
        materialName: req.materialName,
        category: req.category,
        unit: req.unit,
        requiredQty: req.requiredQty,
        receivedQty: req.receivedQty,
        shortageQty: shortage,
        shortageRatio: Math.round(ratio * 10) / 10,
        shortageScore,
        productionDate: '',
        finishDate: '',
        productionLine: '-',
        daysToProduction: 999,
        urgencyScore: 0,
        riskScore: 0, // No final risk score without schedule
        riskCategory: 'LOW',
        hasSchedule: false,
        isCompleteData: isComplete,
        recommendedAction: 'Belum ada jadwal produksi tersimpan untuk OR ini. Input jadwal pada Kalender Produksi.',
      });
      continue;
    }

    // Evaluate for EACH schedule of this OR (as requested: "Jika satu OR mempunyai beberapa jadwal produksi, lakukan penilaian berdasarkan masing-masing jadwal")
    for (const sch of matchingSchedules) {
      const shortage = Math.max(0, req.requiredQty - req.receivedQty);
      const ratio = calculateShortageRatio(req.requiredQty, req.receivedQty);
      const shortageScore = calculateShortageScore(ratio);
      const days = getDaysDifference(sch.productionDate, today);
      const urgencyScore = calculateUrgencyScore(days);

      // Rule: "Jika seluruh kebutuhan material sudah terpenuhi, status risiko material adalah LOW."
      let riskScore = 0;
      let riskCategory: RiskLevel = 'LOW';

      if (shortage <= 0) {
        riskScore = 0;
        riskCategory = 'LOW';
      } else {
        riskScore = calculateRiskScore(shortageScore, urgencyScore);
        riskCategory = getRiskCategory(riskScore);
      }

      let recommendation = 'Kebutuhan material telah 100% terpenuhi. Siap produksi.';
      if (riskCategory === 'CRITICAL') {
        recommendation = `CRITICAL (${riskScore}/100): Defisit ${formatPpicNumber(shortage)} ${req.unit} dengan waktu tersisa ${days} hari. Segera percepat pengiriman vendor atau lakukan rescheduling.`;
      } else if (riskCategory === 'HIGH') {
        recommendation = `HIGH RISK (${riskScore}/100): Defisit ${formatPpicNumber(shortage)} ${req.unit} (${Math.round(ratio)}%). Terbitkan PO Express atau koordinasi pengiriman parsial.`;
      } else if (riskCategory === 'MEDIUM') {
        recommendation = `MEDIUM RISK (${riskScore}/100): Terdapat kekurangan ${formatPpicNumber(shortage)} ${req.unit}. Jadwal produksi masih memiliki buffer waktu ${days} hari.`;
      }

      materialAssessments.push({
        id: `risk-${req.id}-${sch.id}`,
        orNumber: req.orNumber,
        style: req.style || sch.style,
        materialCode: req.materialCode,
        materialName: req.materialName,
        category: req.category,
        unit: req.unit,
        requiredQty: req.requiredQty,
        receivedQty: req.receivedQty,
        shortageQty: shortage,
        shortageRatio: Math.round(ratio * 10) / 10,
        shortageScore,
        productionDate: sch.productionDate,
        finishDate: sch.finishDate,
        productionLine: normalizeAssignedProductionLine(sch.productionLine),
        daysToProduction: days,
        urgencyScore,
        riskScore,
        riskCategory,
        hasSchedule: true,
        isCompleteData: isComplete,
        recommendedAction: recommendation,
      });
    }
  }

  // Aggregate by OR Summary
  const groupedByOrKey = new Map<string, MaterialRiskAssessment[]>();
  for (const item of materialAssessments) {
    const key = `${item.orNumber}__${item.productionDate}`;
    const list = groupedByOrKey.get(key) || [];
    list.push(item);
    groupedByOrKey.set(key, list);
  }

  for (const [key, items] of groupedByOrKey.entries()) {
    const first = items[0];
    const readyCount = items.filter((i) => i.shortageQty === 0).length;
    const notReadyCount = items.length - readyCount;
    const scheduledItems = items.filter((i) => i.hasSchedule);

    let maxScore = 0;
    let avgScore = 0;
    let highestCat: RiskLevel = 'LOW';

    if (scheduledItems.length > 0) {
      maxScore = Math.max(...scheduledItems.map((i) => i.riskScore));
      avgScore = Math.round(scheduledItems.reduce((acc, i) => acc + i.riskScore, 0) / scheduledItems.length);
      highestCat = getRiskCategory(maxScore);
    }

    orSummariesMap.set(key, {
      orNumber: first.orNumber,
      style: first.style,
      productionDate: first.productionDate,
      finishDate: first.finishDate,
      productionLine: first.productionLine,
      totalMaterials: items.length,
      readyMaterialsCount: readyCount,
      notReadyMaterialsCount: notReadyCount,
      highestRiskScore: maxScore,
      highestRiskCategory: highestCat,
      averageRiskScore: avgScore,
      materials: items,
      hasSchedule: first.hasSchedule,
    });
  }

  return {
    materialAssessments,
    orSummaries: Array.from(orSummariesMap.values()),
  };
}

/**
 * Pareto Chart Calculator:
 * - Urutkan material berdasarkan nilai kekurangan terbesar (shortageValue = shortageQty * unitPrice)
 * - Tampilkan persentase kontribusi dan persentase kumulatif
 */
export function calculateParetoAnalysis(
  requirements: MaterialItemRequirement[],
  filterOr?: string
): ParetoItem[] {
  const filtered = filterOr && filterOr !== 'ALL'
    ? requirements.filter((r) => r.orNumber === filterOr)
    : requirements;

  // Group by materialCode
  const materialMap = new Map<
    string,
    {
      materialCode: string;
      materialName: string;
      unit: any;
      shortageQty: number;
      shortageValue: number;
    }
  >();

  for (const req of filtered) {
    const shortage = cleanFloatPrecision(Math.max(0, req.requiredQty - req.receivedQty));
    const value = shortage * (req.unitPrice || 1000);

    const existing = materialMap.get(req.materialCode) || {
      materialCode: req.materialCode,
      materialName: req.materialName,
      unit: req.unit,
      shortageQty: 0,
      shortageValue: 0,
    };

    existing.shortageQty = cleanFloatPrecision(existing.shortageQty + shortage);
    existing.shortageValue += value;
    materialMap.set(req.materialCode, existing);
  }

  // Filter only items with shortage > 0
  const itemsWithShortage = Array.from(materialMap.values()).filter((i) => i.shortageQty > 0);

  // Sort descending by shortageValue (or shortageQty if price is 0)
  itemsWithShortage.sort((a, b) => b.shortageValue - a.shortageValue || b.shortageQty - a.shortageQty);

  const totalShortageValue = itemsWithShortage.reduce((sum, item) => sum + item.shortageValue, 0);

  let cumulativeVal = 0;
  return itemsWithShortage.map((item) => {
    cumulativeVal += item.shortageValue;
    const contributionPercent =
      totalShortageValue > 0 ? (item.shortageValue / totalShortageValue) * 100 : 0;
    const cumulativePercent =
      totalShortageValue > 0 ? (cumulativeVal / totalShortageValue) * 100 : 100;

    return {
      materialCode: item.materialCode,
      materialName: item.materialName,
      unit: item.unit,
      shortageQty: cleanFloatPrecision(item.shortageQty),
      shortageValue: Math.round(item.shortageValue),
      contributionPercent: Math.round(contributionPercent * 10) / 10,
      cumulativePercent: Math.min(100, Math.round(cumulativePercent * 10) / 10),
    };
  });
}

/**
 * Dashboard Material Comparison Metrics (Kebutuhan vs Diterima & Ready vs Belum Ready)
 */
export function calculateMaterialComparisonMetrics(
  requirements: MaterialItemRequirement[],
  filterOr?: string
) {
  const filtered = filterOr && filterOr !== 'ALL'
    ? requirements.filter((r) => r.orNumber === filterOr)
    : requirements;

  let totalRequired = 0;
  let totalReceived = 0;
  let readyCount = 0;
  let notReadyCount = 0;

  for (const req of filtered) {
    totalRequired += req.requiredQty;
    totalReceived += req.receivedQty;
    if (req.receivedQty >= req.requiredQty) {
      readyCount++;
    } else {
      notReadyCount++;
    }
  }

  const fulfillmentRatio =
    totalRequired > 0 ? Math.min(100, Math.round((totalReceived / totalRequired) * 100)) : 100;

  const cleanTotalRequired = cleanFloatPrecision(totalRequired);
  const cleanTotalReceived = cleanFloatPrecision(totalReceived);

  return {
    totalRequired: cleanTotalRequired,
    totalReceived: cleanTotalReceived,
    shortageTotal: Math.max(0, cleanFloatPrecision(cleanTotalRequired - cleanTotalReceived)),
    fulfillmentRatio,
    readyCount,
    notReadyCount,
    totalCount: filtered.length,
    readyPercentage: filtered.length > 0 ? Math.round((readyCount / filtered.length) * 100) : 100,
    notReadyPercentage: filtered.length > 0 ? Math.round((notReadyCount / filtered.length) * 100) : 0,
  };
}
