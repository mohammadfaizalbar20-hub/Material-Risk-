import {
  extractOrNumberFromIdentifier,
  validateExtractedWorksheet,
  type ExtractedPdfWorksheet,
  type ExtractedWorksheetMaterial,
  type WorksheetFieldWarning,
} from './pdfWorksheetParser.js';

export interface PageOcrExtraction {
  pageNumber: number;
  totalPages: number;
  isNonTablePage?: boolean;
  orNumber: string;
  rawOrNumber?: string;
  worksheetNo?: string;
  style: string;
  target: number | null;
  rawTarget?: string;
  isTargetAmbiguous?: boolean;
  materials: ExtractedWorksheetMaterial[];
  rawText?: string;
}

export interface PdfOcrProgressState {
  mode: 'checking' | 'text' | 'page-ocr';
  totalPages: number;
  currentPage: number;
  completedPages: Record<number, PageOcrExtraction>;
  failedPages: number[];
  stageLabel: string;
  attempt?: number;
}

export interface MergePageOcrResult {
  worksheet: ExtractedPdfWorksheet;
  isValidatedUsable: boolean;
  processedPageNumbers: number[];
  nonTablePageNumbers: number[];
}

/**
 * Returns page numbers in `[1..totalPages]` that have NOT yet completed OCR.
 * Ensures retries only process unfinished/failed pages without repeating successful pages.
 */
export function getPendingOcrPageNumbers(
  totalPages: number,
  completedPages: Record<number, PageOcrExtraction> = {}
): number[] {
  const safeTotal = Math.max(1, Math.floor(totalPages || 1));
  const pending: number[] = [];
  for (let pageNum = 1; pageNum <= safeTotal; pageNum++) {
    if (!completedPages[pageNum]) {
      pending.push(pageNum);
    }
  }
  return pending;
}

/**
 * Classifies whether an OCR/HTTP failure is transient and worth a bounded retry.
 */
export function isRetryableOcrError(statusCode?: number, errorMessage?: string): boolean {
  if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 405 || statusCode === 413) {
    return false;
  }
  const msg = (errorMessage || '').toLowerCase();
  if (
    msg.includes('gemini_api_key') ||
    msg.includes('memerlukan layanan ocr/ai yang aktif') ||
    msg.includes('tidak memiliki header pdf') ||
    msg.includes('kosong atau bukan pdf') ||
    msg.includes('maksimal 25mb')
  ) {
    return false;
  }
  if (statusCode === 408 || statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return true;
  }
  return /timeout|timed out|batas waktu|abort|rate.?limit|429|503|504|502|temporarily|unavailable|econnreset|etimedout|socket|network|gagal terhubung/i.test(
    msg
  );
}

/**
 * Checks whether an OCR/merged worksheet actually contains validated, usable content.
 * Prevents falsely reporting OCR success when all extracted fields & tables are empty.
 */
export function validateUsableOcrWorksheet(ws: ExtractedPdfWorksheet | null | undefined): boolean {
  if (!ws) return false;
  const hasOr = Boolean(ws.orNumber && ws.orNumber.trim());
  const hasStyle = Boolean(ws.style && ws.style.trim());
  const hasTarget = ws.target !== null && ws.target !== undefined && Number.isFinite(ws.target) && ws.target > 0;
  const hasMaterials = Array.isArray(ws.materials) && ws.materials.some((m) => Boolean(m.materialCode?.trim() || m.materialName?.trim()));

  if (!hasMaterials && !(hasOr && hasStyle && hasTarget)) {
    return false;
  }
  return hasOr || hasStyle || hasTarget || hasMaterials;
}

/**
 * Merges page-by-page OCR extractions cleanly in deterministic page order:
 * - Preserves header identity from earliest valid page (typically Page 1) without overwriting with blank Page 2+ fields.
 * - Flags genuine cross-page identity conflicts for user review.
 * - Preserves all material rows across pages in exact page order without duplicating retried pages or dropping duplicate material codes on a page.
 * - Ignores non-table pages (e.g. Material Card / swatch photos).
 */
export function mergePageOcrExtractions(
  pagesInput: Record<number, PageOcrExtraction> | PageOcrExtraction[],
  fileName: string
): MergePageOcrResult {
  const orderedPages: PageOcrExtraction[] = Array.isArray(pagesInput)
    ? [...pagesInput].sort((a, b) => a.pageNumber - b.pageNumber)
    : Object.values(pagesInput).sort((a, b) => a.pageNumber - b.pageNumber);

  const normText = (v?: string | null) => (v || '').trim().replace(/\s+/g, ' ').toUpperCase();

  let orNumber = '';
  let rawOrNumber: string | undefined;
  let worksheetNo: string | undefined;
  let style = '';
  let target: number | null = null;
  let rawTarget: string | undefined;
  let isTargetAmbiguous = false;

  const crossPageWarnings: WorksheetFieldWarning[] = [];
  const mergedMaterials: ExtractedWorksheetMaterial[] = [];
  const processedPageNumbers: number[] = [];
  const nonTablePageNumbers: number[] = [];
  const rawTextParts: string[] = [];

  for (const page of orderedPages) {
    processedPageNumbers.push(page.pageNumber);
    if (page.rawText && page.rawText.trim()) {
      rawTextParts.push(`[Page ${page.pageNumber}]\n${page.rawText.trim()}`);
    }

    const pageOr = extractOrNumberFromIdentifier(page.orNumber || page.rawOrNumber || '');
    if (pageOr) {
      if (!orNumber) {
        orNumber = pageOr;
        rawOrNumber = page.rawOrNumber || page.orNumber;
      } else if (normText(orNumber) !== normText(pageOr)) {
        crossPageWarnings.push({
          field: 'orNumber',
          severity: 'warning',
          message: `Perbedaan No. OR antar halaman OCR (${orNumber} vs ${pageOr} di halaman ${page.pageNumber}). Mohon periksa.`,
          candidates: [orNumber, pageOr],
        });
      }
    }

    const pageWsNo = (page.worksheetNo || '').trim();
    if (pageWsNo) {
      if (!worksheetNo) {
        worksheetNo = pageWsNo;
      } else if (normText(worksheetNo) !== normText(pageWsNo)) {
        crossPageWarnings.push({
          field: 'worksheetNo',
          severity: 'warning',
          message: `Perbedaan No. Worksheet antar halaman OCR ("${worksheetNo}" vs "${pageWsNo}"). Mohon periksa.`,
          candidates: [worksheetNo, pageWsNo],
        });
      }
    }

    const pageStyle = (page.style || '').trim();
    if (pageStyle) {
      if (!style) {
        style = pageStyle;
      }
    }

    if (page.target !== null && page.target !== undefined && Number.isFinite(page.target) && page.target > 0) {
      if (target === null) {
        target = page.target;
        rawTarget = page.rawTarget;
        isTargetAmbiguous = Boolean(page.isTargetAmbiguous);
      } else if (Math.abs(target - page.target) > 0.001) {
        crossPageWarnings.push({
          field: 'target',
          severity: 'warning',
          message: `Perbedaan Target Produksi antar halaman OCR (${rawTarget || target} vs ${page.rawTarget || page.target}). Mohon konfirmasi.`,
          candidates: [String(rawTarget || target), String(page.rawTarget || page.target)],
        });
      }
    }

    const pageMats = Array.isArray(page.materials) ? page.materials : [];
    if (page.isNonTablePage && pageMats.length === 0) {
      nonTablePageNumbers.push(page.pageNumber);
      continue;
    }

    for (const mat of pageMats) {
      if (!mat.materialCode?.trim() && !mat.materialName?.trim()) continue;
      mergedMaterials.push({
        ...mat,
        total:
          mat.total === null || mat.total === undefined || !Number.isFinite(mat.total)
            ? null
            : mat.total,
        rawTotal: mat.total === null || mat.total === undefined ? (mat.rawTotal || '') : mat.rawTotal,
      });
    }
  }

  const combined: ExtractedPdfWorksheet = {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    orNumber,
    rawOrNumber,
    worksheetNo,
    style,
    target,
    rawTarget,
    isTargetAmbiguous,
    materials: mergedMaterials,
    extractionMethod: 'gemini',
    fieldWarnings: crossPageWarnings,
    rawText: rawTextParts.length > 0 ? rawTextParts.join('\n\n') : undefined,
  };

  const validation = validateExtractedWorksheet(combined);
  combined.needsReview = validation.needsReview;
  combined.reviewReasons = validation.reviewReasons;
  combined.fieldWarnings = validation.fieldWarnings;

  const isValidatedUsable = validateUsableOcrWorksheet(combined);
  if (!isValidatedUsable) {
    combined.needsReview = true;
    if (!combined.reviewReasons?.length) {
      combined.reviewReasons = [
        'Hasil OCR tidak menghasilkan identitas Worksheet atau tabel material yang dapat divalidasi.',
      ];
    }
  }

  return {
    worksheet: combined,
    isValidatedUsable,
    processedPageNumbers,
    nonTablePageNumbers,
  };
}
