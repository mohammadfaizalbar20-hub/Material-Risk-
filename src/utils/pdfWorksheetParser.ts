import {
  MaterialItemRequirement,
  UploadHistoryItem,
  WorksheetMaterialItem,
  WorksheetPdfItem,
} from '../types/ppic';

export interface ExtractedWorksheetMaterial {
  materialCode: string;
  materialName: string;
  unit: string;
  total: number;
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
  style: string;
  target: number;
  materials: ExtractedWorksheetMaterial[];
  matchedMaterials?: WorksheetMaterialMatched[];
  error?: string;
  rawText?: string;
}

/**
 * Normalizes an OR Number to extract trailing digits/identifier
 * Example: 'OR/2026/09/1117' -> '1117'
 *          'OR/1117' -> '1117'
 *          '1117' -> '1117'
 */
export function extractOrNumberFromIdentifier(rawOr: string): string {
  if (!rawOr) return '';
  const trimmed = rawOr.trim();
  // Split by slash and take the last part
  const slashParts = trimmed.split('/');
  const lastPart = slashParts[slashParts.length - 1].trim();
  // If the last part has whitespace or extra text, grab the first token
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

  // Check if one ends with slash or dash followed by the other
  if (cleanA.endsWith('/' + cleanB) || cleanA.endsWith('-' + cleanB)) return true;
  if (cleanB.endsWith('/' + cleanA) || cleanB.endsWith('-' + cleanA)) return true;

  return false;
}

/**
 * Deterministic text parser for Garment/Manufacturing Worksheet PDFs
 * Extracts:
 * 1. No. OR (digits after last slash)
 * 2. Style
 * 3. Target Produksi (from Total Qty)
 * 4. MATERIAL & KONSUMSI table rows: CODE ACC, DESCRIPTION, UNIT, TOTAL
 */
export function parseWorksheetText(text: string, fileName: string = 'Worksheet.pdf'): {
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

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. Ekstraksi No. OR
  // Cari baris yang mengandung OR, No. OR, Order No, dsb. (tetapi bukan PO No atau Worksheet No)
  let rawOr = '';
  for (const line of lines) {
    // Avoid PO No or Worksheet No
    if (/P\.?O\.?\s*(?:NO|NUMBER)/i.test(line) && !/OR/i.test(line)) continue;
    if (/WORKSHEET\s*(?:NO|NUMBER)/i.test(line) && !/OR/i.test(line)) continue;

    // Pattern: NO. OR : OR/2026/09/1117 or OR : OR/2026/09/1117 or ORDER NO : OR/2026/09/1117
    const orMatch = line.match(/(?:(?:NO\.?\s*)?OR|(?:ORDER\s*(?:NO\.?|NUMBER)))\s*[:=]\s*([^\s\n\r,;]+)/i);
    if (orMatch && orMatch[1]) {
      rawOr = orMatch[1];
      break;
    }

    // Secondary pattern: explicit slash format like OR/2026/09/1117 anywhere in line
    const explicitOrSlash = line.match(/OR\/\d{4}\/\d{1,2}\/([A-Za-z0-9_-]+)/i);
    if (explicitOrSlash) {
      rawOr = explicitOrSlash[0];
      break;
    }
  }

  // Fallback pattern if not found with colon
  if (!rawOr) {
    for (const line of lines) {
      const matchSlash = line.match(/(?:OR|Order)[\s/]+([A-Za-z0-9_/\\-]+)/i);
      if (matchSlash && !/WORKSHEET|PO\s*NO/i.test(matchSlash[0])) {
        rawOr = matchSlash[1];
        break;
      }
    }
  }

  const orNumber = extractOrNumberFromIdentifier(rawOr);
  if (!orNumber) {
    return {
      success: false,
      error: `Informasi No. OR tidak ditemukan pada file ${fileName}. Pastikan dokumen memuat identitas No. OR.`,
    };
  }

  // 2. Ekstraksi Style
  let style = '';
  for (const line of lines) {
    const styleMatch = line.match(/STYLE(?:\s*(?:NAME|NO|DESC))?\s*[:=]\s*([^\n\r]+)/i);
    if (styleMatch && styleMatch[1]) {
      // Clean up if there is another label on the same line like "COLOR:" or "DATE:"
      const cleaned = styleMatch[1].split(/(?:COLOR|DATE|SEASON|BUYER|QTY|SIZE)\s*[:=]/i)[0].trim();
      if (cleaned) {
        style = cleaned;
        break;
      }
    }
  }

  if (!style) {
    // Secondary search for style
    for (const line of lines) {
      if (/^STYLE\s*[:=]?\s*(.+)$/i.test(line)) {
        style = line.replace(/^STYLE\s*[:=]?\s*/i, '').trim();
        break;
      }
    }
  }

  if (!style) {
    return {
      success: false,
      error: `Informasi Style tidak berhasil diekstrak dari file ${fileName}.`,
    };
  }

  // 3. Ekstraksi Target Produksi (dari Total Qty)
  let target = 0;
  for (const line of lines) {
    const qtyMatch = line.match(/TOTAL\s*(?:ORDER\s*)?QTY(?:\s*\(PCS\))?\s*[:=]?\s*([0-9.,]+)/i);
    if (qtyMatch && qtyMatch[1]) {
      const parsed = parseFloat(qtyMatch[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        target = parsed;
        break;
      }
    }

    // Alternate: QTY TOTAL : 74
    const altQty = line.match(/QTY\s*TOTAL\s*[:=]?\s*([0-9.,]+)/i);
    if (altQty && altQty[1]) {
      const parsed = parseFloat(altQty[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        target = parsed;
        break;
      }
    }
  }

  if (!target) {
    // Check if line contains just "TOTAL QTY" and next line is number
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^TOTAL\s*QTY$/i.test(lines[i])) {
        const nextNum = parseFloat(lines[i + 1].replace(/,/g, ''));
        if (!isNaN(nextNum) && nextNum > 0) {
          target = nextNum;
          break;
        }
      }
    }
  }

  if (!target || target <= 0) {
    return {
      success: false,
      error: `Informasi Total Qty (Target Produksi) tidak ditemukan pada file ${fileName}.`,
    };
  }

  // 4. Ekstraksi Tabel MATERIAL & KONSUMSI
  // Kolom: CODE ACC, DESCRIPTION, UNIT, TOTAL (Abaikan NO dan CONS)
  // Menjaga urutan baris, menjaga duplikat
  const materials: ExtractedWorksheetMaterial[] = [];

  // Cari index header tabel MATERIAL & KONSUMSI
  let tableStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase();
    if (line.includes('MATERIAL & KONSUMSI') || line.includes('MATERIAL DAN KONSUMSI') || (line.includes('CODE ACC') && line.includes('DESCRIPTION'))) {
      tableStartIndex = i;
      break;
    }
  }

  if (tableStartIndex === -1) {
    return {
      success: false,
      error: `Tabel MATERIAL & KONSUMSI tidak berhasil dibaca pada file ${fileName}.`,
    };
  }

  // Parse rows following the table header
  // Baris material biasanya berhenti saat ada footer seperti "CATATAN", "NOTES", "APPROVED BY", "TOTAL KEBUTUHAN", "HALAMAN", dsb.
  for (let i = tableStartIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // Check footer stop conditions
    if (
      upper.startsWith('CATATAN') ||
      upper.startsWith('NOTE') ||
      upper.startsWith('APPROVED') ||
      upper.startsWith('MENGETAHUI') ||
      upper.startsWith('DISETUJUI') ||
      upper.includes('PAGE ') ||
      upper.includes('HALAMAN ')
    ) {
      break;
    }

    // Skip the column header line itself if present
    if (upper.includes('CODE ACC') || upper.includes('DESCRIPTION') || upper.includes('CONS') || upper.includes('UNIT') || upper.includes('TOTAL')) {
      continue;
    }

    // Parse tabular row
    // Typical format:
    // [NO] CODE_ACC DESCRIPTION [CONS] UNIT TOTAL
    // Example: "1 ACC-BTN-01 BUTTON 4 HOLE NAVY 5.0 PCS 370"
    // Or tab/comma/pipe delimited or multi-space delimited
    const parsedRow = parseMaterialTableRow(line);
    if (parsedRow) {
      materials.push(parsedRow);
    }
  }

  if (materials.length === 0) {
    return {
      success: false,
      error: `Tabel MATERIAL & KONSUMSI pada file ${fileName} tidak memuat baris data material yang valid.`,
    };
  }

  return {
    success: true,
    data: {
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName,
      orNumber,
      style,
      target,
      materials,
      rawText: text,
    },
  };
}

/**
 * Parses a single material row from the Worksheet table
 * Expected columns: [NO] CODE_ACC DESCRIPTION [CONS] UNIT TOTAL
 */
export function parseMaterialTableRow(line: string): ExtractedWorksheetMaterial | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Split by tabs, pipe, or multiple spaces
  let tokens = trimmed.split(/\t+|\|+/).map((t) => t.trim()).filter(Boolean);

  // If only 1 token, attempt space-based splitting
  if (tokens.length <= 1) {
    tokens = trimmed.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
  }

  // If still 1 token, use regex matching
  if (tokens.length >= 4) {
    // If the first token is a row number like "1", "2", shift it
    if (/^\d+$/.test(tokens[0]) && tokens.length >= 5) {
      tokens.shift();
    }

    // Now tokens should ideally be: [CODE_ACC, DESCRIPTION, (CONS), UNIT, TOTAL]
    if (tokens.length === 4) {
      // [CODE_ACC, DESCRIPTION, UNIT, TOTAL]
      const totalNum = parseFloat(tokens[3].replace(/,/g, ''));
      if (!isNaN(totalNum)) {
        return {
          materialCode: tokens[0],
          materialName: tokens[1],
          unit: tokens[2],
          total: totalNum,
        };
      }
    } else if (tokens.length >= 5) {
      // Has CONS between description and unit or similar
      // Check last token as TOTAL, second to last as UNIT
      const totalNum = parseFloat(tokens[tokens.length - 1].replace(/,/g, ''));
      const unit = tokens[tokens.length - 2];
      const code = tokens[0];
      // Description is middle tokens joined
      const desc = tokens.slice(1, tokens.length - 2).filter((tok) => isNaN(Number(tok))).join(' ');

      if (!isNaN(totalNum) && code && desc && unit) {
        return {
          materialCode: code,
          materialName: desc,
          unit,
          total: totalNum,
        };
      }
    }
  }

  // Fallback regex for standard space-delimited table rows:
  // (Optional No.) (CodeACC) (Description with spaces) (Cons float/int) (Unit word) (Total float/int)
  // Example: "1 FAB-COT-30S KAIN COMBED 30S NAVY 1.25 YDS 92.5"
  // Example: "ACC-ZIP-01 ZIPPER 26 INCH 1 PCS 74"
  const rowRegex = /^(?:\d+\s+)?([A-Za-z0-9_-]+)\s+(.+?)\s+(?:[\d.,]+\s+)?([A-Za-z]{1,8})\s+([\d.,]+)$/;
  const match = trimmed.match(rowRegex);
  if (match) {
    const totalVal = parseFloat(match[4].replace(/,/g, ''));
    if (!isNaN(totalVal)) {
      return {
        materialCode: match[1].trim(),
        materialName: match[2].trim(),
        unit: match[3].trim(),
        total: totalVal,
      };
    }
  }

  return null;
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
      total: worksheet.materials[idx]?.total ?? m.total,
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

