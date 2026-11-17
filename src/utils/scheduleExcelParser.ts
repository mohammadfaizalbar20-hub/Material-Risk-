import * as XLSX from 'xlsx';
import {
  cleanFloatPrecision,
  EXCEL_SHEET_TO_JSON_OPTIONS,
  filterNonEmptyExcelRows,
  isExcelCellEmpty,
  NumberLocaleHint,
  parseExcelNumberDetailed,
  preserveSourceUnit,
} from './excelMaterialParser';
import type { ExtractedWorksheetMaterial } from './pdfWorksheetParser';

export interface ExtractedScheduleMaterial extends ExtractedWorksheetMaterial {
  id: string;
  materialCode: string;
  materialName: string;
  unit: string;
  total: number | null;
  rawTotal?: string;
}

export interface ExtractedScheduleExcel {
  id: string;
  fileName: string;
  orNumber: string;
  rawSource: string;
  productionNumber: string; // Reference (exact verbatim, e.g. WH/MO/22743)
  style: string;
  target: number | null;
  rawTarget?: string;
  materials: ExtractedScheduleMaterial[];
  needsReview: boolean;
  reviewReasons: string[];
}

const SCHEDULE_HEADER_TARGETS = {
  source: ['source'],
  reference: ['reference'],
  style: ['style list/display name'],
  target: ['quantity to produce'],
  materialCode: ['raw materials/product/internal reference'],
  materialName: ['raw materials/product/display name'],
  unit: ['raw materials/product/unit of measure'],
  initialDemand: ['raw materials/initial demand'],
} as const;

function normalizeScheduleHeader(header: string): string {
  return String(header || '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
}

/**
 * Extracts Nomor OR strictly from the segment after the last `/` in the `Source` column.
 * Example: `OR/2026/06/1036` -> `1036`.
 * Never uses Reference or PO numbers.
 */
export function extractOrNumberFromSource(rawSource: unknown): string {
  if (isExcelCellEmpty(rawSource)) return '';
  const text = String(rawSource).replace(/\u00A0/g, ' ').trim();
  if (!text) return '';

  if (text.includes('/')) {
    const parts = text
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : '';
  }

  return text;
}

function resolveColumnKey(
  headers: string[],
  targets: readonly string[]
): string | null {
  const normalizedMap = new Map<string, string>();
  for (const header of headers) {
    const norm = normalizeScheduleHeader(header);
    if (norm && !normalizedMap.has(norm)) {
      normalizedMap.set(norm, header);
    }
  }

  for (const target of targets) {
    const found = normalizedMap.get(target);
    if (found) return found;
  }

  return null;
}

function detectNumericLocaleFromSamples(samples: unknown[]): NumberLocaleHint {
  let idScore = 0;
  let usScore = 0;

  for (const val of samples) {
    if (typeof val !== 'string') continue;
    const compact = val.replace(/[\s\u00A0]+/g, '').replace(/^[+-]/, '');
    if (!compact || !/\d/.test(compact)) continue;

    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(compact)) {
      idScore += 2;
    } else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(compact)) {
      usScore += 2;
    } else if (/^\d+,\d+$/.test(compact)) {
      const [intPart, fracPart] = compact.split(',');
      if (fracPart.length !== 3 || intPart === '0' || intPart.length > 3) {
        idScore += 1;
      }
    } else if (/^\d+\.\d+$/.test(compact)) {
      const [intPart, fracPart] = compact.split('.');
      if (fracPart.length !== 3 || intPart === '0' || intPart.length > 3) {
        usScore += 1;
      }
    }
  }

  if (idScore > 0 && usScore === 0) return 'id';
  if (usScore > 0 && idScore === 0) return 'us';
  return 'neutral';
}

function normalizeTextCell(val: unknown): string {
  if (isExcelCellEmpty(val)) return '';
  return String(val).replace(/\u00A0/g, ' ').trim();
}

/**
 * Parses rows from one Production Schedule Excel file into a single ExtractedScheduleExcel.
 * Rules:
 * - 1 Excel file = 1 production schedule.
 * - Production header fields (Source, Reference, Style List/Display Name, Quantity To Produce)
 *   and the first material row may coexist on row 0; subsequent material rows inherit the same
 *   production even when header columns are blank.
 * - Ignores Deadline Start, Deadline End, Delivery Date, Line Produksi, Quantity Done / Done.
 * - Preserves duplicate material codes as separate rows, exact verbatim Unit of Measure,
 *   and exact unrounded decimals for Target Produksi and Initial Demand (Kebutuhan).
 */
export function parseScheduleExcelRows(
  rawRows: Record<string, unknown>[],
  fileName: string,
  idPrefix = `sch-xls-${Date.now()}`
): ExtractedScheduleExcel {
  const nonEmptyRows = filterNonEmptyExcelRows(rawRows);
  if (nonEmptyRows.length === 0) {
    throw new Error(
      `File "${fileName}" kosong atau tidak memiliki baris data Production Schedule.`
    );
  }

  const allHeaders = Array.from(
    new Set(nonEmptyRows.flatMap((row) => Object.keys(row || {})))
  );

  const colMap = {
    source: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.source),
    reference: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.reference),
    style: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.style),
    target: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.target),
    materialCode: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.materialCode),
    materialName: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.materialName),
    unit: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.unit),
    initialDemand: resolveColumnKey(allHeaders, SCHEDULE_HEADER_TARGETS.initialDemand),
  };

  const missingColumns: string[] = [];
  if (!colMap.source) missingColumns.push('Source');
  if (!colMap.reference) missingColumns.push('Reference');
  if (!colMap.style) missingColumns.push('Style List/Display Name');
  if (!colMap.target) missingColumns.push('Quantity To Produce');
  if (!colMap.materialCode) missingColumns.push('Raw Materials/Product/Internal Reference');
  if (!colMap.materialName) missingColumns.push('Raw Materials/Product/Display Name');
  if (!colMap.unit) missingColumns.push('Raw Materials/Product/Unit of Measure');
  if (!colMap.initialDemand) missingColumns.push('Raw Materials/Initial Demand');

  if (missingColumns.length > 0) {
    throw new Error(
      `Format kolom Excel "${fileName}" tidak sesuai Production Schedule. Kolom wajib tidak ditemukan: ${missingColumns.join(', ')}.`
    );
  }

  const numericSamples: unknown[] = [];
  for (const row of nonEmptyRows) {
    if (colMap.target && !isExcelCellEmpty(row[colMap.target])) {
      numericSamples.push(row[colMap.target]);
    }
    if (colMap.initialDemand && !isExcelCellEmpty(row[colMap.initialDemand])) {
      numericSamples.push(row[colMap.initialDemand]);
    }
  }
  const localeHint = detectNumericLocaleFromSamples(numericSamples);

  // Extract production header from the first row containing each value (typically row 0)
  let rawSource = '';
  let orNumber = '';
  let productionNumber = '';
  let style = '';
  let target: number | null = null;
  let rawTarget: string | undefined;

  for (const row of nonEmptyRows) {
    if (!rawSource && colMap.source && !isExcelCellEmpty(row[colMap.source])) {
      rawSource = normalizeTextCell(row[colMap.source]);
      orNumber = extractOrNumberFromSource(rawSource);
    }
    if (!productionNumber && colMap.reference && !isExcelCellEmpty(row[colMap.reference])) {
      productionNumber = normalizeTextCell(row[colMap.reference]);
    }
    if (!style && colMap.style && !isExcelCellEmpty(row[colMap.style])) {
      style = normalizeTextCell(row[colMap.style]);
    }
    if (target === null && colMap.target && !isExcelCellEmpty(row[colMap.target])) {
      const rawCell = row[colMap.target];
      rawTarget = typeof rawCell === 'number' ? String(rawCell) : normalizeTextCell(rawCell);
      const parsedTarget = parseExcelNumberDetailed(rawCell, 0, localeHint);
      if (parsedTarget.isValid && !parsedTarget.isEmpty) {
        target = cleanFloatPrecision(parsedTarget.value);
      }
    }
  }

  // Extract ALL raw material rows in exact order, keeping duplicate material codes separate
  const materials: ExtractedScheduleMaterial[] = [];
  const reviewReasons: string[] = [];

  nonEmptyRows.forEach((row, rowIdx) => {
    const codeVal = colMap.materialCode ? normalizeTextCell(row[colMap.materialCode]) : '';
    const nameVal = colMap.materialName ? normalizeTextCell(row[colMap.materialName]) : '';
    const unitVal = colMap.unit ? preserveSourceUnit(row[colMap.unit]) : '';
    const demandRawCell = colMap.initialDemand ? row[colMap.initialDemand] : null;
    const hasDemandCell = !isExcelCellEmpty(demandRawCell);

    // Skip rows that have no material data at all (e.g., if a header-only row existed without material cells)
    if (!codeVal && !nameVal && !unitVal && !hasDemandCell) {
      return;
    }

    let demandTotal: number | null = null;
    let rawTotal: string | undefined;
    if (hasDemandCell) {
      rawTotal = typeof demandRawCell === 'number' ? String(demandRawCell) : normalizeTextCell(demandRawCell);
      const parsedDemand = parseExcelNumberDetailed(demandRawCell, 0, localeHint);
      if (parsedDemand.isValid && !parsedDemand.isEmpty) {
        demandTotal = cleanFloatPrecision(parsedDemand.value);
      } else {
        reviewReasons.push(
          `Baris ${rowIdx + 1} (${codeVal || nameVal || 'Material'}): nilai Kebutuhan "${rawTotal}" tidak valid.`
        );
      }
    } else {
      reviewReasons.push(
        `Baris ${rowIdx + 1} (${codeVal || nameVal || 'Material'}): nilai Initial Demand (Kebutuhan) kosong.`
      );
    }

    if (!codeVal) {
      reviewReasons.push(`Baris ${rowIdx + 1}: Kode Material kosong.`);
    }
    if (!nameVal) {
      reviewReasons.push(`Baris ${rowIdx + 1}: Nama Material kosong.`);
    }
    if (!unitVal) {
      reviewReasons.push(`Baris ${rowIdx + 1} (${codeVal || 'Material'}): Satuan (Unit of Measure) kosong.`);
    }

    materials.push({
      id: `wsm-${materials.length + 1}`,
      materialCode: codeVal,
      materialName: nameVal,
      unit: unitVal,
      total: demandTotal,
      rawTotal,
    });
  });

  if (materials.length === 0) {
    throw new Error(
      `File "${fileName}" tidak memiliki baris Raw Materials yang valid.`
    );
  }

  if (!orNumber) {
    reviewReasons.unshift('Nomor OR dari kolom Source kosong atau tidak valid.');
  }
  if (!productionNumber) {
    reviewReasons.unshift('Nomor Produksi dari kolom Reference kosong.');
  }
  if (!style) {
    reviewReasons.unshift('Style dari kolom Style List/Display Name kosong.');
  }
  if (target === null || !Number.isFinite(target) || target <= 0) {
    reviewReasons.unshift('Target Produksi dari kolom Quantity To Produce harus lebih dari 0.');
  }

  const dedupedReasons = Array.from(new Set(reviewReasons));

  return {
    id: `${idPrefix}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    orNumber,
    rawSource,
    productionNumber,
    style,
    target,
    rawTarget,
    materials,
    needsReview: dedupedReasons.length > 0,
    reviewReasons: dedupedReasons,
  };
}

/**
 * Parses an Excel buffer (.xls, .xlsx, .csv) representing a single Production Schedule.
 */
export function parseScheduleExcelBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string
): ExtractedScheduleExcel {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: false });
  } catch (err: any) {
    throw new Error(
      `Gagal membaca file Excel "${fileName}": ${err?.message || 'format file tidak valid'}.`
    );
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error(`File Excel "${fileName}" tidak memiliki worksheet.`);
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      sheet,
      EXCEL_SHEET_TO_JSON_OPTIONS
    );
    const nonEmpty = filterNonEmptyExcelRows(rawRows);
    if (nonEmpty.length > 0) {
      return parseScheduleExcelRows(nonEmpty, fileName);
    }
  }

  throw new Error(`File Excel "${fileName}" tidak berisi data pada sheet mana pun.`);
}

/**
 * Browser File wrapper around parseScheduleExcelBuffer.
 */
export async function parseScheduleExcelFile(file: File): Promise<ExtractedScheduleExcel> {
  const buffer = await file.arrayBuffer();
  return parseScheduleExcelBuffer(buffer, file.name);
}
