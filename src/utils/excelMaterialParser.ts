import { Material, MaterialItemRequirement, MaterialUnit, MaterialCategory, OrStyleRelation } from '../types/ppic';

/**
 * Normalizes an object key by removing whitespace, underscores, hyphens, and slashes.
 */
function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[\s\-_/]/g, '');
}

/**
 * Safely finds a value in a row object by trying a list of normalized target keys.
 */
function getRowValue(row: Record<string, any>, targetKeys: string[]): any {
  const rowKeys = Object.keys(row);
  const normalizedMap = new Map<string, string>();
  for (const k of rowKeys) {
    normalizedMap.set(normalizeKey(k), k);
  }

  for (const target of targetKeys) {
    const normTarget = normalizeKey(target);
    const actualKey = normalizedMap.get(normTarget);
    if (actualKey !== undefined && row[actualKey] !== undefined && row[actualKey] !== null && String(row[actualKey]).trim() !== '') {
      return row[actualKey];
    }
  }

  // Fallback: substring match on row keys
  for (const target of targetKeys) {
    const normTarget = normalizeKey(target);
    for (const [normKey, actualKey] of normalizedMap.entries()) {
      if (normKey.includes(normTarget) && row[actualKey] !== undefined && row[actualKey] !== null) {
        return row[actualKey];
      }
    }
  }

  return undefined;
}

/**
 * Safely cleans and parses a numeric value. Never invents numbers.
 */
function parseNumberSafe(val: any, defaultVal = 0): number {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
  const cleaned = String(val).replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? defaultVal : num;
}

/**
 * Normalizes unit of measure to standard MaterialUnit.
 */
function normalizeUnit(val: any, fallbackUnit: MaterialUnit = 'Kg'): MaterialUnit {
  if (!val) return fallbackUnit;
  const str = String(val).trim().toLowerCase();
  if (str.includes('yard') || str === 'yd' || str === 'yds') return 'Yard';
  if (str.includes('meter') || str === 'm' || str === 'mtr') return 'Meter';
  if (str.includes('kg') || str.includes('kilo')) return 'Kg';
  if (str.includes('pc') || str.includes('buah') || str.includes('lembar')) return 'Pcs';
  if (str.includes('roll') || str.includes('rol')) return 'Roll';
  if (str.includes('drum')) return 'Drum';
  if (str.includes('box') || str.includes('karton') || str.includes('dus')) return 'Box';
  if (str.includes('liter') || str.includes('ltr') || str === 'l') return 'Liter';
  return fallbackUnit;
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

/**
 * Parses raw JSON rows from Excel and maps them precisely to PPIC Master Data Material and Requirements.
 * Fully conforms to:
 * - Order Lines/Product/Display Name (with Master Data reference fallback and [CODE] extraction)
 * - Order Lines/Quantity (Kebutuhan)
 * - Order Lines/Received Qty (Diterima)
 * - Order Lines/Product Unit of Measure/Display Name (Satuan)
 * - Relates each transaction line to Nomor OR and Style without combining separate rows.
 */
export function parseExcelRowsToMaterials(
  rawRows: any[],
  existingMaterials: Material[],
  defaultOrNumber: string,
  defaultStyle: string,
  updateDate?: string
): ParseExcelResult {
  const requirements: MaterialItemRequirement[] = [];
  const newMasterMaterialsMap = new Map<string, Material>();
  const relationsMap = new Map<string, OrStyleRelation>();

  const activeOrFallback = (defaultOrNumber || '').trim().toUpperCase() || 'OR-2026-UPLOAD';
  const activeStyleFallback = (defaultStyle || '').trim() || 'Custom Order Style';

  // Build lookup index of existing materials for fuzzy / reference matching
  const existingByCode = new Map<string, Material>();
  const existingByName = new Map<string, Material>();
  for (const m of existingMaterials) {
    existingByCode.set(m.code.toUpperCase(), m);
    existingByName.set(m.name.trim().toLowerCase(), m);
  }

  rawRows.forEach((row, idx) => {
    // 1. Identify Product Code & Name
    // User priority: 'Order Lines/Product/Display Name'
    const productRaw = getRowValue(row, [
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
    ]);

    const explicitCode = getRowValue(row, [
      'Order Lines/Product/Default Code',
      'Product/Default Code',
      'Kode Material',
      'Material Code',
      'Default Code',
      'Code',
    ]);

    let code = '';
    let name = '';
    let matchedMaterial: Material | undefined;

    if (explicitCode) {
      code = String(explicitCode).trim().toUpperCase();
    }

    if (productRaw) {
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

    // Use Master Data Material as reference to resolve inconsistent names/codes
    if (code && existingByCode.has(code)) {
      matchedMaterial = existingByCode.get(code);
    } else if (name) {
      const lowerName = name.trim().toLowerCase();
      if (existingByName.has(lowerName)) {
        matchedMaterial = existingByName.get(lowerName);
      } else {
        // Substring / partial match with existing Master Data Material
        for (const [existingName, m] of existingByName.entries()) {
          if (existingName.includes(lowerName) || lowerName.includes(existingName)) {
            matchedMaterial = m;
            break;
          }
        }
      }
    }

    if (matchedMaterial) {
      if (!code) code = matchedMaterial.code;
      if (!name) name = matchedMaterial.name;
    } else if (!code && name) {
      // Safe fallback code without hallucinating
      code = `RM-${name.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}-${String(idx + 1).padStart(3, '0')}`;
    } else if (!code && !name) {
      code = `RM-ROW-${String(idx + 1).padStart(3, '0')}`;
      name = `Material Item #${idx + 1}`;
    }

    // 2. Identify Kebutuhan (Quantity)
    // User priority: 'Order Lines/Quantity'
    const qtyVal = getRowValue(row, [
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
    ]);
    const requiredQty = parseNumberSafe(qtyVal, 0);

    // 3. Identify Diterima (Received Qty)
    // User priority: 'Order Lines/Received Qty'
    const receivedVal = getRowValue(row, [
      'Order Lines/Received Qty',
      'Order Lines/Qty Received',
      'Received Qty',
      'Qty Received',
      'Received',
      'Diterima',
      'Stok Diterima',
      'Jumlah Diterima',
    ]);
    const receivedQty = parseNumberSafe(receivedVal, 0);

    // 4. Identify Satuan (Product Unit of Measure)
    // User priority: 'Order Lines/Product Unit of Measure/Display Name'
    const uomVal = getRowValue(row, [
      'Order Lines/Product Unit of Measure/Display Name',
      'Product Unit of Measure/Display Name',
      'Order Lines/Product Unit of Measure',
      'Product Unit of Measure',
      'Unit of Measure/Display Name',
      'Unit of Measure',
      'UoM',
      'Satuan',
      'Unit',
    ]);
    const unit = normalizeUnit(uomVal, matchedMaterial?.unit || 'Kg');

    // 5. Identify Nomor OR & Style
    const rowOrVal = getRowValue(row, [
      'Order Lines/Order Reference',
      'Order Reference',
      'Nomor OR',
      'OR Number',
      'No. OR',
      'OR',
      'Reference',
      'Source Document',
    ]);
    const rowOr = rowOrVal ? String(rowOrVal).trim().toUpperCase() : activeOrFallback;

    const rowStyleVal = getRowValue(row, [
      'Order Lines/Style',
      'Style',
      'Model',
      'Nama Style',
      'Deskripsi Style',
    ]);
    const rowStyle = rowStyleVal ? String(rowStyleVal).trim() : activeStyleFallback;

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
    const unitPrice = matchedMaterial?.unitPrice || parseNumberSafe(getRowValue(row, ['Harga Satuan (IDR)', 'Price', 'Harga', 'Unit Price']), 25000);
    const supplierName = matchedMaterial?.supplierName || getRowValue(row, ['Supplier', 'Vendor', 'Pemasok']) || 'PT Mitra Material Utama';

    // 6. Build Distinct Transaction Line
    // "Jangan menggabungkan baris transaksi yang berbeda. Data Kebutuhan dan Diterima harus tetap tersimpan per baris transaksi."
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

    // 7. Build/Register Master Data Material (Unique per code)
    // "Hindari duplikasi data Master Data jika material yang sama sudah tersedia."
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
  const readyCount = requirements.filter((r) => (r.receivedQty - r.requiredQty) >= 0).length;
  const notReadyCount = requirements.filter((r) => (r.receivedQty - r.requiredQty) < 0).length;

  return {
    requirements,
    newMasterMaterials: Array.from(newMasterMaterialsMap.values()),
    relations: Array.from(relationsMap.values()),
    summary: {
      totalRows: rawRows.length,
      validRows: requirements.length,
      readyCount,
      notReadyCount,
      uniqueOrs,
      uniqueStyles,
    },
  };
}
