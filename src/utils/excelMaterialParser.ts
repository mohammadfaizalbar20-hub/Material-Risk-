import { Material, MaterialItemRequirement, MaterialUnit, MaterialCategory, OrStyleRelation } from '../types/ppic';

export const EXCEL_SHEET_TO_JSON_OPTIONS = {
  defval: null,
  raw: true,
  blankrows: false,
} as const;

export type NumberLocaleHint = 'id' | 'us' | 'neutral';

/**
 * Normalizes an object key by removing whitespace, underscores, hyphens, slashes, dots, and parentheses.
 */
function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[\s\-_/.()]/g, '');
}

/**
 * Checks whether a raw Excel cell value is truly empty (undefined, null, or whitespace-only string).
 * Numeric 0 and string "0" are NOT empty.
 */
export function isExcelCellEmpty(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === 'number') return false;
  return String(val).trim() === '';
}

/**
 * Filters out rows where every cell is completely blank/null/whitespace.
 * Rows with at least one non-empty cell (including numeric 0 in Qty/Received) are retained.
 */
export function filterNonEmptyExcelRows(rawRows: any[]): any[] {
  if (!Array.isArray(rawRows)) return [];
  return rawRows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    return Object.values(row).some((v) => !isExcelCellEmpty(v));
  });
}

/**
 * Safely finds a value in a row object by trying a list of normalized target keys.
 * If any exact alias column exists on the row, returns its value (even if empty) instead of
 * falling through to substring matching an unrelated column (e.g. Received Qty leaking into blank Quantity).
 */
function getRowValue(
  row: Record<string, any>,
  targetKeys: string[],
  excludeSubstrings: string[] = []
): any {
  const rowKeys = Object.keys(row);
  const normalizedMap = new Map<string, string>();
  for (const k of rowKeys) {
    normalizedMap.set(normalizeKey(k), k);
  }

  let matchedExactHeader = false;
  for (const target of targetKeys) {
    const normTarget = normalizeKey(target);
    const actualKey = normalizedMap.get(normTarget);
    if (actualKey !== undefined) {
      matchedExactHeader = true;
      const cellVal = row[actualKey];
      if (!isExcelCellEmpty(cellVal)) {
        return cellVal;
      }
    }
  }

  // If the spreadsheet explicitly contains one of the exact expected column headers
  // and its cell is blank for this row, keep it blank rather than stealing from another column.
  if (matchedExactHeader) {
    return undefined;
  }

  // Restricted fallback: substring match only when no exact header exists on the sheet
  for (const target of targetKeys) {
    const normTarget = normalizeKey(target);
    for (const [normKey, actualKey] of normalizedMap.entries()) {
      if (excludeSubstrings.some((ex) => normKey.includes(ex))) {
        continue;
      }
      if (normKey.includes(normTarget) && !isExcelCellEmpty(row[actualKey])) {
        return row[actualKey];
      }
    }
  }

  return undefined;
}

/**
 * Cleans IEEE-754 floating-point noise while preserving exact decimal digits.
 */
export function cleanFloatPrecision(num: number): number {
  if (!Number.isFinite(num)) return 0;
  if (Math.abs(num) < 1e-12) return 0;
  return Number(num.toPrecision(12));
}

/**
 * Formats numbers for Indonesian UI display without truncating 4+ decimal digits.
 * Default toLocaleString('id-ID') rounds to 3 decimal places; this preserves up to 10 decimal places.
 */
export function formatPpicNumber(val: number | null | undefined, maxDecimals = 10): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '0';
  const normalized = Math.abs(val) < 1e-12 ? 0 : Number(val.toFixed(maxDecimals));
  return normalized.toLocaleString('id-ID', { maximumFractionDigits: maxDecimals });
}

/**
 * Parses numeric values from Excel cells or localized numeric strings:
 * - Native numbers: preserved at full precision (0 stays 0)
 * - "104,9160" -> 104.916
 * - "2.498,0000" -> 2498
 * - "2,498.0000" -> 2498
 * - Empty / null / undefined -> { value: defaultVal, isEmpty: true, isValid: true }
 */
export function parseExcelNumberDetailed(
  val: unknown,
  defaultVal = 0,
  localeHint: NumberLocaleHint = 'neutral'
): { value: number; isEmpty: boolean; isValid: boolean } {
  if (isExcelCellEmpty(val)) {
    return { value: defaultVal, isEmpty: true, isValid: true };
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      return { value: defaultVal, isEmpty: false, isValid: false };
    }
    return { value: cleanFloatPrecision(val), isEmpty: false, isValid: true };
  }

  const trimmed = String(val).replace(/\u00A0/g, ' ').trim();
  const compact = trimmed.replace(/\s+/g, '');

  // Scientific notation support (e.g. "1.25e-4")
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(compact)) {
    const sci = Number(compact);
    if (Number.isFinite(sci)) {
      return { value: cleanFloatPrecision(sci), isEmpty: false, isValid: true };
    }
    return { value: defaultVal, isEmpty: false, isValid: false };
  }

  if (!/^[+-]?[\d.,]+$/.test(compact)) {
    return { value: defaultVal, isEmpty: false, isValid: false };
  }

  const sign = compact.startsWith('-') ? -1 : 1;
  const body = compact.replace(/^[+-]/, '');

  if (!/\d/.test(body)) {
    return { value: defaultVal, isEmpty: false, isValid: false };
  }

  const dotCount = (body.match(/\./g) || []).length;
  const commaCount = (body.match(/,/g) || []).length;

  let normalizedStr = body;

  if (dotCount > 0 && commaCount > 0) {
    // Both "." and "," exist: the last separator is the decimal separator
    const lastDot = body.lastIndexOf('.');
    const lastComma = body.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Indonesian / European: e.g. "2.498,0000"
      normalizedStr = body.replace(/\./g, '').replace(',', '.');
    } else {
      // US / International: e.g. "2,498.0000"
      normalizedStr = body.replace(/,/g, '');
    }
  } else if (commaCount > 1) {
    // Multiple commas only: thousands separators (e.g. "1,234,567")
    normalizedStr = body.replace(/,/g, '');
  } else if (dotCount > 1) {
    // Multiple dots only: Indonesian thousands separators (e.g. "1.234.567")
    normalizedStr = body.replace(/\./g, '');
  } else if (commaCount === 1) {
    // Single comma, no dot
    const [intPart, fracPart] = body.split(',');
    if (
      intPart === '0' ||
      intPart === '' ||
      fracPart.length !== 3 ||
      intPart.length > 3 ||
      localeHint === 'id'
    ) {
      // Decimal comma: "104,9160", "12,5", "0,500", "1234,567"
      normalizedStr = `${intPart || '0'}.${fracPart}`;
    } else {
      // Exact 1..3 digits before comma and 3 digits after comma (e.g. "2,500") in neutral/US mode
      normalizedStr = `${intPart}${fracPart}`;
    }
  } else if (dotCount === 1) {
    const [intPart, fracPart] = body.split('.');
    if (localeHint === 'id' && intPart.length >= 1 && intPart.length <= 3 && intPart !== '0' && fracPart.length === 3) {
      // Unambiguous Indonesian sheet where dot is strictly thousands separator
      normalizedStr = `${intPart}${fracPart}`;
    } else {
      // Standard decimal dot: "104.9160", "12.5", "0.500", "2.498"
      normalizedStr = `${intPart || '0'}.${fracPart}`;
    }
  }

  const parsed = Number(normalizedStr);
  if (!Number.isFinite(parsed)) {
    return { value: defaultVal, isEmpty: false, isValid: false };
  }

  const signed = parsed === 0 ? 0 : sign * parsed;
  return { value: cleanFloatPrecision(signed), isEmpty: false, isValid: true };
}

/**
 * Safely cleans and parses a numeric value. Never invents numbers.
 */
export function parseNumberSafe(
  val: unknown,
  defaultVal = 0,
  localeHint: NumberLocaleHint = 'neutral'
): number {
  return parseExcelNumberDetailed(val, defaultVal, localeHint).value;
}

/**
 * Detects dominant number formatting locale across string cells in a worksheet
 * so ambiguous strings like "2,500" follow the sheet's actual convention.
 */
function detectSheetNumberLocale(samples: unknown[]): NumberLocaleHint {
  let idScore = 0;
  let usScore = 0;
  for (const val of samples) {
    if (typeof val !== 'string') continue;
    const compact = val.replace(/[\s\u00A0]+/g, '').replace(/^[+-]/, '');
    if (!compact || !/[\d]/.test(compact)) continue;
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

/**
 * Preserves the exact trimmed Unit of Measure string from Excel without any
 * conversion, case modification, translation, or fallback default to 'Kg'.
 * Empty cells remain '' explicitly.
 */
export function preserveSourceUnit(val: unknown): MaterialUnit {
  if (isExcelCellEmpty(val)) return '';
  return String(val).trim();
}

/**
 * Infers category from material code and name.
 */
function inferCategory(code: string, name: string): MaterialCategory {
  const combined = `${code} ${name}`.toUpperCase();
  if (combined.includes('FAB-') || combined.includes('KAIN') || combined.includes('COTTON') || combined.includes('TASLAN') || combined.includes('FLEECE') || combined.includes('DRILL') || combined.includes('RAW')) {
    return 'Raw Material';
  }
  if (combined.includes('PKG-') || combined.includes('BOX') || combined.includes('CARTON') || combined.includes('PLASTIK') || combined.includes('BOTOL') || combined.includes('CAP') || combined.includes('ZIPPER') || combined.includes('LABEL') || combined.includes('HANGTAG')) {
    return 'Packaging';
  }
  if (combined.includes('CHM-') || combined.includes('CHEMICAL') || combined.includes('PEWARNA') || combined.includes('DYE') || combined.includes('RESIN') || combined.includes('SLS') || combined.includes('OIL')) {
    return 'Chemical';
  }
  return 'Auxiliary';
}

export interface ParseExcelResult {
  requirements: MaterialItemRequirement[];
  newMasterMaterials: Material[];
  relations: OrStyleRelation[];
  summary: {
    totalRows: number;
    validRows: number;
    readyCount: number;
    notReadyCount: number;
    uniqueOrs: string[];
    uniqueStyles: string[];
  };
}

const PRODUCT_NAME_TARGETS = [
  'Order Lines/Product/Display Name',
  'Product/Display Name',
  'Order Lines/Product',
  'Display Name',
  'Product Name',
  'Product',
  'Nama Material',
  'Deskripsi Material',
  'Material Name',
  'Material',
  'Item',
];
const PRODUCT_NAME_EXCLUDES = [
  'uom',
  'unitofmeasure',
  'satuan',
  'unitprice',
  'price',
  'harga',
  'defaultcode',
  'kode',
  'code',
  'qty',
  'quantity',
  'received',
  'diterima',
  'kebutuhan',
];

const EXPLICIT_CODE_TARGETS = [
  'Order Lines/Product/Default Code',
  'Product/Default Code',
  'Kode Material',
  'Material Code',
  'Default Code',
  'Code',
];
const EXPLICIT_CODE_EXCLUDES = [
  'ornumber',
  'orderreference',
  'displayname',
  'materialname',
  'namamaterial',
  'uom',
  'unit',
  'satuan',
  'qty',
  'quantity',
  'received',
  'price',
  'harga',
];

const QTY_TARGETS = [
  'Order Lines/Quantity',
  'Order Lines/Qty',
  'Quantity',
  'Qty',
  'Kebutuhan',
  'Alokasi SPK',
  'Allocated',
  'Order Qty',
  'Demand',
  'Jumlah Kebutuhan',
];
const QTY_EXCLUDES = [
  'received',
  'diterima',
  'price',
  'harga',
  'unit',
  'uom',
  'satuan',
  'code',
  'kode',
  'name',
  'nama',
];

const RECEIVED_QTY_TARGETS = [
  'Order Lines/Received Qty',
  'Order Lines/Qty Received',
  'Received Qty',
  'Qty Received',
  'Received',
  'Diterima',
  'Stok Diterima',
  'Jumlah Diterima',
];
const RECEIVED_QTY_EXCLUDES = [
  'required',
  'kebutuhan',
  'demand',
  'alokasi',
  'allocat',
  'orderqty',
  'price',
  'harga',
  'unit',
  'uom',
  'satuan',
  'code',
  'kode',
  'name',
  'nama',
];

const UOM_TARGETS = [
  'Order Lines/Product Unit of Measure/Display Name',
  'Product Unit of Measure/Display Name',
  'Order Lines/Product Unit of Measure',
  'Product Unit of Measure',
  'Unit of Measure/Display Name',
  'Unit of Measure',
  'Satuan (UoM)',
  'Unit (UoM)',
  'UoM',
  'Satuan',
  'Unit',
];
const UOM_EXCLUDES = [
  'unitprice',
  'price',
  'harga',
  'qty',
  'quantity',
  'received',
  'diterima',
  'kebutuhan',
  'defaultcode',
  'materialname',
  'namamaterial',
];

/**
 * Parses raw JSON rows from Excel and maps them precisely to PPIC Master Data Material and Requirements.
 * Fully conforms to:
 * - Order Lines/Product/Display Name (with exact Master Data reference fallback and [CODE] extraction)
 * - Order Lines/Quantity (Kebutuhan)
 * - Order Lines/Received Qty (Diterima)
 * - Order Lines/Product Unit of Measure/Display Name (Satuan — preserved verbatim)
 * - Relates each transaction line to Nomor OR and Style without combining separate rows.
 */
export function parseExcelRowsToMaterials(
  rawRows: any[],
  existingMaterials: Material[],
  defaultOrNumber: string,
  defaultStyle: string,
  updateDate?: string
): ParseExcelResult {
  const nonEmptyRows = filterNonEmptyExcelRows(rawRows);
  const requirements: MaterialItemRequirement[] = [];
  const newMasterMaterialsMap = new Map<string, Material>();
  const relationsMap = new Map<string, OrStyleRelation>();

  const activeOrFallback = (defaultOrNumber || '').trim().toUpperCase() || 'OR-2026-UPLOAD';
  const activeStyleFallback = (defaultStyle || '').trim() || 'Custom Order Style';

  // Detect sheet number locale hint across numeric columns
  const numericSamples: unknown[] = [];
  for (const r of nonEmptyRows) {
    numericSamples.push(
      getRowValue(r, QTY_TARGETS, QTY_EXCLUDES),
      getRowValue(r, RECEIVED_QTY_TARGETS, RECEIVED_QTY_EXCLUDES)
    );
  }
  const sheetLocaleHint = detectSheetNumberLocale(numericSamples);

  // Build exact lookup index of existing materials for fallback reference only
  // (never used to overwrite explicit Excel code, name, or unit).
  const existingByCode = new Map<string, Material>();
  const existingByName = new Map<string, Material>();
  for (const m of existingMaterials) {
    existingByCode.set(m.code.trim().toUpperCase(), m);
    existingByName.set(m.name.trim().toLowerCase(), m);
  }

  nonEmptyRows.forEach((row, idx) => {
    // 1. Identify Product Code & Name
    const productRaw = getRowValue(row, PRODUCT_NAME_TARGETS, PRODUCT_NAME_EXCLUDES);
    const explicitCode = getRowValue(row, EXPLICIT_CODE_TARGETS, EXPLICIT_CODE_EXCLUDES);

    let code = '';
    let name = '';
    let matchedMaterial: Material | undefined;

    if (!isExcelCellEmpty(explicitCode)) {
      code = String(explicitCode).trim().toUpperCase();
    }

    if (!isExcelCellEmpty(productRaw)) {
      const pStr = String(productRaw).trim();
      // Check for [CODE] Name pattern commonly generated by ERP like Odoo: e.g. "[RM-TAS-01] Kain Taslan Navy"
      const bracketMatch = pStr.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (bracketMatch) {
        if (!code) code = bracketMatch[1].trim().toUpperCase();
        name = bracketMatch[2].trim() || bracketMatch[1].trim();
      } else {
        name = pStr;
      }
    }

    // Use exact Master Data lookup only for missing fields / metadata (category, supplier, price)
    if (code && existingByCode.has(code)) {
      matchedMaterial = existingByCode.get(code);
    } else if (name) {
      const lowerName = name.trim().toLowerCase();
      if (existingByName.has(lowerName)) {
        matchedMaterial = existingByName.get(lowerName);
      }
    }

    if (matchedMaterial) {
      if (!code) code = matchedMaterial.code;
      if (!name) name = matchedMaterial.name;
    } else if (!code && name) {
      code = `RM-${name.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}-${String(idx + 1).padStart(3, '0')}`;
    } else if (!code && !name) {
      code = `RM-ROW-${String(idx + 1).padStart(3, '0')}`;
      name = `Material Item #${idx + 1}`;
    }

    // 2. Identify Kebutuhan (Quantity)
    const qtyVal = getRowValue(row, QTY_TARGETS, QTY_EXCLUDES);
    const requiredQty = parseNumberSafe(qtyVal, 0, sheetLocaleHint);

    // 3. Identify Diterima (Received Qty)
    const receivedVal = getRowValue(row, RECEIVED_QTY_TARGETS, RECEIVED_QTY_EXCLUDES);
    const receivedQty = parseNumberSafe(receivedVal, 0, sheetLocaleHint);

    // 4. Identify Satuan (Product Unit of Measure) — verbatim preservation, NO fallback to 'Kg'
    const uomVal = getRowValue(row, UOM_TARGETS, UOM_EXCLUDES);
    const unit = preserveSourceUnit(uomVal);

    // 5. Identify Nomor OR & Style (Manual input only; Excel PO never treated as OR)
    const rowOr = (defaultOrNumber || '').trim().toUpperCase() || activeOrFallback;
    const rowStyle = (defaultStyle || '').trim() || (rowOr ? `Style ${rowOr}` : activeStyleFallback);

    // Track OR <-> Style relation
    const relKey = `${rowOr}__${rowStyle.toLowerCase()}`;
    if (!relationsMap.has(relKey)) {
      relationsMap.set(relKey, {
        id: `rel-${Date.now()}-${idx}`,
        orNumber: rowOr,
        style: rowStyle,
        createdAt: new Date().toISOString().slice(0, 10),
      });
    }

    const category = matchedMaterial?.category || inferCategory(code, name);
    const parsedPrice = parseExcelNumberDetailed(
      getRowValue(row, ['Harga Satuan (IDR)', 'Price', 'Harga', 'Unit Price'], ['qty', 'quantity', 'received']),
      25000,
      sheetLocaleHint
    );
    const unitPrice = matchedMaterial?.unitPrice ?? (parsedPrice.isEmpty ? 25000 : parsedPrice.value);
    const supplierRaw = getRowValue(row, ['Supplier', 'Vendor', 'Pemasok']);
    const supplierName = matchedMaterial?.supplierName || (!isExcelCellEmpty(supplierRaw) ? String(supplierRaw).trim() : 'PT Mitra Material Utama');

    // 6. Build Distinct Transaction Line (never merge separate rows)
    const reqItem: MaterialItemRequirement = {
      id: `req-imp-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
      orNumber: rowOr,
      style: rowStyle,
      materialCode: code,
      materialName: name,
      category,
      unit,
      requiredQty,
      receivedQty,
      unitPrice,
      supplierName,
      isRecentlyImported: true,
      importedAt: new Date().toISOString(),
      updateDate: updateDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
    };
    requirements.push(reqItem);

    // 7. Build/Register Master Data Material catalog entry (Unique per code)
    if (!existingByCode.has(code) && !newMasterMaterialsMap.has(code)) {
      newMasterMaterialsMap.set(code, {
        id: `mat-${Date.now()}-${idx}`,
        code,
        name,
        category,
        unit,
        totalStock: receivedQty,
        allocatedStock: requiredQty,
        safetyStock: Math.round(requiredQty * 0.2),
        leadTimeDays: 7,
        supplierName,
        defaultWarehouse: 'WH-01',
        unitPrice,
        minOrderQty: 100,
      });
    }
  });

  const uniqueOrs = Array.from(new Set(requirements.map((r) => r.orNumber)));
  const uniqueStyles = Array.from(new Set(requirements.map((r) => r.style)));
  const readyCount = requirements.filter((r) => cleanFloatPrecision(r.receivedQty - r.requiredQty) >= 0).length;
  const notReadyCount = requirements.filter((r) => cleanFloatPrecision(r.receivedQty - r.requiredQty) < 0).length;

  return {
    requirements,
    newMasterMaterials: Array.from(newMasterMaterialsMap.values()),
    relations: Array.from(relationsMap.values()),
    summary: {
      totalRows: nonEmptyRows.length,
      validRows: requirements.length,
      readyCount,
      notReadyCount,
      uniqueOrs,
      uniqueStyles,
    },
  };
}
