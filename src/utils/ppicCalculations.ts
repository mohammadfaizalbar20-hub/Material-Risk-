import {
  MaterialItemRequirement,
  ProductionSchedule,
  MaterialRiskAssessment,
  OrRiskSummary,
  RiskLevel,
  ParetoItem,
  ScheduleConflict,
} from '../types/ppic';

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
 * Deteksi bentrok jadwal pada lini yang sama
 * Jadwal bertabrakan jika: line sama, id berbeda, dan periode tanggal overlap
 * Overlap: startA <= finishB && finishA >= startB
 */
export function detectScheduleConflicts(schedules: ProductionSchedule[]): Map<string, ScheduleConflict> {
  const conflictMap = new Map<string, ScheduleConflict>();

  for (let i = 0; i < schedules.length; i++) {
    const s1 = schedules[i];
    const conflictingWith: ScheduleConflict['conflictingWith'] = [];

    for (let j = 0; j < schedules.length; j++) {
      if (i === j) continue;
      const s2 = schedules[j];

      if (s1.productionLine === s2.productionLine) {
        // Check date overlap
        const start1 = new Date(s1.productionDate).getTime();
        const end1 = new Date(s1.finishDate).getTime();
        const start2 = new Date(s2.productionDate).getTime();
        const end2 = new Date(s2.finishDate).getTime();

        const isOverlapping = start1 <= end2 && end1 >= start2;
        if (isOverlapping) {
          conflictingWith.push({
            id: s2.id,
            orNumber: s2.orNumber,
            style: s2.style,
            productionDate: s2.productionDate,
            finishDate: s2.finishDate,
          });
        }
      }
    }

    if (conflictingWith.length > 0) {
      conflictMap.set(s1.id, {
        scheduleId: s1.id,
        orNumber: s1.orNumber,
        line: s1.productionLine,
        productionDate: s1.productionDate,
        finishDate: s1.finishDate,
        conflictingWith,
      });
    }
  }

  return conflictMap;
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
        recommendation = `CRITICAL (${riskScore}/100): Defisit ${shortage.toLocaleString()} ${req.unit} dengan waktu tersisa ${days} hari. Segera percepat pengiriman vendor atau lakukan rescheduling.`;
      } else if (riskCategory === 'HIGH') {
        recommendation = `HIGH RISK (${riskScore}/100): Defisit ${shortage.toLocaleString()} ${req.unit} (${Math.round(ratio)}%). Terbitkan PO Express atau koordinasi pengiriman parsial.`;
      } else if (riskCategory === 'MEDIUM') {
        recommendation = `MEDIUM RISK (${riskScore}/100): Terdapat kekurangan ${shortage.toLocaleString()} ${req.unit}. Jadwal produksi masih memiliki buffer waktu ${days} hari.`;
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
        productionLine: sch.productionLine,
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
    const shortage = Math.max(0, req.requiredQty - req.receivedQty);
    const value = shortage * (req.unitPrice || 1000);

    const existing = materialMap.get(req.materialCode) || {
      materialCode: req.materialCode,
      materialName: req.materialName,
      unit: req.unit,
      shortageQty: 0,
      shortageValue: 0,
    };

    existing.shortageQty += shortage;
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
      shortageQty: Math.round(item.shortageQty * 10) / 10,
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

  return {
    totalRequired: Math.round(totalRequired),
    totalReceived: Math.round(totalReceived),
    shortageTotal: Math.max(0, Math.round(totalRequired - totalReceived)),
    fulfillmentRatio,
    readyCount,
    notReadyCount,
    totalCount: filtered.length,
    readyPercentage: filtered.length > 0 ? Math.round((readyCount / filtered.length) * 100) : 100,
    notReadyPercentage: filtered.length > 0 ? Math.round((notReadyCount / filtered.length) * 100) : 0,
  };
}
