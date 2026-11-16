import { MaterialItemRequirement } from '../types/ppic';
import { cleanFloatPrecision } from './excelMaterialParser';

export interface AllMaterialsComparisonItem {
  id?: string;
  orNumber?: string;
  style?: string;
  updateDate?: string;
  materialCode: string;
  materialName: string;
  category: string;
  unit: string;
  totalRequired: number;
  totalReceived: number;
  balance: number;
  fulfillmentPercent: number;
  isReady: boolean;
}

export interface AllMaterialsComparisonData {
  totalRows: number;
  totalUniqueMaterials: number;
  pagesLoaded: number;
  items: AllMaterialsComparisonItem[];
}

export interface AllParetoMitigationItem {
  id?: string;
  orNumber?: string;
  style?: string;
  updateDate?: string;
  rank: number;
  materialCode: string;
  materialName: string;
  unit: string;
  totalRequired: number;
  totalReceived: number;
  shortageQty: number;
  shortageValue: number;
  contributionPercent: number;
  cumulativePercent: number;
  mitigationPriority: string;
}

export interface AllParetoMitigationData {
  totalDeficitMaterials: number;
  totalDeficitRows: number;
  pagesLoaded: number;
  grandTotalShortageQty: number;
  grandTotalShortageValue: number;
  items: AllParetoMitigationItem[];
}

export interface DashboardDrilldownFilterParams {
  orQuery?: string;
  uploadDate?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

function safeNumeric(val: unknown): number {
  if (val === undefined || val === null || val === '') return 0;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? cleanFloatPrecision(parsed) : 0;
}

export function toJakartaDateStr(dateVal?: string | Date | null): string {
  if (!dateVal) return '';
  const d = typeof dateVal === 'string' ? new Date(dateVal) : dateVal;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function mapRawDbRequirementToModel(row: any): MaterialItemRequirement {
  return {
    id: String(row.id || ''),
    uploadId: row.upload_id || undefined,
    orNumber: String(row.or_number || ''),
    style: String(row.style || ''),
    materialCode: String(row.material_code || ''),
    materialName: String(row.material_name || ''),
    category: row.category || 'Raw Material',
    unit: row.unit !== undefined && row.unit !== null ? String(row.unit) : '',
    requiredQty: safeNumeric(row.required_qty),
    receivedQty: safeNumeric(row.received_qty),
    unitPrice: safeNumeric(row.unit_price),
    supplierName: row.supplier_name || undefined,
    updateDate: row.update_date || undefined,
    importedAt: row.imported_at || undefined,
    createdAt: row.created_at || undefined,
  };
}

/**
 * Normalizes any YYYY-MM-DD / ISO date string into YYYY-MM-DD without falling back to today
 * unless needed; returns null if empty.
 */
function normalizeOptionalIsoDate(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return toJakartaDateStr(d);
  return null;
}

/**
 * Filters material requirement rows for Dashboard drilldowns without merging or dropping distinct rows.
 */
export function filterRequirementsForDrilldown(
  requirements: MaterialItemRequirement[],
  params?: DashboardDrilldownFilterParams & { uploadDateByUploadId?: Map<string, string> }
): MaterialItemRequirement[] {
  const cleanOr = (params?.orQuery || '').trim().toLowerCase();
  const targetUploadDate = normalizeOptionalIsoDate(params?.uploadDate);
  const dateFrom = normalizeOptionalIsoDate(params?.dateFrom);
  const dateTo = normalizeOptionalIsoDate(params?.dateTo);
  const uploadDateMap = params?.uploadDateByUploadId;

  return requirements.filter((req) => {
    if (cleanOr) {
      const orMatch = (req.orNumber || '').toLowerCase().includes(cleanOr);
      const styleMatch = (req.style || '').toLowerCase().includes(cleanOr);
      if (!orMatch && !styleMatch) return false;
    }

    if (targetUploadDate) {
      const effectiveDate =
        (req.uploadId && uploadDateMap?.get(req.uploadId)) ||
        toJakartaDateStr(req.createdAt || req.importedAt);
      if (effectiveDate !== targetUploadDate) return false;
    }

    if (dateFrom && req.updateDate && req.updateDate < dateFrom) return false;
    if (dateTo && req.updateDate && req.updateDate > dateTo) return false;

    return true;
  });
}

/**
 * Builds complete per-row comparison list (Kebutuhan vs Diterima) without merging distinct rows
 * that share the same materialCode.
 * Preserves PPIC formula: Kekurangan = Diterima - Kebutuhan; READY if >= 0, BELUM READY if < 0.
 */
export function buildAllMaterialsComparisonData(
  requirements: MaterialItemRequirement[],
  pagesLoaded = 1
): AllMaterialsComparisonData {
  // Deduplicate strictly by unique row ID (never by materialCode)
  const seenIds = new Set<string>();
  const uniqueRows: Array<{ row: MaterialItemRequirement; rowKey: string }> = [];

  requirements.forEach((row, idx) => {
    const key = row.id && String(row.id).trim() ? String(row.id).trim() : `row-${idx}`;
    if (seenIds.has(key)) return;
    seenIds.add(key);
    uniqueRows.push({ row, rowKey: key });
  });

  const items: AllMaterialsComparisonItem[] = uniqueRows.map(({ row, rowKey }) => {
    const totalRequired = cleanFloatPrecision(Number(row.requiredQty) || 0);
    const totalReceived = cleanFloatPrecision(Number(row.receivedQty) || 0);
    const balance = cleanFloatPrecision(totalReceived - totalRequired);
    const isReady = balance >= 0;
    const rawPercent =
      totalRequired > 0
        ? (totalReceived / totalRequired) * 100
        : totalReceived >= 0
        ? 100
        : 0;
    const fulfillmentPercent = Math.round(rawPercent * 10) / 10;

    return {
      id: rowKey,
      orNumber: row.orNumber || '',
      style: row.style || '',
      updateDate: row.updateDate || '',
      materialCode: String(row.materialCode || ''),
      materialName: String(row.materialName || ''),
      category: String(row.category || 'Raw Material'),
      unit: row.unit !== undefined && row.unit !== null ? String(row.unit) : '',
      totalRequired,
      totalReceived,
      balance,
      fulfillmentPercent,
      isReady,
    };
  });

  // Sort deterministically by largest requirement descending, then code, then row ID
  items.sort(
    (a, b) =>
      b.totalRequired - a.totalRequired ||
      a.materialCode.localeCompare(b.materialCode) ||
      String(a.id || '').localeCompare(String(b.id || ''))
  );

  const uniqueMaterialCodes = new Set(
    items.map((it) => it.materialCode.trim().toUpperCase()).filter(Boolean)
  );

  return {
    totalRows: items.length,
    totalUniqueMaterials: uniqueMaterialCodes.size,
    pagesLoaded,
    items,
  };
}

/**
 * Builds complete per-row Pareto & Mitigation Priority dataset for all deficit rows
 * (shortageQty = requiredQty - receivedQty > 0) without merging distinct rows or applying Top-N caps.
 */
export function buildAllParetoMitigationData(
  requirements: MaterialItemRequirement[],
  pagesLoaded = 1
): AllParetoMitigationData {
  // Deduplicate strictly by unique row ID (never by materialCode)
  const seenIds = new Set<string>();
  const deficitEntries: Array<{
    rowKey: string;
    orNumber: string;
    style: string;
    updateDate: string;
    materialCode: string;
    materialName: string;
    unit: string;
    totalRequired: number;
    totalReceived: number;
    shortageQty: number;
    shortageValue: number;
  }> = [];

  requirements.forEach((row, idx) => {
    const key = row.id && String(row.id).trim() ? String(row.id).trim() : `row-${idx}`;
    if (seenIds.has(key)) return;
    seenIds.add(key);

    const totalRequired = cleanFloatPrecision(Number(row.requiredQty) || 0);
    const totalReceived = cleanFloatPrecision(Number(row.receivedQty) || 0);
    const kekurangan = cleanFloatPrecision(totalReceived - totalRequired);
    if (kekurangan >= 0) return; // Only deficit rows (BELUM READY)

    const shortageQty = cleanFloatPrecision(Math.abs(kekurangan));
    const unitPrice = row.unitPrice && Number(row.unitPrice) > 0 ? Number(row.unitPrice) : 25000;
    const shortageValue = Math.round(shortageQty * unitPrice);

    deficitEntries.push({
      rowKey: key,
      orNumber: row.orNumber || '',
      style: row.style || '',
      updateDate: row.updateDate || '',
      materialCode: String(row.materialCode || ''),
      materialName: String(row.materialName || ''),
      unit: row.unit !== undefined && row.unit !== null ? String(row.unit) : '',
      totalRequired,
      totalReceived,
      shortageQty,
      shortageValue,
    });
  });

  // Sort descending by shortageValue, then shortageQty, then materialCode, then rowKey
  deficitEntries.sort(
    (a, b) =>
      b.shortageValue - a.shortageValue ||
      b.shortageQty - a.shortageQty ||
      a.materialCode.localeCompare(b.materialCode) ||
      a.rowKey.localeCompare(b.rowKey)
  );

  const grandTotalShortageQty = cleanFloatPrecision(
    deficitEntries.reduce((sum, it) => sum + it.shortageQty, 0)
  );
  const grandTotalShortageValue = deficitEntries.reduce((sum, it) => sum + it.shortageValue, 0);

  let cumulativeVal = 0;
  const items: AllParetoMitigationItem[] = deficitEntries.map((entry, idx) => {
    cumulativeVal += entry.shortageValue;
    const contributionPercent =
      grandTotalShortageValue > 0
        ? Math.round(((entry.shortageValue / grandTotalShortageValue) * 100) * 10) / 10
        : 0;
    const cumulativePercent =
      grandTotalShortageValue > 0
        ? Math.min(100, Math.round(((cumulativeVal / grandTotalShortageValue) * 100) * 10) / 10)
        : 100;

    return {
      id: entry.rowKey,
      orNumber: entry.orNumber,
      style: entry.style,
      updateDate: entry.updateDate,
      rank: idx + 1,
      materialCode: entry.materialCode,
      materialName: entry.materialName,
      unit: entry.unit,
      totalRequired: entry.totalRequired,
      totalReceived: entry.totalReceived,
      shortageQty: entry.shortageQty,
      shortageValue: entry.shortageValue,
      contributionPercent,
      cumulativePercent,
      mitigationPriority: cumulativePercent <= 80 ? 'VITAL FEW (Prioritas 1)' : 'SECONDARY',
    };
  });

  return {
    totalDeficitMaterials: items.length,
    totalDeficitRows: items.length,
    pagesLoaded,
    grandTotalShortageQty,
    grandTotalShortageValue,
    items,
  };
}

/**
 * Sanitizes free-text query for safe use inside PostgREST .or() filter expressions.
 */
function sanitizePostgrestOrTerm(raw: string): string {
  return raw.replace(/["\\(),]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Paginates any Supabase table query using deterministic ordering until ALL matching rows
 * are retrieved (handles PostgREST max_rows ceilings regardless of whether server cap is 50, 100, or 1000).
 */
export async function fetchAllPagedRowsFromQuery<T = any>(
  buildQuery: () => any,
  chunkSize = 1000
): Promise<{ rows: T[]; pagesLoaded: number }> {
  const collected: T[] = [];
  let from = 0;
  let pagesLoaded = 0;
  const maxPages = 10000;

  while (pagesLoaded < maxPages) {
    const to = from + chunkSize - 1;
    const { data, count, error } = await buildQuery().range(from, to);

    if (error) {
      throw error;
    }

    pagesLoaded += 1;
    const batch = Array.isArray(data) ? (data as T[]) : [];
    if (batch.length === 0) {
      break;
    }

    collected.push(...batch);
    from += batch.length;

    if (typeof count === 'number') {
      if (from >= count) {
        break;
      }
    } else if (batch.length < chunkSize) {
      break;
    }
  }

  return { rows: collected, pagesLoaded };
}

/**
 * Fetches ALL matching material_requirements rows from Supabase across all pages
 * (no hidden LIMIT, no 1000-row cap, no GROUP BY merging) for Dashboard drilldowns.
 */
export async function fetchAllDrilldownRequirementsFromSupabaseClient(
  supabase: any,
  params?: DashboardDrilldownFilterParams,
  chunkSize = 1000
): Promise<{
  requirements: MaterialItemRequirement[];
  pagesLoaded: number;
}> {
  const cleanOr = params?.orQuery ? sanitizePostgrestOrTerm(params.orQuery) : '';
  const targetUploadDate = normalizeOptionalIsoDate(params?.uploadDate);
  const dateFrom = normalizeOptionalIsoDate(params?.dateFrom);
  const dateTo = normalizeOptionalIsoDate(params?.dateTo);

  const applyCommonFilters = (query: any) => {
    let q = query;
    if (cleanOr) {
      q = q.or(`or_number.ilike.%${cleanOr}%,style.ilike.%${cleanOr}%`);
    }
    if (dateFrom) {
      q = q.gte('update_date', dateFrom);
    }
    if (dateTo) {
      q = q.lte('update_date', dateTo);
    }
    return q;
  };

  const dedupMap = new Map<string, MaterialItemRequirement>();
  let totalPagesLoaded = 0;

  if (!targetUploadDate) {
    const { rows, pagesLoaded } = await fetchAllPagedRowsFromQuery<any>(
      () =>
        applyCommonFilters(
          supabase
            .from('material_requirements')
            .select('*', { count: 'exact' })
        )
          .order('created_at', { ascending: false })
          .order('id', { ascending: true }),
      chunkSize
    );
    totalPagesLoaded += pagesLoaded;

    for (const raw of rows) {
      const model = mapRawDbRequirementToModel(raw);
      dedupMap.set(model.id, model);
    }
  } else {
    // Replicate authoritative Asia/Jakarta WIB timestamp boundary:
    // COALESCE(upload_history.created_at, material_requirements.created_at) between [00:00:00+07, 23:59:59.999+07]
    const startIso = new Date(`${targetUploadDate}T00:00:00+07:00`).toISOString();
    const endIso = new Date(`${targetUploadDate}T23:59:59.999+07:00`).toISOString();

    const { rows: uploadRows } = await fetchAllPagedRowsFromQuery<{ id: string }>(
      () =>
        supabase
          .from('upload_history')
          .select('id', { count: 'exact' })
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true }),
      chunkSize
    );

    const matchingUploadIds = Array.from(
      new Set(uploadRows.map((u) => u.id).filter(Boolean))
    );

    // Fetch material_requirements linked to matching upload_ids (batch .in() of 50 to avoid URL length overflow)
    const uploadIdBatchSize = 50;
    for (let i = 0; i < matchingUploadIds.length; i += uploadIdBatchSize) {
      const idBatch = matchingUploadIds.slice(i, i + uploadIdBatchSize);
      const { rows, pagesLoaded } = await fetchAllPagedRowsFromQuery<any>(
        () =>
          applyCommonFilters(
            supabase
              .from('material_requirements')
              .select('*', { count: 'exact' })
              .in('upload_id', idBatch)
          )
            .order('created_at', { ascending: false })
            .order('id', { ascending: true }),
        chunkSize
      );
      totalPagesLoaded += pagesLoaded;

      for (const raw of rows) {
        const model = mapRawDbRequirementToModel(raw);
        dedupMap.set(model.id, model);
      }
    }

    // Also include rows without upload_id whose own created_at falls within the Asia/Jakarta date range
    const { rows: orphanRows, pagesLoaded: orphanPages } = await fetchAllPagedRowsFromQuery<any>(
      () =>
        applyCommonFilters(
          supabase
            .from('material_requirements')
            .select('*', { count: 'exact' })
            .is('upload_id', null)
            .gte('created_at', startIso)
            .lte('created_at', endIso)
        )
          .order('created_at', { ascending: false })
          .order('id', { ascending: true }),
      chunkSize
    );
    totalPagesLoaded += orphanPages;

    for (const raw of orphanRows) {
      const model = mapRawDbRequirementToModel(raw);
      dedupMap.set(model.id, model);
    }
  }

  return {
    requirements: Array.from(dedupMap.values()),
    pagesLoaded: Math.max(1, totalPagesLoaded),
  };
}
