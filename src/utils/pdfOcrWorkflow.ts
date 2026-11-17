import {
  extractOrNumberFromIdentifier,
  validateExtractedWorksheet,
  type ExtractedPdfWorksheet,
  type ExtractedWorksheetMaterial,
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
  stageLabel: string;
  attempt?: number;
}

export interface FirstPageOcrBuildResult {
  worksheet: ExtractedPdfWorksheet;
  isValidatedUsable: boolean;
}

/**
 * Classifies whether an OCR/HTTP failure on Page 1 is transient and worth a bounded retry.
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
    msg.includes('maksimal 25mb') ||
    msg.includes('data worksheet tidak ditemukan pada halaman pertama') ||
    msg.includes('hanya memproses halaman pertama')
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
 * Checks whether an OCR/extracted Page 1 worksheet actually contains valid, usable worksheet data.
 * Rejects blank pages, cover sheets, or non-table results.
 */
export function validateUsableOcrWorksheet(ws: ExtractedPdfWorksheet | null | undefined): boolean {
  if (!ws) return false;
  const hasOr = Boolean(ws.orNumber && ws.orNumber.trim());
  const hasStyle = Boolean(ws.style && ws.style.trim());
  const hasTarget = ws.target !== null && ws.target !== undefined && Number.isFinite(ws.target) && ws.target > 0;
  const hasMaterials =
    Array.isArray(ws.materials) &&
    ws.materials.some((m) => Boolean(m.materialCode?.trim() || m.materialName?.trim()));

  if (!hasMaterials && !(hasOr && hasStyle && hasTarget)) {
    return false;
  }
  return hasOr || hasStyle || hasTarget || hasMaterials;
}

/**
 * Builds and validates a worksheet strictly from Page 1 OCR output.
 * Any pageNumber !== 1 is rejected/ignored so Page 2+ content can never enter the result.
 */
export function buildWorksheetFromFirstPageOcr(
  firstPage: PageOcrExtraction,
  fileName: string
): FirstPageOcrBuildResult {
  if (firstPage.pageNumber !== 1) {
    const emptyWs: ExtractedPdfWorksheet = {
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName,
      orNumber: '',
      style: '',
      target: null,
      materials: [],
      extractionMethod: 'gemini',
      needsReview: true,
      reviewReasons: [`Data worksheet tidak ditemukan pada halaman pertama dokumen "${fileName}".`],
    };
    return { worksheet: emptyWs, isValidatedUsable: false };
  }

  const orNumber = extractOrNumberFromIdentifier(firstPage.orNumber || firstPage.rawOrNumber || '');
  const style = (firstPage.style || '').trim();
  const target =
    firstPage.target !== null &&
    firstPage.target !== undefined &&
    Number.isFinite(firstPage.target) &&
    firstPage.target > 0
      ? firstPage.target
      : null;

  const rawMats = Array.isArray(firstPage.materials) ? firstPage.materials : [];
  const materials: ExtractedWorksheetMaterial[] = rawMats
    .filter((mat) => Boolean(mat.materialCode?.trim() || mat.materialName?.trim()))
    .map((mat) => ({
      ...mat,
      total:
        mat.total === null || mat.total === undefined || !Number.isFinite(mat.total)
          ? null
          : mat.total,
      rawTotal:
        mat.total === null || mat.total === undefined ? (mat.rawTotal || '') : mat.rawTotal,
    }));

  const worksheet: ExtractedPdfWorksheet = {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    orNumber,
    rawOrNumber: firstPage.rawOrNumber,
    worksheetNo: firstPage.worksheetNo?.trim() || undefined,
    style,
    target,
    rawTarget: firstPage.rawTarget,
    isTargetAmbiguous: Boolean(firstPage.isTargetAmbiguous),
    materials: firstPage.isNonTablePage && materials.length === 0 ? [] : materials,
    extractionMethod: 'gemini',
    rawText: firstPage.rawText,
  };

  const validation = validateExtractedWorksheet(worksheet);
  worksheet.needsReview = validation.needsReview;
  worksheet.reviewReasons = validation.reviewReasons;
  worksheet.fieldWarnings = validation.fieldWarnings;

  const isValidatedUsable = validateUsableOcrWorksheet(worksheet);
  if (!isValidatedUsable) {
    worksheet.needsReview = true;
    worksheet.reviewReasons = [
      `Data worksheet tidak ditemukan pada halaman pertama dokumen "${fileName}".`,
    ];
  }

  return { worksheet, isValidatedUsable };
}
