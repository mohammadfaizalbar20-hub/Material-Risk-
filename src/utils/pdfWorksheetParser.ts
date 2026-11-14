import {
  MaterialItemRequirement,
  UploadHistoryItem,
  WorksheetMaterialItem,
  WorksheetPdfItem,
} from '../types/ppic';

export type NumberLocale = 'id' | 'us' | 'unknown';

export interface ParsedPdfNumber {
  value: number | null;
  raw: string;
  isAmbiguous: boolean;
  reason?: string;
}

export interface PdfCoordinateTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfCoordinatePage {
  pageNum: number;
  width?: number;
  height?: number;
  items: PdfCoordinateTextItem[];
}

export interface WorksheetFieldWarning {
  field: 'orNumber' | 'worksheetNo' | 'style' | 'target' | 'materials' | string;
  severity: 'warning' | 'error';
  message: string;
  candidates?: string[];
}

export interface ExtractedWorksheetMaterial {
  materialCode: string;
  materialName: string;
  unit: string;
  total: number | null;
  rawTotal?: string;
  totalStatus?: 'present' | 'empty' | 'unreadable';
  isTotalAmbiguous?: boolean;
  needsReview?: boolean;
  reviewNote?: string;
}

export interface WorksheetMaterialMatched extends ExtractedWorksheetMaterial {
  id?: string;
  receivedQty: number | null; // null if not found in latest Excel upload for this OR
  status: 'READY' | 'BELUM READY' | null; // null if not found in latest Excel upload for this OR
  isFoundInMasterData: boolean;
  matchedUploadId?: string | null;
  matchedUploadDate?: string | null;
  matchedUploadTime?: string | null;
  matchedUploadCreatedAt?: string | null;
  matchedAt?: string | null;
}

export interface LatestOrUploadResolution {
  orNumber: string;
  latestUpload: UploadHistoryItem | null;
  rows: MaterialItemRequirement[];
}

export interface ExtractedPdfWorksheet {
  id: string;
  fileName: string;
  orNumber: string;
  rawOrNumber?: string;
  worksheetNo?: string;
  style: string;
  target: number | null;
  rawTarget?: string;
  isTargetAmbiguous?: boolean;
  materials: ExtractedWorksheetMaterial[];
  matchedMaterials?: WorksheetMaterialMatched[];
  extractionMethod?: 'coordinates' | 'text' | 'gemini' | 'hybrid';
  needsReview?: boolean;
  reviewReasons?: string[];
  fieldWarnings?: WorksheetFieldWarning[];
  error?: string;
  rawText?: string;
}

export interface ParsedExtractApiResult {
  success: boolean;
  data?: ExtractedPdfWorksheet;
  error?: string;
  status?: number;
  isNonJsonResponse?: boolean;
}

/**
 * Safely parses HTTP responses from `/api/pdf/extract-worksheet` without blindly calling `response.json()`.
 * Checks HTTP status, Content-Type, and raw response body to handle JSON, plain text, HTML error pages,
 * or proxy errors (e.g. "The page could not be found") cleanly.
 */
export function parseExtractWorksheetHttpResponse(
  status: number,
  contentType: string | null | undefined,
  rawBody: string
): ParsedExtractApiResult {
  const cleanType = (contentType || '').toLowerCase();
  const trimmed = (rawBody || '').trim();
  const looksLikeHtml =
    cleanType.includes('text/html') ||
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    /<(html|head|body|title|h1|pre)[\s>]/i.test(trimmed);
  const looksLikeJson =
    cleanType.includes('application/json') ||
    cleanType.includes('+json') ||
    (!cleanType && (trimmed.startsWith('{') || trimmed.startsWith('[')));

  const mapHttpStatusFallback = (code: number, detailHint?: string): string => {
    const lowerHint = (detailHint || '').toLowerCase();
    if (
      code === 404 ||
      lowerHint.includes('page could not be found') ||
      lowerHint.includes('cannot post') ||
      lowerHint.includes('not found')
    ) {
      return 'Layanan ekstraksi PDF (/api/pdf/extract-worksheet) tidak ditemukan atau server backend belum aktif (HTTP 404). Pastikan aplikasi dijalankan melalui server API.';
    }
    if (code === 413 || lowerHint.includes('too large') || lowerHint.includes('payload')) {
      return 'Ukuran berkas PDF terlalu besar untuk diproses oleh server (HTTP 413). Silakan kompres ukuran PDF dan coba lagi.';
    }
    if (code === 502 || code === 503 || code === 504 || lowerHint.includes('timeout')) {
      return `Server ekstraksi PDF sementara tidak merespons atau kehabisan waktu (HTTP ${code}). Silakan coba unggah ulang beberapa saat lagi.`;
    }
    if (code >= 500) {
      return `Terjadi kesalahan internal pada server saat membaca PDF (HTTP ${code}).`;
    }
    if (code >= 400) {
      return `Permintaan ekstraksi PDF ditolak oleh server (HTTP ${code}).`;
    }
    return 'Respons server ekstraksi PDF tidak dapat diproses.';
  };

  if (looksLikeJson && trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if (status >= 200 && status < 300 && parsed.success && parsed.data) {
          return {
            success: true,
            data: parsed.data as ExtractedPdfWorksheet,
            status,
          };
        }
        const serverMsg =
          typeof parsed.error === 'string' && parsed.error.trim()
            ? parsed.error.trim()
            : typeof parsed.message === 'string' && parsed.message.trim()
              ? parsed.message.trim()
              : mapHttpStatusFallback(status);
        return {
          success: false,
          error: serverMsg,
          status,
        };
      }
    } catch {
      return {
        success: false,
        error: `Respons JSON dari server ekstraksi PDF tidak valid atau terpotong (HTTP ${status || 500}).`,
        status,
        isNonJsonResponse: true,
      };
    }
  }

  if (looksLikeHtml) {
    const titleMatch = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h1Match = trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const stripped = (titleMatch?.[1] || h1Match?.[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const baseMsg = mapHttpStatusFallback(status || 502, stripped);
    return {
      success: false,
      error: stripped ? `${baseMsg} (${stripped})` : baseMsg,
      status,
      isNonJsonResponse: true,
    };
  }

  if (!trimmed) {
    return {
      success: false,
      error: mapHttpStatusFallback(status || 500),
      status,
      isNonJsonResponse: true,
    };
  }

  // Plain text response (e.g. "The page could not be found" or gateway error text)
  const singleLine = trimmed.replace(/\s+/g, ' ').slice(0, 180);
  const mapped = mapHttpStatusFallback(status || 500, singleLine);
  const isAlreadyKnown404 =
    (status === 404 || singleLine.toLowerCase().includes('page could not be found')) &&
    mapped.includes('HTTP 404');

  return {
    success: false,
    error: isAlreadyKnown404
      ? mapped
      : `${mapped} (Respons teks server: "${singleLine}")`,
    status,
    isNonJsonResponse: true,
  };
}

/**
 * Normalizes an OR Number to extract trailing digits/identifier
 * Example: 'OR/2026/05/1014' -> '1014'
 *          'OR/1117' -> '1117'
 *          '1117' -> '1117'
 */
export function extractOrNumberFromIdentifier(rawOr: string): string {
  if (!rawOr) return '';
  const trimmed = rawOr.trim();
  const slashParts = trimmed.split('/');
  const lastPart = slashParts[slashParts.length - 1].trim();
  const cleanMatch = lastPart.match(/[A-Za-z0-9_-]+/);
  return cleanMatch ? cleanMatch[0] : lastPart;
}

/**
 * Matches two OR Numbers flexibly (e.g. '1117' with 'OR/2026/09/1117' or 'OR-1117')
 */
export function areOrNumbersMatching(orA?: string | null, orB?: string | null): boolean {
  if (!orA || !orB) return false;
  const cleanA = orA.trim().toUpperCase();
  const cleanB = orB.trim().toUpperCase();

  if (cleanA === cleanB) return true;

  const tailA = extractOrNumberFromIdentifier(cleanA);
  const tailB = extractOrNumberFromIdentifier(cleanB);
  if (tailA && tailB && tailA === tailB) return true;

  if (cleanA.endsWith('/' + cleanB) || cleanA.endsWith('-' + cleanB)) return true;
  if (cleanB.endsWith('/' + cleanA) || cleanB.endsWith('-' + cleanA)) return true;

  return false;
}

/**
 * Detects whether a document primarily uses Indonesian/European formatting ('.' thousands, ',' decimal)
 * or US/English formatting (',' thousands, '.' decimal).
 */
export function detectDocumentNumberLocale(text: string): NumberLocale {
  if (!text) return 'unknown';
  const tokens = text.match(/\b\d[\d.,]*\d\b|\b\d\b/g) || [];
  let idEvidence = 0;
  let usEvidence = 0;

  for (const tok of tokens) {
    // Ignore dates like 12.05.2026? Those are >=3 segments without valid 3-digit grouping; check strictly
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(tok)) {
      idEvidence += 3;
    } else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(tok)) {
      usEvidence += 3;
    } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(tok)) {
      idEvidence += 2;
    } else if (/^\d{1,3}(,\d{3}){2,}$/.test(tok)) {
      usEvidence += 2;
    } else if (/^\d+,\d+$/.test(tok)) {
      const fracLen = tok.split(',')[1].length;
      if (fracLen !== 3) idEvidence += 2;
    } else if (/^\d+\.\d+$/.test(tok)) {
      const fracLen = tok.split('.')[1].length;
      if (fracLen !== 3) usEvidence += 2;
    }
  }

  if (idEvidence > 0 && usEvidence === 0) return 'id';
  if (usEvidence > 0 && idEvidence === 0) return 'us';
  return 'unknown';
}

/**
 * Parses a numeric token cleanly without blindly stripping commas or misreading thousands dots.
 * Examples:
 * - "2.498" in ID context (or integer-qty context) -> 2498 (raw "2.498")
 * - "104,9160" -> 104.916 (raw "104,9160")
 * - "2.498,0000" -> 2498 (raw "2.498,0000")
 * - "88.8" -> 88.8 (raw "88.8")
 * - Standalone "1.250" with unknown locale -> parsed conservatively and marked isAmbiguous: true
 */
export function parsePdfNumberWithContext(
  rawInput: string | null | undefined,
  docLocale: NumberLocale = 'unknown',
  options?: { isIntegerQtyContext?: boolean }
): ParsedPdfNumber {
  const raw = (rawInput || '').trim();
  if (!raw || raw === '-' || /^n\/a$/i.test(raw)) {
    return { value: null, raw, isAmbiguous: false };
  }

  // Reject dates like 12/05/2026 or strings with letters
  if (/[A-Za-z/]/.test(raw)) {
    return { value: null, raw, isAmbiguous: false };
  }

  // Strip surrounding spaces and optional trailing parentheses/symbols
  const cleaned = raw.replace(/\s+/g, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) {
    return { value: null, raw, isAmbiguous: false };
  }

  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');

  // 1. Plain integer
  if (!hasDot && !hasComma) {
    const val = Number(cleaned);
    return Number.isFinite(val)
      ? { value: val, raw, isAmbiguous: false }
      : { value: null, raw, isAmbiguous: false };
  }

  // 2. Both '.' and ','
  if (hasDot && hasComma) {
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) {
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      const val = Number(normalized);
      return Number.isFinite(val)
        ? { value: val, raw, isAmbiguous: false }
        : { value: null, raw, isAmbiguous: true, reason: `Format angka "${raw}" tidak valid.` };
    }
    if (/^\d{1,3}(,\d{3})+\.\d+$/.test(cleaned)) {
      const normalized = cleaned.replace(/,/g, '');
      const val = Number(normalized);
      return Number.isFinite(val)
        ? { value: val, raw, isAmbiguous: false }
        : { value: null, raw, isAmbiguous: true, reason: `Format angka "${raw}" tidak valid.` };
    }
    return {
      value: null,
      raw,
      isAmbiguous: true,
      reason: `Format pemisah ribuan/desimal campuran "${raw}" perlu dikonfirmasi.`,
    };
  }

  // 3. Multiple dots only (e.g. 1.250.000) -> thousands
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(cleaned)) {
    return { value: Number(cleaned.replace(/\./g, '')), raw, isAmbiguous: false };
  }

  // 4. Multiple commas only (e.g. 1,250,000) -> thousands
  if (/^\d{1,3}(,\d{3}){2,}$/.test(cleaned)) {
    return { value: Number(cleaned.replace(/,/g, '')), raw, isAmbiguous: false };
  }

  // 5. Single comma only
  if (hasComma && cleaned.split(',').length === 2) {
    const [intPart, fracPart] = cleaned.split(',');
    if (fracPart.length !== 3) {
      const val = Number(`${intPart}.${fracPart}`);
      return Number.isFinite(val)
        ? { value: val, raw, isAmbiguous: false }
        : { value: null, raw, isAmbiguous: true };
    }
    // Exactly 3 digits after comma (e.g. "2,498")
    if (docLocale === 'us') {
      return { value: Number(`${intPart}${fracPart}`), raw, isAmbiguous: false };
    }
    if (docLocale === 'id') {
      return {
        value: Number(`${intPart}.${fracPart}`),
        raw,
        isAmbiguous: Boolean(options?.isIntegerQtyContext),
        reason: options?.isIntegerQtyContext
          ? `Angka "${raw}" pada konteks Total Qty perlu dipastikan apakah ribuan atau desimal.`
          : undefined,
      };
    }
    return {
      value: options?.isIntegerQtyContext
        ? Number(`${intPart}${fracPart}`)
        : Number(`${intPart}.${fracPart}`),
      raw,
      isAmbiguous: true,
      reason: `Format angka "${raw}" berpotensi ambigu (koma ribuan vs desimal), harap periksa.`,
    };
  }

  // 6. Single dot only
  if (hasDot && cleaned.split('.').length === 2) {
    const [intPart, fracPart] = cleaned.split('.');
    if (fracPart.length !== 3) {
      const val = Number(cleaned);
      return Number.isFinite(val)
        ? { value: val, raw, isAmbiguous: false }
        : { value: null, raw, isAmbiguous: true };
    }
    // Exactly 3 digits after dot (e.g. "2.498")
    if (intPart.length <= 3 && !intPart.startsWith('0')) {
      if (docLocale === 'id') {
        return { value: Number(`${intPart}${fracPart}`), raw, isAmbiguous: false };
      }
      if (docLocale === 'us') {
        return {
          value: Number(cleaned),
          raw,
          isAmbiguous: Boolean(options?.isIntegerQtyContext),
          reason: options?.isIntegerQtyContext
            ? `Angka "${raw}" pada Total Qty perlu dipastikan apakah ribuan (${intPart}${fracPart}) atau desimal.`
            : undefined,
        };
      }
      // Unknown locale with 3 digits after dot
      if (options?.isIntegerQtyContext) {
        return {
          value: Number(`${intPart}${fracPart}`),
          raw,
          isAmbiguous: true,
          reason: `Format angka "${raw}" (titik ribuan vs desimal) perlu dikonfirmasi pengguna.`,
        };
      }
      return {
        value: Number(cleaned),
        raw,
        isAmbiguous: true,
        reason: `Format angka "${raw}" (titik ribuan vs desimal) perlu dikonfirmasi pengguna.`,
      };
    }
    // e.g. "0.250" or "1234.567" -> clearly decimal
    return { value: Number(cleaned), raw, isAmbiguous: false };
  }

  return {
    value: null,
    raw,
    isAmbiguous: true,
    reason: `Format angka "${raw}" tidak dapat ditafsirkan secara pasti.`,
  };
}

// Known header labels used to split adjacent key-value fields on the same horizontal row
const HEADER_LABEL_BOUNDARY_RE =
  /\b(?:NO\.?\s*WORKSHEET|WORKSHEET\s*NO\.?|NO\.?\s*OR|ORDER\s*(?:NO\.?|NUMBER)|STYLE\s*(?:NO\.?|NAME|DESC)?|TOTAL\s*(?:ORDER\s*)?QTY(?:\s*\(PCS\))?|QTY\s*TOTAL|BUYER|ITEM|COLOR|COLOUR|SEASON|DATE|TANGGAL|DELIVERY|P\.?O\.?\s*(?:NO\.?|NUMBER)|MERCHANDISER|LOT)\b/i;

function splitLabelSegmentValue(rawSegment: string): string {
  const trimmed = rawSegment.replace(/^[:=\s]+/, '').trim();
  if (!trimmed) return '';
  // If trimmed immediately begins with another header label, the original field itself was empty
  if (
    /^(?:NO\.?\s*WORKSHEET|WORKSHEET\s*NO\.?|NO\.?\s*OR|ORDER\s*(?:NO\.?|NUMBER)|STYLE\s*(?:NO\.?|NAME|DESC)?|TOTAL\s*(?:ORDER\s*)?QTY|QTY\s*TOTAL|BUYER|ITEM|COLOR|COLOUR|SEASON|DATE|TANGGAL|DELIVERY|P\.?O\.?\s*(?:NO\.?|NUMBER)|MERCHANDISER)\s*[:=]/i.test(
      trimmed
    )
  ) {
    return '';
  }
  // Stop if another header label begins further in the same line
  const nextLabelMatch = trimmed.match(
    /\s{2,}(?:NO\.?\s*WORKSHEET|WORKSHEET\s*NO\.?|NO\.?\s*OR|ORDER\s*(?:NO\.?|NUMBER)|STYLE\s*(?:NO\.?|NAME|DESC)?|TOTAL\s*(?:ORDER\s*)?QTY|QTY\s*TOTAL|BUYER|ITEM|COLOR|COLOUR|SEASON|DATE|TANGGAL|DELIVERY|P\.?O\.?\s*(?:NO\.?|NUMBER)|MERCHANDISER)\b|\s+(?:NO\.?\s*WORKSHEET|NO\.?\s*OR|STYLE\s*NO\.?|TOTAL\s*(?:ORDER\s*)?QTY|QTY\s*TOTAL|BUYER|ITEM|COLOR|SEASON|DATE|DELIVERY)\s*[:=]/i
  );
  if (nextLabelMatch && nextLabelMatch.index !== undefined) {
    return trimmed.slice(0, nextLabelMatch.index).trim();
  }
  return trimmed;
}

function isJustHeaderLabelLine(line: string): boolean {
  const clean = line.replace(/[:=\s.]/g, '').toUpperCase();
  return [
    'NOOR',
    'ORDERNO',
    'ORDERNUMBER',
    'NOWORKSHEET',
    'WORKSHEETNO',
    'WORKSHEETNUMBER',
    'STYLE',
    'STYLENO',
    'STYLENAME',
    'STYLEDESC',
    'TOTALQTY',
    'TOTALORDERQTY',
    'TOTALQTYPcs',
    'QTYTOTAL',
    'BUYER',
    'ITEM',
  ].includes(clean);
}

/**
 * Extracts Worksheet identity fields from lines cleanly without confusing:
 * - NO. WORKSHEET with NO. OR
 * - BUYER / ITEM with STYLE NO
 * - Non-TOTAL-QTY numbers with TOTAL QTY
 */
export function extractIdentityFromLines(lines: string[], docLocale: NumberLocale): {
  rawOrNumber: string;
  orNumber: string;
  worksheetNo: string;
  style: string;
  target: number | null;
  rawTarget: string;
  isTargetAmbiguous: boolean;
  targetWarning?: string;
} {
  let rawOrNumber = '';
  let worksheetNo = '';
  let style = '';
  let target: number | null = null;
  let rawTarget = '';
  let isTargetAmbiguous = false;
  let targetWarning: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip footer/page break noise
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) continue;

    // 1. NO. WORKSHEET
    if (!worksheetNo) {
      const wsMatch = line.match(
        /\b(?:NO\.?\s*WORKSHEET|WORKSHEET\s*(?:NO\.?|NUMBER))\b(?:\s*[:=]\s*|\s{2,}|\t|\s+)(.+)/i
      );
      if (wsMatch && wsMatch[1]) {
        const candidate = splitLabelSegmentValue(wsMatch[1]);
        if (candidate && !isJustHeaderLabelLine(candidate)) {
          worksheetNo = candidate;
        }
      } else if (/^\s*(?:NO\.?\s*WORKSHEET|WORKSHEET\s*(?:NO\.?|NUMBER))\s*[:=]?\s*$/i.test(line) && i + 1 < lines.length) {
        const nextCand = splitLabelSegmentValue(lines[i + 1]);
        if (nextCand && !HEADER_LABEL_BOUNDARY_RE.test(nextCand)) {
          worksheetNo = nextCand;
        }
      }
    }

    // 2. NO. OR (strictly word-boundary, never matching WORKSHEET / COLOR / VENDOR / PO NO)
    if (!rawOrNumber) {
      // Mask any "NO. WORKSHEET ..." segment so its WH/... value isn't confused
      const sanitizedForOr = line.replace(
        /\b(?:NO\.?\s*WORKSHEET|WORKSHEET\s*(?:NO\.?|NUMBER))\b(?:\s*[:=]\s*|\s{2,}|\t|\s+)[^\t]+?(?=(?:\s{2,}|\t|\bNO\.?\s*OR\b|\bORDER\s*NO\b|$))/gi,
        ' '
      );

      const orLabelMatch = sanitizedForOr.match(
        /\b(?:NO\.?\s*OR|ORDER\s*(?:NO\.?|NUMBER)|OR)\b(?:\s*[:=]\s*|\t+|\s{2,})([^\t\n\r,;]+)/i
      );
      if (orLabelMatch && orLabelMatch[1]) {
        const cand = splitLabelSegmentValue(orLabelMatch[1]).split(/\s{2,}|\t/)[0].trim();
        if (cand && !/^WH\//i.test(cand) && !isJustHeaderLabelLine(cand)) {
          rawOrNumber = cand;
        }
      } else if (/^\s*(?:NO\.?\s*OR|ORDER\s*(?:NO\.?|NUMBER))\s*[:=]?\s*$/i.test(sanitizedForOr) && i + 1 < lines.length) {
        const nextCand = splitLabelSegmentValue(lines[i + 1]).split(/\s+/)[0].trim();
        if (nextCand && !/^WH\//i.test(nextCand) && !HEADER_LABEL_BOUNDARY_RE.test(nextCand)) {
          rawOrNumber = nextCand;
        }
      }

      if (!rawOrNumber) {
        const explicitSlash = sanitizedForOr.match(/\bOR\/\d{4}\/\d{1,2}\/[A-Za-z0-9_-]+\b/i);
        if (explicitSlash) {
          rawOrNumber = explicitSlash[0];
        }
      }
    }

    // 3. STYLE NO (never fall back to BUYER or ITEM, never capture bare "NO")
    if (!style) {
      const styleLabelMatch = line.match(
        /\bSTYLE(?:\s*(?:NO\.?|NAME|DESC))?\b\s*[:=]\s*(.+)/i
      ) || line.match(
        /\bSTYLE\s+(?:NO\.?|NAME|DESC)\b(?:\t+|\s{2,}|\s+)(.+)/i
      ) || line.match(
        /\bSTYLE\b(?:\t+|\s{2,})(.+)/i
      );

      if (styleLabelMatch && styleLabelMatch[1]) {
        const cleanedStyle = splitLabelSegmentValue(styleLabelMatch[1]);
        if (
          cleanedStyle &&
          !/^(?:NO\.?|NAME|DESC)$/i.test(cleanedStyle) &&
          !isJustHeaderLabelLine(cleanedStyle)
        ) {
          style = cleanedStyle;
        }
      } else if (/^\s*STYLE(?:\s*(?:NO\.?|NAME|DESC))?\s*[:=]?\s*$/i.test(line) && i + 1 < lines.length) {
        const nextStyle = splitLabelSegmentValue(lines[i + 1]);
        if (nextStyle && !HEADER_LABEL_BOUNDARY_RE.test(nextStyle)) {
          style = nextStyle;
        }
      }
    }

    // 4. TOTAL QTY (never grab arbitrary numbers)
    if (target === null) {
      const qtyMatch =
        line.match(/\bTOTAL\s*(?:ORDER\s*)?QTY(?:\s*\(PCS\))?\b(?:\s*[:=]\s*|\t+|\s+)([0-9][0-9.,]*)/i) ||
        line.match(/\bQTY\s*TOTAL\b(?:\s*[:=]\s*|\t+|\s+)([0-9][0-9.,]*)/i);

      if (qtyMatch && qtyMatch[1]) {
        const parsedQty = parsePdfNumberWithContext(qtyMatch[1], docLocale, {
          isIntegerQtyContext: true,
        });
        if (parsedQty.value !== null && parsedQty.value > 0) {
          target = parsedQty.value;
          rawTarget = parsedQty.raw;
          isTargetAmbiguous = parsedQty.isAmbiguous;
          targetWarning = parsedQty.reason;
        }
      } else if (/^\s*(?:TOTAL\s*(?:ORDER\s*)?QTY|QTY\s*TOTAL)(?:\s*\(PCS\))?\s*[:=]?\s*$/i.test(line) && i + 1 < lines.length) {
        const nextTok = lines[i + 1].trim().split(/\s+/)[0];
        const parsedNext = parsePdfNumberWithContext(nextTok, docLocale, {
          isIntegerQtyContext: true,
        });
        if (parsedNext.value !== null && parsedNext.value > 0) {
          target = parsedNext.value;
          rawTarget = parsedNext.raw;
          isTargetAmbiguous = parsedNext.isAmbiguous;
          targetWarning = parsedNext.reason;
        }
      }
    }
  }

  return {
    rawOrNumber,
    orNumber: extractOrNumberFromIdentifier(rawOrNumber),
    worksheetNo,
    style,
    target,
    rawTarget,
    isTargetAmbiguous,
    targetWarning,
  };
}

type MaterialColumnRole =
  | 'no'
  | 'codeAcc'
  | 'description'
  | 'cons'
  | 'unit'
  | 'total'
  | 'return'
  | 'balance'
  | 'date';

function identifyColumnHeaderRole(cellText: string): MaterialColumnRole | null {
  const u = cellText.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!u) return null;
  if (u === 'NO' || u === 'NO.') return 'no';
  if (u.includes('CODE ACC') || u === 'CODE' || u === 'KODE' || u === 'KODE MATERIAL') return 'codeAcc';
  if (u.includes('DESCRIPTION') || u.includes('DESKRIPSI') || u === 'NAMA MATERIAL' || u === 'ITEM') return 'description';
  if (u === 'CONS' || u.includes('CONS.') || u.includes('KONSUMSI')) return 'cons';
  if (u === 'UNIT' || u === 'SATUAN' || u === 'UOM') return 'unit';
  if (u === 'TOTAL' || u === 'TOTAL QTY' || u === 'KEBUTUHAN') return 'total';
  if (u === 'RETURN' || u === 'RETUR') return 'return';
  if (u === 'BALANCE' || u === 'SALDO' || u === 'SISA') return 'balance';
  if (u.includes('TANGGAL') || u.includes('DATE')) return 'date';
  return null;
}

function isMaterialTableHeaderLine(line: string): boolean {
  const u = line.trim().toUpperCase();
  if (!u) return false;
  // Require strong multi-column header match so data rows containing "UNIT" or "TOTAL" in description are NEVER skipped!
  const hits = [
    /\bCODE\s*ACC\b/.test(u),
    /\bDESCRIPTION\b/.test(u),
    /\bUNIT\b/.test(u),
    /\bTOTAL\b/.test(u),
    /\bCONS\b/.test(u),
    /\bRETURN\b/.test(u),
    /\bBALANCE\b/.test(u),
    /\bNO\.?\b/.test(u),
  ].filter(Boolean).length;

  return (/\bCODE\s*ACC\b/.test(u) && /\bDESCRIPTION\b/.test(u)) || hits >= 3;
}

function isPageFooterNoiseLine(line: string): boolean {
  const u = line.trim().toUpperCase();
  if (!u) return false;
  return (
    /^--\s*\d+\s+OF\s+\d+\s*--$/i.test(u) ||
    /^PAGE\s+\d+(?:\s+OF\s+\d+)?$/i.test(u) ||
    /^HALAMAN\s+\d+(?:\s+(?:DARI|OF)\s+\d+)?$/i.test(u)
  );
}

function isMaterialTableStopLine(line: string): boolean {
  const u = line.trim().toUpperCase();
  if (!u) return false;
  return (
    u.startsWith('CATATAN') ||
    u.startsWith('NOTE') ||
    u.startsWith('APPROVED') ||
    u.startsWith('MENGETAHUI') ||
    u.startsWith('DISETUJUI') ||
    u.startsWith('DIBUAT') ||
    u.startsWith('TANDA TANGAN') ||
    u.startsWith('MATERIAL CARD') ||
    u.includes('GAMBAR MATERIAL CARD') ||
    /^\d+\s+ITEM\s+MATERIAL\b/i.test(u) ||
    /^TOTAL\s+(?:ITEM|MATERIAL|KEBUTUHAN)\b/i.test(u) ||
    /^SUB\s*TOTAL\b/i.test(u) ||
    /^GRAND\s+TOTAL\b/i.test(u) ||
    /^SIZE\s+BREAKDOWN\b/i.test(u)
  );
}

/**
 * Parses a tabular column header line into ordered column roles when tab/pipe/multi-space delimited.
 */
function parseHeaderColumnOrder(headerLine: string): MaterialColumnRole[] | null {
  let cells = headerLine.includes('\t')
    ? headerLine.split('\t').map((c) => c.trim())
    : headerLine.includes('|')
      ? headerLine.split('|').map((c) => c.trim())
      : headerLine.split(/\s{2,}/).map((c) => c.trim());

  cells = cells.filter(Boolean);
  if (cells.length < 3) return null;

  const roles: MaterialColumnRole[] = [];
  for (const c of cells) {
    const role = identifyColumnHeaderRole(c);
    if (role) roles.push(role);
  }
  if (roles.includes('codeAcc') && roles.includes('description')) {
    return roles;
  }
  return null;
}

/**
 * Parses a single material row from text, honoring an optional column layout (so empty TOTAL stays null
 * and RETURN / BALANCE are never mistaken for TOTAL).
 */
export function parseMaterialTableRow(
  line: string,
  docLocale: NumberLocale = 'unknown',
  columnOrder?: MaterialColumnRole[] | null
): ExtractedWorksheetMaterial | null {
  const trimmed = line.trim();
  if (!trimmed || isMaterialTableStopLine(trimmed) || isMaterialTableHeaderLine(trimmed)) {
    return null;
  }

  // Prefer single-tab or pipe split WITHOUT dropping empty interior cells!
  const hasTabs = trimmed.includes('\t');
  const hasPipes = trimmed.includes('|');

  if (hasTabs || hasPipes) {
    const rawCells = (hasTabs ? trimmed.split('\t') : trimmed.split('|')).map((c) => c.trim());
    // Strip leading/trailing empty cells produced by outer pipes
    while (rawCells.length > 0 && rawCells[0] === '' && (!columnOrder || rawCells.length > columnOrder.length)) {
      rawCells.shift();
    }
    while (rawCells.length > 0 && rawCells[rawCells.length - 1] === '' && (!columnOrder || rawCells.length > columnOrder.length)) {
      rawCells.pop();
    }

    if (columnOrder && rawCells.length >= Math.min(4, columnOrder.length)) {
      const getByRole = (role: MaterialColumnRole): string => {
        const idx = columnOrder.indexOf(role);
        return idx >= 0 && idx < rawCells.length ? rawCells[idx] : '';
      };

      const code = getByRole('codeAcc').trim();
      const desc = getByRole('description').trim();
      const unit = getByRole('unit').trim();
      const totalRaw = getByRole('total').trim();

      if (code && desc && unit) {
        const hasTotalCol = columnOrder.includes('total');
        const parsedTotal = parsePdfNumberWithContext(totalRaw, docLocale);
        const totalEmpty = hasTotalCol && (totalRaw === '' || totalRaw === '-');
        const unreadableTotal = !hasTotalCol || (!totalEmpty && parsedTotal.value === null);
        return {
          materialCode: code,
          materialName: desc,
          unit,
          total: totalEmpty || unreadableTotal ? null : parsedTotal.value,
          rawTotal: totalEmpty ? '' : parsedTotal.raw || totalRaw,
          totalStatus: totalEmpty ? 'empty' : unreadableTotal ? 'unreadable' : 'present',
          isTotalAmbiguous: parsedTotal.isAmbiguous || unreadableTotal,
          needsReview: parsedTotal.isAmbiguous || unreadableTotal,
          reviewNote: totalEmpty
            ? 'Kolom TOTAL kosong pada sumber PDF.'
            : !hasTotalCol
              ? 'Kolom TOTAL gagal terbaca dari struktur tabel PDF — perlu pemeriksaan pengguna.'
              : unreadableTotal
                ? `Nilai TOTAL "${totalRaw}" gagal terbaca sebagai angka — perlu pemeriksaan pengguna.`
                : parsedTotal.reason,
        };
      }
    }

    // Standard delimited row without extra columnOrder: [NO?] CODE DESCRIPTION [CONS?] UNIT TOTAL
    const nonEmptyCells = rawCells.filter(Boolean);
    if (nonEmptyCells.length >= 4) {
      const cells = [...nonEmptyCells];
      if (/^\d+$/.test(cells[0]) && cells.length >= 5) {
        cells.shift();
      }
      if (cells.length === 4) {
        const totalParsed = parsePdfNumberWithContext(cells[3], docLocale);
        if (totalParsed.value !== null || cells[3] === '-') {
          return {
            materialCode: cells[0],
            materialName: cells[1],
            unit: cells[2],
            total: totalParsed.value,
            rawTotal: totalParsed.raw,
            isTotalAmbiguous: totalParsed.isAmbiguous,
            needsReview: totalParsed.isAmbiguous,
            reviewNote: totalParsed.reason,
          };
        }
      } else if (cells.length >= 5) {
        const totalParsed = parsePdfNumberWithContext(cells[cells.length - 1], docLocale);
        const unit = cells[cells.length - 2];
        const code = cells[0];
        const desc = cells
          .slice(1, cells.length - 2)
          .filter((tok) => parsePdfNumberWithContext(tok, docLocale).value === null)
          .join(' ');
        if (totalParsed.value !== null && code && desc && unit) {
          return {
            materialCode: code,
            materialName: desc,
            unit,
            total: totalParsed.value,
            rawTotal: totalParsed.raw,
            isTotalAmbiguous: totalParsed.isAmbiguous,
            needsReview: totalParsed.isAmbiguous,
            reviewNote: totalParsed.reason,
          };
        }
      }
    }
  }

  // Multi-space split fallback
  const multiSpaceTokens = trimmed.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
  if (multiSpaceTokens.length >= 4) {
    const tokens = [...multiSpaceTokens];
    if (/^\d+$/.test(tokens[0]) && tokens.length >= 5) {
      tokens.shift();
    }
    if (tokens.length === 4) {
      const totalParsed = parsePdfNumberWithContext(tokens[3], docLocale);
      if (totalParsed.value !== null) {
        return {
          materialCode: tokens[0],
          materialName: tokens[1],
          unit: tokens[2],
          total: totalParsed.value,
          rawTotal: totalParsed.raw,
          isTotalAmbiguous: totalParsed.isAmbiguous,
          needsReview: totalParsed.isAmbiguous,
          reviewNote: totalParsed.reason,
        };
      }
    } else if (tokens.length >= 5) {
      const totalIdx = columnOrder ? columnOrder.indexOf('total') : -1;
      const balanceIdx = columnOrder ? columnOrder.indexOf('balance') : -1;
      // If table has columns AFTER TOTAL (like RETURN / BALANCE) and token count matches without TOTAL, avoid taking BALANCE!
      const effectiveCols = columnOrder
        ? columnOrder[0] === 'no'
          ? columnOrder.slice(1)
          : columnOrder
        : null;
      if (effectiveCols && totalIdx >= 0 && balanceIdx > totalIdx && tokens.length < effectiveCols.length) {
        // Missing one or more numeric cells (likely TOTAL is blank) -> do NOT pull BALANCE into TOTAL!
        const code = tokens[0];
        const unitIdx = effectiveCols.indexOf('unit');
        const descIdx = effectiveCols.indexOf('description');
        const unit = unitIdx >= 0 ? (tokens[unitIdx] || '') : '';
        const desc = descIdx >= 0 ? (tokens[descIdx] || '') : '';
        if (code && desc && unit && !/^\d/.test(unit)) {
          return {
            materialCode: code,
            materialName: desc,
            unit,
            total: null,
            rawTotal: '',
            totalStatus: 'empty',
            needsReview: false,
            reviewNote: 'Kolom TOTAL kosong pada sumber PDF.',
          };
        }
      }

      // Default: only use end tokens if NO extra columns after TOTAL exist
      if (!effectiveCols || balanceIdx === -1) {
        const totalParsed = parsePdfNumberWithContext(tokens[tokens.length - 1], docLocale);
        const unit = tokens[tokens.length - 2];
        const code = tokens[0];
        const desc = tokens
          .slice(1, tokens.length - 2)
          .filter((tok) => parsePdfNumberWithContext(tok, docLocale).value === null)
          .join(' ');
        if (totalParsed.value !== null && code && desc && unit) {
          return {
            materialCode: code,
            materialName: desc,
            unit,
            total: totalParsed.value,
            rawTotal: totalParsed.raw,
            isTotalAmbiguous: totalParsed.isAmbiguous,
            needsReview: totalParsed.isAmbiguous,
            reviewNote: totalParsed.reason,
          };
        }
      }
    }
  }

  // Fallback regex for single-space delimited row:
  // [No.] CodeACC Description [Cons] Unit Total
  const rowRegex =
    /^(?:\d+\s+)?([A-Za-z0-9][A-Za-z0-9_.-]*)\s+(.+?)\s+(?:[\d.,]+\s+)?([A-Za-z]{1,10})\s+([\d.,]+)$/;
  const match = trimmed.match(rowRegex);
  if (match) {
    // Only take numeric TOTAL if NO columns exist after TOTAL in columnOrder
    const hasTrailingColumns = columnOrder && (columnOrder.includes('return') || columnOrder.includes('balance'));
    if (!hasTrailingColumns) {
      const totalParsed = parsePdfNumberWithContext(match[4], docLocale);
      if (totalParsed.value !== null) {
        return {
          materialCode: match[1].trim(),
          materialName: match[2].trim(),
          unit: match[3].trim(),
          total: totalParsed.value,
          rawTotal: totalParsed.raw,
          isTotalAmbiguous: totalParsed.isAmbiguous,
          needsReview: totalParsed.isAmbiguous,
          reviewNote: totalParsed.reason,
        };
      }
    }
  }

  // Fallback when TOTAL is empty at end of row: [No.] CodeACC Description [Cons] Unit
  const emptyTotalRegex =
    /^(?:\d+\s+)?([A-Za-z0-9][A-Za-z0-9_.-]*)\s+(.+?)\s+(?:[\d.,]+\s+)?(yard|yds|pcs|pc|mtr|meter|kg|roll|cone|set|box|lembar|lsn|lusin|gram|gr|liter|ltr)\s*$/i;
  const emptyMatch = trimmed.match(emptyTotalRegex);
  if (emptyMatch) {
    return {
      materialCode: emptyMatch[1].trim(),
      materialName: emptyMatch[2].trim(),
      unit: emptyMatch[3].trim(),
      total: null,
      rawTotal: '',
      totalStatus: 'empty',
      needsReview: false,
      reviewNote: 'Kolom TOTAL kosong pada sumber PDF.',
    };
  }

  return null;
}

/**
 * Evaluates validation warnings and review flags for an extracted Worksheet before preview/save.
 */
export function validateExtractedWorksheet(
  ws: ExtractedPdfWorksheet
): {
  needsReview: boolean;
  reviewReasons: string[];
  fieldWarnings: WorksheetFieldWarning[];
} {
  const fieldWarnings: WorksheetFieldWarning[] = [];
  const reviewReasons: string[] = [];

  if (!ws.orNumber || !ws.orNumber.trim()) {
    const msg = 'No. OR tidak terbaca dari PDF. Mohon periksa dan isi No. OR.';
    fieldWarnings.push({ field: 'orNumber', severity: 'error', message: msg });
    reviewReasons.push(msg);
  }
  if (ws.worksheetNo && ws.orNumber && ws.worksheetNo.trim().toUpperCase() === ws.rawOrNumber?.trim().toUpperCase()) {
    const msg = 'No. OR terdeteksi sama dengan No. Worksheet — harap konfirmasi.';
    fieldWarnings.push({ field: 'orNumber', severity: 'warning', message: msg });
    reviewReasons.push(msg);
  }
  if (!ws.style || !ws.style.trim()) {
    const msg = 'Style No tidak terbaca dari PDF. Mohon isi Style secara manual.';
    fieldWarnings.push({ field: 'style', severity: 'error', message: msg });
    reviewReasons.push(msg);
  }
  if (ws.target === null || ws.target === undefined || !Number.isFinite(ws.target) || ws.target <= 0) {
    const msg = 'Target Produksi (TOTAL QTY) tidak terbaca atau bernilai 0.';
    fieldWarnings.push({ field: 'target', severity: 'error', message: msg });
    reviewReasons.push(msg);
  } else if (ws.isTargetAmbiguous) {
    const msg = `Format angka Target Produksi ("${ws.rawTarget ?? ws.target}") berpotensi ambigu — harap konfirmasi.`;
    fieldWarnings.push({ field: 'target', severity: 'warning', message: msg });
    reviewReasons.push(msg);
  }

  if (!ws.materials || ws.materials.length === 0) {
    const msg = 'Tabel MATERIAL & KONSUMSI tidak memiliki baris material yang terbaca.';
    fieldWarnings.push({ field: 'materials', severity: 'error', message: msg });
    reviewReasons.push(msg);
  } else {
    ws.materials.forEach((m, idx) => {
      if (!m.materialCode?.trim() || !m.materialName?.trim() || !m.unit?.trim()) {
        const msg = `Baris material ke-${idx + 1} belum lengkap (Code Acc / Description / Unit).`;
        fieldWarnings.push({ field: `materials[${idx}]`, severity: 'error', message: msg });
        reviewReasons.push(msg);
      } else if (m.totalStatus === 'unreadable') {
        const msg = `Nilai TOTAL material "${m.materialCode}" gagal terbaca dari PDF dan perlu diperiksa pengguna.`;
        fieldWarnings.push({ field: `materials[${idx}].total`, severity: 'warning', message: msg });
        reviewReasons.push(msg);
      } else if (m.isTotalAmbiguous) {
        const msg = `Format angka TOTAL material "${m.materialCode}" ("${m.rawTotal ?? m.total}") perlu dikonfirmasi.`;
        fieldWarnings.push({ field: `materials[${idx}].total`, severity: 'warning', message: msg });
        reviewReasons.push(msg);
      }
    });
  }

  // Include any pre-existing conflict warnings (e.g. from cross-checking deterministic vs AI)
  if (ws.fieldWarnings) {
    for (const existing of ws.fieldWarnings) {
      if (!fieldWarnings.some((w) => w.field === existing.field && w.message === existing.message)) {
        fieldWarnings.push(existing);
        reviewReasons.push(existing.message);
      }
    }
  }

  return {
    needsReview: fieldWarnings.length > 0,
    reviewReasons: Array.from(new Set(reviewReasons)),
    fieldWarnings,
  };
}

/**
 * Deterministic text parser for Garment/Manufacturing Worksheet PDFs.
 * Supports strict failure mode (default) and partial-review mode (`options.allowPartial = true`).
 */
export function parseWorksheetText(
  text: string,
  fileName: string = 'Worksheet.pdf',
  options?: { allowPartial?: boolean }
): {
  success: boolean;
  data?: ExtractedPdfWorksheet;
  error?: string;
} {
  if (!text || !text.trim()) {
    return {
      success: false,
      error: `Dokumen ${fileName} kosong atau tidak berisi teks yang dapat dibaca.`,
    };
  }

  const docLocale = detectDocumentNumberLocale(text);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(l));

  const identity = extractIdentityFromLines(lines, docLocale);

  // Extract MATERIAL & KONSUMSI table
  const materials: ExtractedWorksheetMaterial[] = [];
  let tableStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toUpperCase();
    if (
      upper.includes('MATERIAL & KONSUMSI') ||
      upper.includes('MATERIAL DAN KONSUMSI') ||
      isMaterialTableHeaderLine(lines[i])
    ) {
      tableStartIndex = i;
      break;
    }
  }

  if (tableStartIndex !== -1) {
    let columnOrder: MaterialColumnRole[] | null = isMaterialTableHeaderLine(lines[tableStartIndex])
      ? parseHeaderColumnOrder(lines[tableStartIndex])
      : null;

    for (let i = tableStartIndex + 1; i < lines.length; i++) {
      const line = lines[i];

      if (isPageFooterNoiseLine(line)) {
        continue;
      }

      if (isMaterialTableStopLine(line)) {
        break;
      }

      if (isMaterialTableHeaderLine(line)) {
        columnOrder = parseHeaderColumnOrder(line) || columnOrder;
        continue;
      }

      const parsedRow = parseMaterialTableRow(line, docLocale, columnOrder);
      if (parsedRow) {
        materials.push(parsedRow);
      } else if (materials.length > 0 && !HEADER_LABEL_BOUNDARY_RE.test(line) && !/^\d+$/.test(line)) {
        // Check if it's a wrapped continuation of previous description (letters/spaces only, no numeric tokens at end)
        const prev = materials[materials.length - 1];
        if (/^[A-Za-z0-9.,/()\s-]+$/.test(line) && !/\d+[.,]\d+/.test(line) && line.length <= 60) {
          prev.materialName = `${prev.materialName} ${line}`.replace(/\s+/g, ' ').trim();
        }
      }
    }
  }

  const baseWs: ExtractedPdfWorksheet = {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    orNumber: identity.orNumber,
    rawOrNumber: identity.rawOrNumber || undefined,
    worksheetNo: identity.worksheetNo || undefined,
    style: identity.style,
    target: identity.target,
    rawTarget: identity.rawTarget || undefined,
    isTargetAmbiguous: identity.isTargetAmbiguous,
    materials,
    extractionMethod: 'text',
    rawText: text,
  };

  if (options?.allowPartial) {
    const hasAnySignal =
      Boolean(baseWs.orNumber) ||
      Boolean(baseWs.worksheetNo) ||
      Boolean(baseWs.style) ||
      baseWs.target !== null ||
      baseWs.materials.length > 0;
    if (!hasAnySignal) {
      return {
        success: false,
        error: `Dokumen ${fileName} tidak memuat informasi Worksheet yang dapat dikenali dari teks.`,
      };
    }
    const review = validateExtractedWorksheet(baseWs);
    baseWs.needsReview = review.needsReview;
    baseWs.reviewReasons = review.reviewReasons;
    baseWs.fieldWarnings = review.fieldWarnings;
    return { success: true, data: baseWs };
  }

  // Strict validation error messages (backward-compatible with deterministic contract)
  if (!identity.orNumber) {
    return {
      success: false,
      error: `Informasi No. OR tidak ditemukan pada file ${fileName}. Pastikan dokumen memuat identitas No. OR.`,
    };
  }
  if (!identity.style) {
    return {
      success: false,
      error: `Informasi Style tidak berhasil diekstrak dari file ${fileName}.`,
    };
  }
  if (!identity.target || identity.target <= 0) {
    return {
      success: false,
      error: `Informasi Total Qty (Target Produksi) tidak ditemukan pada file ${fileName}.`,
    };
  }
  if (tableStartIndex === -1) {
    return {
      success: false,
      error: `Tabel MATERIAL & KONSUMSI tidak berhasil dibaca pada file ${fileName}.`,
    };
  }
  if (materials.length === 0) {
    return {
      success: false,
      error: `Tabel MATERIAL & KONSUMSI pada file ${fileName} tidak memuat baris data material yang valid.`,
    };
  }

  const review = validateExtractedWorksheet(baseWs);
  baseWs.needsReview = review.needsReview;
  baseWs.reviewReasons = review.reviewReasons;
  baseWs.fieldWarnings = review.fieldWarnings;

  return {
    success: true,
    data: baseWs,
  };
}

interface ReconstructedLine {
  pageNum: number;
  y: number;
  items: PdfCoordinateTextItem[];
  text: string;
}

function groupPageItemsIntoLines(page: PdfCoordinatePage): ReconstructedLine[] {
  const validItems = page.items.filter((it) => it.str && it.str.trim().length > 0);
  if (validItems.length === 0) return [];

  // PDF coordinate Y increases bottom-to-top; sort descending Y, then ascending X
  const sorted = [...validItems].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 3.5) return dy;
    return a.x - b.x;
  });

  const rows: Array<{ y: number; items: PdfCoordinateTextItem[] }> = [];
  for (const item of sorted) {
    const lastRow = rows[rows.length - 1];
    const tol = Math.max(3.5, (item.height || 10) * 0.45);
    if (lastRow && Math.abs(lastRow.y - item.y) <= tol) {
      lastRow.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows.map((r) => {
    const rowItems = [...r.items].sort((a, b) => a.x - b.x);
    let text = '';
    for (let i = 0; i < rowItems.length; i++) {
      const curr = rowItems[i];
      if (i > 0) {
        const prev = rowItems[i - 1];
        const prevEnd = prev.x + (prev.width || 0);
        const gap = curr.x - prevEnd;
        if (gap > 14) {
          text += '\t';
        } else if (gap > 2 && !text.endsWith(' ') && !curr.str.startsWith(' ')) {
          text += ' ';
        }
      }
      text += curr.str;
    }
    return {
      pageNum: page.pageNum,
      y: r.y,
      items: rowItems,
      text: text.trim(),
    };
  });
}

interface ColumnBox {
  role: MaterialColumnRole;
  xStart: number;
  xEnd: number;
  boundLeft: number;
  boundRight: number;
}

function buildColumnBoxesFromHeaderRow(row: ReconstructedLine): ColumnBox[] | null {
  // Merge adjacent spans separated by tiny gap (< 6pt) so multi-word headers like "CODE ACC" stay together
  const mergedSpans: Array<{ text: string; xStart: number; xEnd: number }> = [];
  for (const it of row.items) {
    const last = mergedSpans[mergedSpans.length - 1];
    const spanEnd = it.x + Math.max(it.width || 0, it.str.length * 4);
    if (last && it.x - last.xEnd <= 6) {
      last.text = `${last.text} ${it.str}`.replace(/\s+/g, ' ').trim();
      last.xEnd = Math.max(last.xEnd, spanEnd);
    } else {
      mergedSpans.push({ text: it.str.trim(), xStart: it.x, xEnd: spanEnd });
    }
  }

  const detected: Array<{ role: MaterialColumnRole; xStart: number; xEnd: number }> = [];
  for (const span of mergedSpans) {
    const role = identifyColumnHeaderRole(span.text);
    if (role) {
      detected.push({ role, xStart: span.xStart, xEnd: span.xEnd });
    }
  }

  const hasCode = detected.some((d) => d.role === 'codeAcc');
  const hasDesc = detected.some((d) => d.role === 'description');
  if (!hasCode || !hasDesc || detected.length < 3) {
    return null;
  }

  const sorted = [...detected].sort((a, b) => a.xStart - b.xStart);
  return sorted.map((col, idx) => {
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

    let boundLeft = prev ? (prev.xEnd + col.xStart) / 2 : -Infinity;
    let boundRight = next ? (col.xEnd + next.xStart) / 2 : Infinity;

    // For wide text columns like DESCRIPTION followed by numeric CONS/UNIT, extend DESCRIPTION right boundary close to next header start
    if (col.role === 'description' && next) {
      boundRight = Math.max(boundRight, next.xStart - 14);
    }
    if (prev && prev.role === 'description') {
      boundLeft = Math.max(boundLeft, col.xStart - 14);
    }

    return {
      role: col.role,
      xStart: col.xStart,
      xEnd: col.xEnd,
      boundLeft,
      boundRight,
    };
  });
}

/**
 * Coordinate-aware PDF Worksheet extractor using pdf.js text item positions (x, y).
 * Prevents column shifting when TOTAL is empty while BALANCE has values, isolates multi-column headers,
 * and stops material parsing before summary rows or Material Card (Page 2).
 */
export function extractWorksheetFromPdfCoordinates(
  pages: PdfCoordinatePage[],
  fileName: string = 'Worksheet.pdf'
): {
  success: boolean;
  data?: ExtractedPdfWorksheet;
  error?: string;
} {
  if (!pages || pages.length === 0) {
    return {
      success: false,
      error: `Dokumen ${fileName} tidak memiliki halaman yang dapat dibaca.`,
    };
  }

  const allPageLines: ReconstructedLine[] = [];
  for (const page of pages) {
    allPageLines.push(...groupPageItemsIntoLines(page));
  }

  const fullText = allPageLines.map((l) => l.text).join('\n');
  if (!fullText.trim()) {
    return {
      success: false,
      error: `Dokumen ${fileName} tidak berisi lapisan teks (kemungkinan PDF hasil scan/gambar).`,
    };
  }

  const docLocale = detectDocumentNumberLocale(fullText);

  // 1. Identity extraction (text + box-below fallback for 2-column header layouts)
  const textIdentity = extractIdentityFromLines(
    allPageLines.map((l) => l.text),
    docLocale
  );

  // Coordinate box lookup if any identity field was laid out vertically (label above value in same column)
  const findVerticalValueForLabel = (labelRe: RegExp): string => {
    for (let li = 0; li < allPageLines.length; li++) {
      const row = allPageLines[li];
      for (let ii = 0; ii < row.items.length; ii++) {
        const it = row.items[ii];
        if (!labelRe.test(it.str)) continue;
        // Look up to 2 rows below on same page with closest matching X
        const nextX = ii + 1 < row.items.length ? row.items[ii + 1].x : Infinity;
        for (let lj = li + 1; lj < Math.min(li + 4, allPageLines.length); lj++) {
          const belowRow = allPageLines[lj];
          if (belowRow.pageNum !== row.pageNum) break;
          if (row.y - belowRow.y > 40) break;
          const matchingItems = belowRow.items.filter(
            (b) => b.x >= it.x - 18 && b.x < nextX - 5 && !HEADER_LABEL_BOUNDARY_RE.test(b.str)
          );
          if (matchingItems.length > 0) {
            return matchingItems.map((m) => m.str.trim()).join(' ').trim();
          }
        }
      }
    }
    return '';
  };

  if (!textIdentity.worksheetNo) {
    const boxWs = findVerticalValueForLabel(/^(?:NO\.?\s*WORKSHEET|WORKSHEET\s*NO\.?)\s*:?$/i);
    if (boxWs) textIdentity.worksheetNo = boxWs;
  }
  if (!textIdentity.rawOrNumber) {
    const boxOr = findVerticalValueForLabel(/^(?:NO\.?\s*OR|ORDER\s*NO\.?)\s*:?$/i);
    if (boxOr && !/^WH\//i.test(boxOr)) {
      textIdentity.rawOrNumber = boxOr.split(/\s+/)[0];
      textIdentity.orNumber = extractOrNumberFromIdentifier(textIdentity.rawOrNumber);
    }
  }
  if (!textIdentity.style) {
    const boxStyle = findVerticalValueForLabel(/^STYLE(?:\s*(?:NO\.?|NAME|DESC))?\s*:?$/i);
    if (boxStyle) textIdentity.style = boxStyle;
  }
  if (textIdentity.target === null) {
    const boxQty = findVerticalValueForLabel(/^TOTAL\s*(?:ORDER\s*)?QTY(?:\s*\(PCS\))?\s*:?$/i);
    if (boxQty) {
      const parsed = parsePdfNumberWithContext(boxQty.split(/\s+/)[0], docLocale, {
        isIntegerQtyContext: true,
      });
      if (parsed.value !== null && parsed.value > 0) {
        textIdentity.target = parsed.value;
        textIdentity.rawTarget = parsed.raw;
        textIdentity.isTargetAmbiguous = parsed.isAmbiguous;
        textIdentity.targetWarning = parsed.reason;
      }
    }
  }

  // 2. Coordinate-mapped material table extraction
  const materials: ExtractedWorksheetMaterial[] = [];
  let inMaterialSection = false;
  let activeColumns: ColumnBox[] | null = null;
  let stoppedTable = false;

  for (let i = 0; i < allPageLines.length; i++) {
    const row = allPageLines[i];
    const upper = row.text.toUpperCase();

    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(row.text) || isPageFooterNoiseLine(row.text)) continue;

    if (upper.includes('MATERIAL & KONSUMSI') || upper.includes('MATERIAL DAN KONSUMSI')) {
      inMaterialSection = true;
      stoppedTable = false;
      continue;
    }

    if (stoppedTable) {
      continue;
    }

    const headerCols = buildColumnBoxesFromHeaderRow(row);
    if (headerCols) {
      inMaterialSection = true;
      activeColumns = headerCols;
      continue;
    }

    if (!inMaterialSection) continue;

    if (isMaterialTableStopLine(row.text)) {
      stoppedTable = true;
      continue;
    }

    if (activeColumns) {
      // Assign each text item on this Y-row to its matching column box
      const cellMap = new Map<MaterialColumnRole, string[]>();
      for (const item of row.items) {
        const itemCenter = item.x + (item.width || 0) / 2;
        let matchedCol = activeColumns.find(
          (col) => itemCenter >= col.boundLeft && itemCenter <= col.boundRight
        );
        if (!matchedCol) {
          matchedCol = activeColumns.find(
            (col) => item.x >= col.boundLeft && item.x <= col.boundRight
          );
        }
        if (matchedCol) {
          const list = cellMap.get(matchedCol.role) || [];
          list.push(item.str.trim());
          cellMap.set(matchedCol.role, list);
        }
      }

      const code = (cellMap.get('codeAcc') || []).join(' ').trim();
      const desc = (cellMap.get('description') || []).join(' ').trim();
      const unit = (cellMap.get('unit') || []).join(' ').trim();
      const totalRaw = (cellMap.get('total') || []).join(' ').trim();

      // Wrapped description continuation line (no code, no unit, no total, only description text)
      if (!code && desc && !unit && !totalRaw && materials.length > 0) {
        const prev = materials[materials.length - 1];
        prev.materialName = `${prev.materialName} ${desc}`.replace(/\s+/g, ' ').trim();
        continue;
      }

      if (code || desc || unit || totalRaw) {
        // Ignore pure row-number or decorative divider lines
        if (!code && !desc) continue;

        const hasTotalCol = activeColumns.some((c) => c.role === 'total');
        const totalEmpty = hasTotalCol && (totalRaw === '' || totalRaw === '-');
        const parsedTotal = parsePdfNumberWithContext(totalRaw, docLocale);
        const unreadableTotal = !hasTotalCol || (!totalEmpty && parsedTotal.value === null);

        materials.push({
          materialCode: code,
          materialName: desc,
          unit,
          total: totalEmpty || unreadableTotal ? null : parsedTotal.value,
          rawTotal: totalEmpty ? '' : parsedTotal.raw || totalRaw,
          totalStatus: totalEmpty ? 'empty' : unreadableTotal ? 'unreadable' : 'present',
          isTotalAmbiguous: parsedTotal.isAmbiguous || unreadableTotal,
          needsReview:
            !code || !desc || !unit || parsedTotal.isAmbiguous || unreadableTotal,
          reviewNote:
            !code || !desc || !unit
              ? 'Kolom Code Acc / Description / Unit belum lengkap.'
              : totalEmpty
                ? 'Kolom TOTAL kosong pada sumber PDF.'
                : !hasTotalCol
                  ? 'Kolom TOTAL gagal terbaca dari struktur PDF — perlu pemeriksaan pengguna.'
                  : unreadableTotal
                    ? `Nilai TOTAL "${totalRaw}" gagal terbaca sebagai angka — perlu pemeriksaan pengguna.`
                    : parsedTotal.reason,
        });
      }
    } else {
      const fallbackRow = parseMaterialTableRow(row.text, docLocale);
      if (fallbackRow) {
        materials.push(fallbackRow);
      }
    }
  }

  // Fallback to pure text parser if coordinate columns didn't capture rows
  if (materials.length === 0) {
    const textRes = parseWorksheetText(fullText, fileName, { allowPartial: true });
    if (textRes.success && textRes.data) {
      if (textIdentity.worksheetNo && !textRes.data.worksheetNo) {
        textRes.data.worksheetNo = textIdentity.worksheetNo;
      }
      if (textIdentity.orNumber && !textRes.data.orNumber) {
        textRes.data.orNumber = textIdentity.orNumber;
        textRes.data.rawOrNumber = textIdentity.rawOrNumber || undefined;
      }
      if (textIdentity.style && !textRes.data.style) {
        textRes.data.style = textIdentity.style;
      }
      if (textIdentity.target !== null && textRes.data.target === null) {
        textRes.data.target = textIdentity.target;
        textRes.data.rawTarget = textIdentity.rawTarget || undefined;
      }
      const review = validateExtractedWorksheet(textRes.data);
      textRes.data.needsReview = review.needsReview;
      textRes.data.reviewReasons = review.reviewReasons;
      textRes.data.fieldWarnings = review.fieldWarnings;
      return textRes;
    }
  }

  const ws: ExtractedPdfWorksheet = {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    orNumber: textIdentity.orNumber,
    rawOrNumber: textIdentity.rawOrNumber || undefined,
    worksheetNo: textIdentity.worksheetNo || undefined,
    style: textIdentity.style,
    target: textIdentity.target,
    rawTarget: textIdentity.rawTarget || undefined,
    isTargetAmbiguous: textIdentity.isTargetAmbiguous,
    materials,
    extractionMethod: 'coordinates',
    rawText: fullText,
  };

  const review = validateExtractedWorksheet(ws);
  ws.needsReview = review.needsReview;
  ws.reviewReasons = review.reviewReasons;
  ws.fieldWarnings = review.fieldWarnings;

  return {
    success: true,
    data: ws,
  };
}

/**
 * Reconciles deterministic extraction with AI/OCR visual extraction.
 * - Fills missing fields from the secondary method without guessing.
 * - Flags differences explicitly for user confirmation instead of silently picking one arbitrarily.
 */
export function reconcileWorksheetExtractions(
  deterministic: ExtractedPdfWorksheet | null | undefined,
  aiExtracted: ExtractedPdfWorksheet | null | undefined,
  fileName: string
): ExtractedPdfWorksheet {
  if (!deterministic && !aiExtracted) {
    const emptyWs: ExtractedPdfWorksheet = {
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName,
      orNumber: '',
      style: '',
      target: null,
      materials: [],
    };
    const rev = validateExtractedWorksheet(emptyWs);
    return { ...emptyWs, ...rev };
  }
  if (!deterministic && aiExtracted) {
    const rev = validateExtractedWorksheet(aiExtracted);
    return {
      ...aiExtracted,
      extractionMethod: aiExtracted.extractionMethod || 'gemini',
      needsReview: rev.needsReview,
      reviewReasons: rev.reviewReasons,
      fieldWarnings: rev.fieldWarnings,
    };
  }
  if (deterministic && !aiExtracted) {
    const rev = validateExtractedWorksheet(deterministic);
    return {
      ...deterministic,
      needsReview: rev.needsReview,
      reviewReasons: rev.reviewReasons,
      fieldWarnings: rev.fieldWarnings,
    };
  }

  const det = deterministic!;
  const ai = aiExtracted!;
  const conflictWarnings: WorksheetFieldWarning[] = [];

  const normText = (v?: string | null) => (v || '').trim().replace(/\s+/g, ' ').toUpperCase();

  let orNumber = det.orNumber || ai.orNumber || '';
  let rawOrNumber = det.rawOrNumber || ai.rawOrNumber;
  if (det.orNumber && ai.orNumber && normText(det.orNumber) !== normText(ai.orNumber)) {
    conflictWarnings.push({
      field: 'orNumber',
      severity: 'warning',
      message: `Perbedaan hasil pembacaan No. OR antara teks PDF ("${det.rawOrNumber || det.orNumber}") dan OCR/AI ("${ai.rawOrNumber || ai.orNumber}"). Mohon periksa.`,
      candidates: [det.rawOrNumber || det.orNumber, ai.rawOrNumber || ai.orNumber],
    });
  }

  let worksheetNo = det.worksheetNo || ai.worksheetNo;
  if (det.worksheetNo && ai.worksheetNo && normText(det.worksheetNo) !== normText(ai.worksheetNo)) {
    conflictWarnings.push({
      field: 'worksheetNo',
      severity: 'warning',
      message: `Perbedaan hasil pembacaan No. Worksheet ("${det.worksheetNo}" vs "${ai.worksheetNo}"). Mohon periksa.`,
      candidates: [det.worksheetNo, ai.worksheetNo],
    });
  }

  let style = det.style || ai.style || '';
  if (det.style && ai.style && normText(det.style) !== normText(ai.style)) {
    conflictWarnings.push({
      field: 'style',
      severity: 'warning',
      message: `Perbedaan hasil pembacaan Style ("${det.style}" vs "${ai.style}"). Mohon periksa.`,
      candidates: [det.style, ai.style],
    });
  }

  let target = det.target !== null && det.target !== undefined ? det.target : ai.target;
  let rawTarget = det.target !== null && det.target !== undefined ? det.rawTarget : ai.rawTarget;
  if (
    det.target !== null &&
    det.target !== undefined &&
    ai.target !== null &&
    ai.target !== undefined &&
    Math.abs(det.target - ai.target) > 0.0001
  ) {
    conflictWarnings.push({
      field: 'target',
      severity: 'warning',
      message: `Perbedaan hasil Target Produksi antara teks PDF (${det.rawTarget || det.target}) dan OCR/AI (${ai.rawTarget || ai.target}). Mohon konfirmasi.`,
      candidates: [String(det.rawTarget || det.target), String(ai.rawTarget || ai.target)],
    });
  }

  // Materials: prefer deterministic coordinate/text rows when present; supplement with AI if deterministic found none
  let materials = det.materials && det.materials.length > 0 ? det.materials.map((m) => ({ ...m })) : ai.materials.map((m) => ({ ...m }));
  if (det.materials.length > 0 && ai.materials.length > 0) {
    if (det.materials.length !== ai.materials.length) {
      conflictWarnings.push({
        field: 'materials',
        severity: 'warning',
        message: `Jumlah baris material berbeda antara teks PDF (${det.materials.length} baris) dan OCR/AI (${ai.materials.length} baris). Mohon periksa daftar material.`,
      });
    } else {
      for (let i = 0; i < materials.length; i++) {
        const dm = det.materials[i];
        const am = ai.materials[i];
        if (normText(dm.materialCode) !== normText(am.materialCode)) {
          conflictWarnings.push({
            field: `materials[${i}]`,
            severity: 'warning',
            message: `Kode material baris ke-${i + 1} berbeda (${dm.materialCode} vs ${am.materialCode}).`,
            candidates: [dm.materialCode, am.materialCode],
          });
          materials[i].needsReview = true;
          materials[i].reviewNote = `Beda pembacaan: ${dm.materialCode} vs ${am.materialCode}`;
        } else if (
          dm.total !== null &&
          am.total !== null &&
          Math.abs(dm.total - am.total) > 0.001
        ) {
          conflictWarnings.push({
            field: `materials[${i}].total`,
            severity: 'warning',
            message: `Nilai TOTAL material "${dm.materialCode}" berbeda (${dm.rawTotal || dm.total} vs ${am.rawTotal || am.total}).`,
            candidates: [String(dm.rawTotal || dm.total), String(am.rawTotal || am.total)],
          });
          materials[i].needsReview = true;
          materials[i].isTotalAmbiguous = true;
          materials[i].totalStatus = 'present';
          materials[i].reviewNote = `Beda pembacaan TOTAL: ${dm.rawTotal || dm.total} vs ${am.rawTotal || am.total}`;
        } else if (dm.total === null) {
          // NEVER allow AI/Gemini to fill a blank or unreadable deterministic TOTAL!
          const isExplicitlyUnreadable =
            dm.totalStatus === 'unreadable' ||
            Boolean(dm.rawTotal && dm.rawTotal.trim() !== '' && dm.rawTotal.trim() !== '-') ||
            Boolean(dm.isTotalAmbiguous && !dm.reviewNote?.toLowerCase().includes('kosong'));

          materials[i].total = null;
          if (isExplicitlyUnreadable) {
            materials[i].rawTotal = dm.rawTotal ?? '';
            materials[i].totalStatus = 'unreadable';
            materials[i].needsReview = true;
            materials[i].isTotalAmbiguous = true;
            materials[i].reviewNote =
              dm.reviewNote ||
              'Nilai TOTAL gagal terbaca dari PDF dan tidak diisi otomatis — perlu pemeriksaan pengguna.';
          } else {
            // Confirmed empty TOTAL in PDF structure/coordinates -> keep null & empty rawTotal
            materials[i].rawTotal = '';
            materials[i].totalStatus = 'empty';
            materials[i].reviewNote = 'Kolom TOTAL kosong pada sumber PDF.';
          }
        }
      }
    }
  }

  const merged: ExtractedPdfWorksheet = {
    id: det.id || ai.id,
    fileName,
    orNumber,
    rawOrNumber,
    worksheetNo,
    style,
    target,
    rawTarget,
    isTargetAmbiguous: det.isTargetAmbiguous ?? ai.isTargetAmbiguous,
    materials,
    extractionMethod: 'hybrid',
    fieldWarnings: conflictWarnings,
    rawText: det.rawText || ai.rawText,
  };

  const review = validateExtractedWorksheet(merged);
  merged.needsReview = review.needsReview;
  merged.reviewReasons = review.reviewReasons;
  merged.fieldWarnings = review.fieldWarnings;

  return merged;
}

/**
 * Normalizes uploadTime strings like "08:45:10 WIB" or "08.45.10 WIB" into "08:45:10"
 */
function normalizeUploadTimeString(rawTime?: string | null): string {
  if (!rawTime) return '00:00:00';
  const match = rawTime.match(/(\d{1,2})[:.](\d{1,2})(?:[:.](\d{1,2}))?/);
  if (!match) return '00:00:00';
  const hh = match[1].padStart(2, '0');
  const mm = match[2].padStart(2, '0');
  const ss = (match[3] || '00').padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Computes an authoritative transaction timestamp (in epoch ms) for an Excel upload.
 * Priority:
 * 1. Explicit database transaction timestamp (`createdAt`)
 * 2. Synthesized WIB (+07:00) timestamp from `updateDate` + `uploadTime`
 */
export function getUploadTransactionTimestampMs(upload: {
  createdAt?: string | null;
  updateDate?: string | null;
  uploadTime?: string | null;
  importedAt?: string | null;
}): number {
  if (upload.createdAt) {
    const parsed = Date.parse(upload.createdAt);
    if (!isNaN(parsed)) return parsed;
  }
  if (upload.importedAt) {
    const parsed = Date.parse(upload.importedAt);
    if (!isNaN(parsed)) return parsed;
  }
  if (upload.updateDate && /^\d{4}-\d{2}-\d{2}$/.test(upload.updateDate.trim())) {
    const timeStr = normalizeUploadTimeString(upload.uploadTime);
    const parsed = Date.parse(`${upload.updateDate.trim()}T${timeStr}+07:00`);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

/**
 * Deterministic comparator for selecting the latest Excel upload transaction.
 * Sorts descending (newest first).
 */
export function compareUploadTransactionsDesc(a: UploadHistoryItem, b: UploadHistoryItem): number {
  const tsA = getUploadTransactionTimestampMs(a);
  const tsB = getUploadTransactionTimestampMs(b);
  if (tsB !== tsA) return tsB - tsA;

  // Deterministic tie-breakers when timestamps are identical
  const dateA = (a.updateDate || '').trim();
  const dateB = (b.updateDate || '').trim();
  if (dateB !== dateA) return dateB.localeCompare(dateA);

  const timeA = normalizeUploadTimeString(a.uploadTime);
  const timeB = normalizeUploadTimeString(b.uploadTime);
  if (timeB !== timeA) return timeB.localeCompare(timeA);

  const updA = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0;
  const updB = b.updatedAt ? Date.parse(b.updatedAt) || 0 : 0;
  if (updB !== updA) return updB - updA;

  return (b.id || '').localeCompare(a.id || '');
}

/**
 * Resolves ONLY the single latest Excel upload transaction for a specific No. OR,
 * along with ONLY the material_requirements rows belonging to that latest upload.
 *
 * Rules:
 * - Each No. OR resolves its own latest upload independently.
 * - Never falls back to older uploads for the same No. OR.
 * - Ignores failed ('Gagal') uploads and empty in-progress sessions.
 */
export function findLatestUploadForOr(
  orNumber: string,
  masterRequirements: MaterialItemRequirement[],
  uploadHistory: UploadHistoryItem[] = []
): LatestOrUploadResolution {
  const orRecords = masterRequirements.filter((mr) => areOrNumbersMatching(mr.orNumber, orNumber));

  // 1. Check authoritative uploadHistory entries for this OR
  const matchingUploads = uploadHistory.filter((h) => {
    if (!areOrNumbersMatching(h.orNumber, orNumber)) return false;
    if (h.status === 'Gagal') return false;
    if (String(h.status) === 'Melanjutkan Upload...' || String(h.status) === 'Sedang Berjalan') {
      // Only consider in-progress upload if it already has rows in memory
      return orRecords.some((r) => r.uploadId === h.id);
    }
    return true;
  });

  if (matchingUploads.length > 0) {
    const sorted = [...matchingUploads].sort(compareUploadTransactionsDesc);
    const latestUpload = sorted[0];

    // Strictly select rows belonging to latestUpload ONLY (no fallback to older uploads!)
    const rows = orRecords.filter((r) => {
      if (r.uploadId) {
        return r.uploadId === latestUpload.id;
      }
      return (r.updateDate || '') === (latestUpload.updateDate || '');
    });

    return {
      orNumber,
      latestUpload,
      rows,
    };
  }

  // 2. Fallback ONLY when uploadHistory has no entries for this OR (e.g., direct test fixtures)
  if (orRecords.length === 0) {
    return {
      orNumber,
      latestUpload: null,
      rows: [],
    };
  }

  // Group records by upload transaction key (uploadId or updateDate or legacy default)
  const groups = new Map<
    string,
    {
      key: string;
      rows: MaterialItemRequirement[];
      ts: number;
      updateDate: string;
    }
  >();

  for (const r of orRecords) {
    const key = r.uploadId || (r.updateDate ? `date:${r.updateDate}` : '__legacy__');
    const ts = getUploadTransactionTimestampMs({
      createdAt: r.createdAt,
      importedAt: r.importedAt,
      updateDate: r.updateDate,
    });
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        rows: [r],
        ts,
        updateDate: r.updateDate || '',
      });
    } else {
      existing.rows.push(r);
      if (ts > existing.ts) existing.ts = ts;
      if ((r.updateDate || '') > existing.updateDate) existing.updateDate = r.updateDate || '';
    }
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts;
    if (b.updateDate !== a.updateDate) return b.updateDate.localeCompare(a.updateDate);
    return b.key.localeCompare(a.key);
  });

  const latestGroup = sortedGroups[0];
  const sampleRow = latestGroup.rows[0];
  const virtualUpload: UploadHistoryItem | null =
    latestGroup.key === '__legacy__'
      ? null
      : {
          id: sampleRow.uploadId || latestGroup.key,
          orNumber: sampleRow.orNumber,
          style: sampleRow.style,
          fileName: 'Excel Upload',
          updateDate: sampleRow.updateDate || '',
          uploadTime: '',
          rowCount: latestGroup.rows.length,
          status: 'Sukses',
          createdAt: sampleRow.createdAt || sampleRow.importedAt,
        };

  return {
    orNumber,
    latestUpload: virtualUpload,
    rows: latestGroup.rows,
  };
}

/**
 * Matches extracted PDF materials against ONLY the latest Excel upload for the PDF's No. OR.
 * Rules:
 * - Match strictly on same No. OR + Kode Material from the single latest Excel upload for that OR
 * - Do NOT fall back to older uploads for the same OR
 * - Do NOT take data from other ORs
 * - If found: receivedQty = received from latest upload, status = 'READY' | 'BELUM READY'
 * - If not found: receivedQty = null (display '-'), status = null (display '-')
 * - Preserves order and duplicate materials in PDF
 */
export function matchMaterialsWithMasterData(
  materials: ExtractedWorksheetMaterial[],
  orNumber: string,
  masterRequirements: MaterialItemRequirement[],
  uploadHistory: UploadHistoryItem[] = [],
  matchedAtIso?: string
): WorksheetMaterialMatched[] {
  const { latestUpload, rows: latestOrRecords } = findLatestUploadForOr(
    orNumber,
    masterRequirements,
    uploadHistory
  );

  const matchedAt = matchedAtIso || new Date().toISOString();
  const matchedUploadId = latestUpload?.id || null;
  const matchedUploadDate = latestUpload?.updateDate || latestOrRecords[0]?.updateDate || null;
  const matchedUploadTime = latestUpload?.uploadTime || null;
  const matchedUploadCreatedAt = latestUpload?.createdAt || null;

  // Map ONLY rows from the latest upload by material code (case-insensitive)
  const masterByCode = new Map<string, { totalReceived: number; totalRequired: number; isReady: boolean }>();
  for (const mr of latestOrRecords) {
    const key = mr.materialCode.trim().toUpperCase();
    const existing = masterByCode.get(key) || { totalReceived: 0, totalRequired: 0, isReady: false };
    existing.totalReceived += mr.receivedQty || 0;
    existing.totalRequired += mr.requiredQty || 0;
    existing.isReady = existing.totalReceived >= existing.totalRequired;
    masterByCode.set(key, existing);
  }

  return materials.map((item, idx) => {
    const key = item.materialCode.trim().toUpperCase();
    const matchedMaster = masterByCode.get(key);
    const existingId = (item as WorksheetMaterialItem).id || `wsm-${idx + 1}`;

    if (matchedMaster) {
      return {
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        total: item.total,
        id: existingId,
        receivedQty: matchedMaster.totalReceived,
        status: matchedMaster.isReady ? 'READY' : 'BELUM READY',
        isFoundInMasterData: true,
        matchedUploadId,
        matchedUploadDate,
        matchedUploadTime,
        matchedUploadCreatedAt,
        matchedAt,
      };
    }

    // Material NOT found in the latest upload for this OR:
    // Diterima: null (display '-'), Status: null (display '-')
    // Do NOT fall back to older uploads and do NOT automatically mark as Belum Ready!
    return {
      materialCode: item.materialCode,
      materialName: item.materialName,
      unit: item.unit,
      total: item.total,
      id: existingId,
      receivedQty: null,
      status: null,
      isFoundInMasterData: false,
      matchedUploadId,
      matchedUploadDate,
      matchedUploadTime,
      matchedUploadCreatedAt,
      matchedAt,
    };
  });
}

/**
 * Freezes a complete material snapshot onto a WorksheetPdfItem using the latest Excel upload per OR.
 * Preserves all original PDF fields verbatim.
 */
export function buildWorksheetSnapshot(
  worksheet: WorksheetPdfItem,
  masterRequirements: MaterialItemRequirement[],
  uploadHistory: UploadHistoryItem[] = [],
  syncTimestampIso?: string
): WorksheetPdfItem {
  const timestamp = syncTimestampIso || new Date().toISOString();
  const { latestUpload } = findLatestUploadForOr(
    worksheet.orNumber,
    masterRequirements,
    uploadHistory
  );

  const matchedMaterials = matchMaterialsWithMasterData(
    worksheet.materials,
    worksheet.orNumber,
    masterRequirements,
    uploadHistory,
    timestamp
  );

  return {
    id: worksheet.id,
    fileName: worksheet.fileName,
    orNumber: worksheet.orNumber,
    style: worksheet.style,
    target: worksheet.target,
    uploadedAt: worksheet.uploadedAt || timestamp,
    error: worksheet.error,
    matchedUploadId: latestUpload?.id || null,
    matchedUploadDate: latestUpload?.updateDate || null,
    matchedUploadTime: latestUpload?.uploadTime || null,
    matchedUploadCreatedAt: latestUpload?.createdAt || null,
    lastSyncedAt: timestamp,
    materials: matchedMaterials.map((m, idx) => ({
      id: worksheet.materials[idx]?.id || m.id || `wsm-${idx + 1}`,
      materialCode: worksheet.materials[idx]?.materialCode ?? m.materialCode,
      materialName: worksheet.materials[idx]?.materialName ?? m.materialName,
      unit: worksheet.materials[idx]?.unit ?? m.unit,
      total: worksheet.materials[idx]?.total ?? (m.total ?? 0),
      receivedQty: m.receivedQty,
      status: m.status,
      isFoundInMasterData: m.isFoundInMasterData,
      matchedUploadId: m.matchedUploadId,
      matchedUploadDate: m.matchedUploadDate,
      matchedUploadTime: m.matchedUploadTime,
      matchedUploadCreatedAt: m.matchedUploadCreatedAt,
      matchedAt: m.matchedAt,
    })),
  };
}

/**
 * User-triggered Refresh for saved schedule worksheets:
 * - Determines latest Excel upload independently per No. OR
 * - Updates ONLY `receivedQty`, `status`, `isFoundInMasterData`, and upload provenance metadata
 * - NEVER alters PDF source fields (materialCode, materialName, unit, total, orNumber, style, target, fileName)
 * - Clears to '-' (null) if a material is missing in the latest upload for that OR
 */
export function refreshScheduleWorksheetsSnapshot(
  worksheets: WorksheetPdfItem[],
  masterRequirements: MaterialItemRequirement[],
  uploadHistory: UploadHistoryItem[] = [],
  refreshTimestampIso?: string
): WorksheetPdfItem[] {
  const timestamp = refreshTimestampIso || new Date().toISOString();
  return worksheets.map((ws) => buildWorksheetSnapshot(ws, masterRequirements, uploadHistory, timestamp));
}

