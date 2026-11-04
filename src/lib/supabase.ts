import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Material,
  WarehouseStockItem,
  ProductionSchedule,
  OrStyleRelation,
  MaterialItemRequirement,
  UploadHistoryItem,
  DeletionHistoryItem,
} from '../types/ppic';

// Keys for environment variables or manual configuration in Settings
const STORAGE_SUPABASE_URL_KEY = 'ppic_supabase_url_custom';
const STORAGE_SUPABASE_ANON_KEY = 'ppic_supabase_anon_key_custom';

/**
 * Normalizes any date representation (ISO string, DD/MM/YYYY, DD-MM-YYYY, or missing)
 * into standard PostgreSQL DATE format (YYYY-MM-DD).
 * Guarantees that null/undefined values never trigger NOT-NULL database constraint errors.
 */
export function safeDbDate(val?: string | null): string {
  if (!val || typeof val !== 'string' || !val.trim()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  }
  const clean = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(clean)) {
    return clean.slice(0, 10);
  }
  const dmyMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/**
 * Validates whether a string is a well-formed HTTP/HTTPS URL and not an API key
 */
export function isValidSupabaseUrl(urlString?: string | null): boolean {
  if (!urlString || typeof urlString !== 'string') return false;
  const clean = urlString.trim();
  if (!clean) return false;
  // If it's accidentally an API key or has forbidden formats
  if (clean.startsWith('sb_publishable_') || clean.startsWith('eyJ') || clean.includes(' ') || clean.length < 10) {
    return false;
  }
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(clean);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalizes input URL by trimming, stripping trailing slashes,
 * and auto-prepending https:// if the user entered domain.supabase.co
 */
export function cleanSupabaseUrl(urlString?: string | null): string {
  if (!urlString || typeof urlString !== 'string') return '';
  let clean = urlString.trim().replace(/\/+$/, '');
  if (!clean) return '';
  // Don't modify if it's obviously an API key
  if (clean.startsWith('sb_publishable_') || clean.startsWith('eyJ')) {
    return clean;
  }
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    if (clean.includes('.supabase.co') || clean.includes('.supabase.in') || clean.includes('localhost')) {
      clean = `https://${clean}`;
    }
  }
  return clean;
}

/**
 * Validates whether a key looks like a valid anon/publishable key and not a URL
 */
export function isValidSupabaseAnonKey(key?: string | null): boolean {
  if (!key || typeof key !== 'string') return false;
  const clean = key.trim();
  if (clean.length < 10) return false;
  if (clean.startsWith('http://') || clean.startsWith('https://')) return false;
  return true;
}

/**
 * Automatically extracts credentials from URL hash if shared via quick-link:
 * e.g. https://domain.app/#sb_url=https://...&sb_key=sb_publishable_...
 * Enables instant 1-click configuration on other devices/laptops without manual typing.
 */
export function tryExtractCredentialsFromUrl(): { url: string; anonKey: string } | null {
  try {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    if (hash && (hash.includes('sb_url=') || hash.includes('supabase_url='))) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const rawUrl = decodeURIComponent(params.get('sb_url') || params.get('supabase_url') || '').trim();
      const rawKey = decodeURIComponent(params.get('sb_key') || params.get('supabase_key') || '').trim();
      const url = cleanSupabaseUrl(rawUrl);
      const anonKey = rawKey;
      if (isValidSupabaseUrl(url) && isValidSupabaseAnonKey(anonKey)) {
        saveCustomSupabaseCredentials(url, anonKey);
        // Clean URL hash without reloading page
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        return { url, anonKey };
      }
    }
  } catch (e) {
    console.warn('Failed to parse credentials from URL hash', e);
  }
  return null;
}

export function getSupabaseCredentials(): { url: string; anonKey: string; isConfigured: boolean; source: 'env' | 'settings' | 'none' } {
  // Check URL hash first (allows instant multi-device link sharing)
  const fromHash = tryExtractCredentialsFromUrl();
  if (fromHash && isValidSupabaseUrl(fromHash.url) && isValidSupabaseAnonKey(fromHash.anonKey)) {
    return { url: fromHash.url, anonKey: fromHash.anonKey, isConfigured: true, source: 'settings' };
  }

  const envUrl = cleanSupabaseUrl((import.meta.env.VITE_SUPABASE_URL || '').trim());
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

  // If provided in env and not dummy placeholders
  if (
    isValidSupabaseUrl(envUrl) &&
    isValidSupabaseAnonKey(envKey) &&
    !envUrl.includes('your-project-id') &&
    !envKey.includes('your-anon-publishable-key')
  ) {
    return { url: envUrl, anonKey: envKey, isConfigured: true, source: 'env' };
  }

  // Check custom storage (configured via UI in Pengaturan)
  try {
    const rawCustomUrl = (localStorage.getItem(STORAGE_SUPABASE_URL_KEY) || '').trim();
    const rawCustomKey = (localStorage.getItem(STORAGE_SUPABASE_ANON_KEY) || '').trim();
    const customUrl = cleanSupabaseUrl(rawCustomUrl);
    const customKey = rawCustomKey;

    if (isValidSupabaseUrl(customUrl) && isValidSupabaseAnonKey(customKey)) {
      return { url: customUrl, anonKey: customKey, isConfigured: true, source: 'settings' };
    }

    // If values exist in storage but are invalid (e.g. user pasted key in URL field),
    // return them for the UI form to display, but mark isConfigured: false so the app
    // never attempts to initialize an invalid client or throw URL validation exceptions.
    if (rawCustomUrl || rawCustomKey) {
      return { url: rawCustomUrl, anonKey: rawCustomKey, isConfigured: false, source: 'settings' };
    }
  } catch {
    // Ignore storage errors
  }

  return { url: envUrl, anonKey: envKey, isConfigured: false, source: 'none' };
}

export function saveCustomSupabaseCredentials(url: string, anonKey: string): void {
  try {
    const cleanUrl = cleanSupabaseUrl(url);
    const cleanKey = (anonKey || '').trim();
    localStorage.setItem(STORAGE_SUPABASE_URL_KEY, cleanUrl);
    localStorage.setItem(STORAGE_SUPABASE_ANON_KEY, cleanKey);
    // Invalidate cached client
    cachedClient = null;
    lastCredsHash = '';
  } catch (e) {
    console.error('Failed to save Supabase credentials to storage', e);
  }
}

export function clearCustomSupabaseCredentials(): void {
  try {
    localStorage.removeItem(STORAGE_SUPABASE_URL_KEY);
    localStorage.removeItem(STORAGE_SUPABASE_ANON_KEY);
    cachedClient = null;
    lastCredsHash = '';
  } catch (e) {
    console.error('Failed to clear Supabase credentials', e);
  }
}

let cachedClient: SupabaseClient | null = null;
let lastCredsHash = '';

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  const validUrl = cleanSupabaseUrl(url);

  if (!isConfigured || !isValidSupabaseUrl(validUrl) || !isValidSupabaseAnonKey(anonKey)) {
    cachedClient = null;
    return null;
  }

  const hash = `${validUrl}_${anonKey}`;
  if (cachedClient && lastCredsHash === hash) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(validUrl, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    lastCredsHash = hash;
    return cachedClient;
  } catch (e) {
    console.warn('Supabase client could not be initialized:', e);
    cachedClient = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// DATA MAPPERS (Database snake_case <-> TypeScript camelCase)
// ---------------------------------------------------------------------------

export function mapDbRequirementToModel(row: any): MaterialItemRequirement {
  return {
    id: row.id,
    uploadId: row.upload_id || undefined,
    orNumber: row.or_number,
    style: row.style,
    materialCode: row.material_code,
    materialName: row.material_name,
    category: row.category,
    unit: row.unit,
    requiredQty: Number(row.required_qty) || 0,
    receivedQty: Number(row.received_qty) || 0,
    unitPrice: Number(row.unit_price) || 0,
    supplierName: row.supplier_name || undefined,
    updateDate: row.update_date,
    importedAt: row.imported_at,
  };
}

export function mapModelToDbRequirement(model: MaterialItemRequirement): any {
  return {
    id: model.id && model.id.includes('-') && model.id.length >= 32 ? model.id : undefined,
    upload_id: model.uploadId && model.uploadId.includes('-') && model.uploadId.length >= 32 ? model.uploadId : null,
    or_number: model.orNumber,
    style: model.style,
    material_code: model.materialCode,
    material_name: model.materialName,
    category: model.category,
    unit: model.unit,
    required_qty: model.requiredQty,
    received_qty: model.receivedQty,
    unit_price: model.unitPrice || 0,
    supplier_name: model.supplierName || null,
    update_date: safeDbDate(model.updateDate),
  };
}

export function mapDbScheduleToModel(row: any): ProductionSchedule {
  return {
    id: row.id,
    orNumber: row.or_number,
    style: row.style,
    productionLine: row.production_line,
    productionDate: row.production_date,
    finishDate: row.finish_date,
    target: Number(row.target) || 0,
    status: row.status,
    notes: row.notes || undefined,
  };
}

export function mapModelToDbSchedule(model: ProductionSchedule): any {
  return {
    id: model.id && model.id.includes('-') && model.id.length >= 32 ? model.id : undefined,
    or_number: model.orNumber,
    style: model.style,
    production_line: model.productionLine,
    production_date: safeDbDate(model.productionDate),
    finish_date: safeDbDate(model.finishDate),
    target: model.target,
    status: model.status || 'Terjadwal',
    notes: model.notes || null,
  };
}

export function mapDbUploadHistoryToModel(row: any): UploadHistoryItem {
  return {
    id: row.id,
    orNumber: row.or_number,
    style: row.style,
    fileName: row.file_name,
    updateDate: row.update_date,
    uploadTime: row.upload_time,
    rowCount: Number(row.row_count) || 0,
    status: row.status,
    notes: row.notes || undefined,
  };
}

export function mapModelToDbUploadHistory(model: UploadHistoryItem): any {
  return {
    id: model.id && model.id.includes('-') && model.id.length >= 32 ? model.id : undefined,
    or_number: model.orNumber,
    style: model.style,
    file_name: model.fileName,
    update_date: safeDbDate(model.updateDate),
    upload_time: model.uploadTime || new Date().toLocaleTimeString('id-ID'),
    row_count: model.rowCount || 0,
    status: model.status || 'Sukses',
    notes: model.notes || null,
  };
}

export function mapDbRelationToModel(row: any): OrStyleRelation {
  return {
    id: row.id,
    orNumber: row.or_number,
    style: row.style,
    createdAt: row.created_at,
  };
}

export function mapModelToDbRelation(model: OrStyleRelation): any {
  return {
    id: model.id && model.id.includes('-') && model.id.length >= 32 ? model.id : undefined,
    or_number: model.orNumber,
    style: model.style,
  };
}

export function mapDbMaterialToModel(row: any): Material {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    unit: row.unit,
    totalStock: Number(row.total_stock) || 0,
    allocatedStock: Number(row.allocated_stock) || 0,
    safetyStock: Number(row.safety_stock) || 0,
    leadTimeDays: Number(row.lead_time_days) || 7,
    supplierName: row.supplier_name || '',
    defaultWarehouse: row.default_warehouse || 'Gudang Bahan Baku Utama',
    unitPrice: Number(row.unit_price) || 0,
    minOrderQty: Number(row.min_order_qty) || 0,
  };
}

export function mapModelToDbMaterial(model: Material): any {
  return {
    id: model.id && model.id.includes('-') && model.id.length >= 32 ? model.id : undefined,
    code: model.code,
    name: model.name,
    category: model.category,
    unit: model.unit,
    total_stock: model.totalStock,
    allocated_stock: model.allocatedStock,
    safety_stock: model.safetyStock,
    lead_time_days: model.leadTimeDays,
    supplier_name: model.supplierName || null,
    default_warehouse: model.defaultWarehouse,
    unit_price: model.unitPrice || 0,
    min_order_qty: model.minOrderQty || 0,
  };
}

export function mapDbDeletionToModel(row: any): DeletionHistoryItem {
  return {
    id: row.id,
    timestamp: row.timestamp || new Date(row.created_at || Date.now()).toLocaleString('id-ID'),
    method: row.method || 'BY_OR',
    methodLabel: row.method_label || 'Penghapusan Data',
    targetValue: row.target_value || '',
    targetDetails: row.target_details || undefined,
    deletedRowCount: Number(row.deleted_row_count) || 0,
    affectedOrs: row.affected_ors || [],
    user: row.operator_user || 'Tim PPIC',
  };
}

export function mapModelToDbDeletion(model: DeletionHistoryItem): any {
  return {
    id: model.id && model.id.includes('-') && model.id.length >= 32 ? model.id : undefined,
    timestamp: model.timestamp,
    method: model.method,
    method_label: model.methodLabel,
    target_value: model.targetValue,
    target_details: model.targetDetails || null,
    deleted_row_count: model.deletedRowCount,
    affected_ors: model.affectedOrs || [],
    operator_user: model.user,
  };
}

// ---------------------------------------------------------------------------
// SUPABASE API SERVICE FUNCTIONS
// ---------------------------------------------------------------------------

export async function testSupabaseConnection(
  overrideUrl?: string,
  overrideKey?: string
): Promise<{ success: boolean; message: string; tableCount?: number }> {
  const creds = getSupabaseCredentials();
  const rawUrl = (overrideUrl !== undefined ? overrideUrl : creds.url || '').trim();
  const rawKey = (overrideKey !== undefined ? overrideKey : creds.anonKey || '').trim();

  const url = cleanSupabaseUrl(rawUrl);
  const anonKey = rawKey;

  if (!rawUrl || !anonKey) {
    return {
      success: false,
      message: 'Supabase belum dikonfigurasi. Masukkan Supabase Project URL dan Anon Key.',
    };
  }

  // Check if URL is accidentally an API key (e.g. starts with sb_publishable_ or eyJ)
  if (rawUrl.startsWith('sb_publishable_') || rawUrl.startsWith('eyJ')) {
    return {
      success: false,
      message: `Kolom "Project URL" terisi API Key (${rawUrl.slice(0, 18)}...). Project URL harus berupa tautan seperti "https://[id-proyek].supabase.co". Klik tombol "Tukar Posisi URL & Key" di atas jika tertukar.`,
    };
  }

  // Check if Key is accidentally a URL
  if (anonKey.startsWith('http://') || anonKey.startsWith('https://')) {
    return {
      success: false,
      message: 'Kolom "Anon Key" terisi URL. Masukkan Publishable Anon Key (diawali sb_publishable_... atau eyJ...).',
    };
  }

  // Check valid URL format
  if (!isValidSupabaseUrl(url)) {
    return {
      success: false,
      message: 'Format Project URL tidak valid. URL harus diawali dengan https:// (contoh: https://xyzcompany.supabase.co).',
    };
  }

  let testClient: SupabaseClient;
  try {
    testClient = createClient(url, anonKey);
  } catch (err: any) {
    return {
      success: false,
      message: `Gagal menginisialisasi klien Supabase: ${err?.message || 'Format URL/Key tidak valid'}`,
    };
  }

  try {
    const { count, error } = await testClient
      .from('material_requirements')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return {
        success: false,
        message: `Koneksi gagal: ${error.message} (Pastikan script SQL Supabase sudah dijalankan di Supabase SQL Editor).`,
      };
    }

    return {
      success: true,
      message: 'Koneksi ke Supabase berhasil dan database aktif terhubung!',
      tableCount: count || 0,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Gagal menghubungi server Supabase: ${err?.message || String(err)}`,
    };
  }
}

export async function fetchAllPpicFromSupabase(): Promise<{
  materialRequirements: MaterialItemRequirement[];
  uploadHistory: UploadHistoryItem[];
  productionSchedules: ProductionSchedule[];
  orStyleRelations: OrStyleRelation[];
  materials: Material[];
  deletionHistory: DeletionHistoryItem[];
} | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const [reqRes, histRes, schRes, relRes, matRes, delRes] = await Promise.all([
      supabase.from('material_requirements').select('*').order('created_at', { ascending: false }),
      supabase.from('upload_history').select('*').order('created_at', { ascending: false }),
      supabase.from('production_schedules').select('*').order('production_date', { ascending: true }),
      supabase.from('or_style_relations').select('*').order('created_at', { ascending: false }),
      supabase.from('master_materials').select('*').order('name', { ascending: true }),
      supabase.from('deletion_history').select('*').order('created_at', { ascending: false }),
    ]);

    if (reqRes.error) {
      console.error('Error fetching material_requirements:', reqRes.error);
      throw reqRes.error;
    }

    return {
      materialRequirements: (reqRes.data || []).map(mapDbRequirementToModel),
      uploadHistory: (histRes.data || []).map(mapDbUploadHistoryToModel),
      productionSchedules: (schRes.data || []).map(mapDbScheduleToModel),
      orStyleRelations: (relRes.data || []).map(mapDbRelationToModel),
      materials: (matRes.data || []).map(mapDbMaterialToModel),
      deletionHistory: (delRes.data || []).map(mapDbDeletionToModel),
    };
  } catch (e) {
    console.error('Error fetching data from Supabase:', e);
    return null;
  }
}

export async function getSupabaseLiveCounts(): Promise<{
  connected: boolean;
  requirementsCount: number;
  historyCount: number;
  relationsCount: number;
  schedulesCount: number;
  materialsCount: number;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { connected: false, requirementsCount: 0, historyCount: 0, relationsCount: 0, schedulesCount: 0, materialsCount: 0 };
  }
  try {
    const [reqRes, histRes, relRes, schRes, matRes] = await Promise.all([
      supabase.from('material_requirements').select('id', { count: 'exact', head: true }),
      supabase.from('upload_history').select('id', { count: 'exact', head: true }),
      supabase.from('or_style_relations').select('id', { count: 'exact', head: true }),
      supabase.from('production_schedules').select('id', { count: 'exact', head: true }),
      supabase.from('master_materials').select('id', { count: 'exact', head: true }),
    ]);

    if (reqRes.error) {
      return { connected: false, requirementsCount: 0, historyCount: 0, relationsCount: 0, schedulesCount: 0, materialsCount: 0, error: reqRes.error.message };
    }

    return {
      connected: true,
      requirementsCount: reqRes.count || 0,
      historyCount: histRes.count || 0,
      relationsCount: relRes.count || 0,
      schedulesCount: schRes.count || 0,
      materialsCount: matRes.count || 0,
    };
  } catch (e: any) {
    return { connected: false, requirementsCount: 0, historyCount: 0, relationsCount: 0, schedulesCount: 0, materialsCount: 0, error: e.message || String(e) };
  }
}

export async function syncBatchExcelToSupabase(params: {
  uploadHistoryItem: UploadHistoryItem;
  relation: OrStyleRelation;
  requirements: MaterialItemRequirement[];
  masterMaterials?: Material[];
}): Promise<{ success: boolean; uploadId?: string; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, error: 'Supabase client not initialized' };

  try {
    // 1. Upsert OR & Style relation
    const dbRel = mapModelToDbRelation(params.relation);
    delete dbRel.id; // Let database manage or match on unique or_number
    await supabase
      .from('or_style_relations')
      .upsert(dbRel, { onConflict: 'or_number' });

    // 2. Insert Upload History Item
    const dbHist = mapModelToDbUploadHistory(params.uploadHistoryItem);
    delete dbHist.id; // auto generate UUID
    const { data: histData, error: histErr } = await supabase
      .from('upload_history')
      .insert(dbHist)
      .select('id')
      .single();

    if (histErr) throw histErr;
    const generatedUploadId = histData.id;

    // 3. Insert Material Requirements Batch
    const dbReqs = params.requirements.map((r) => {
      const row = mapModelToDbRequirement(r);
      row.upload_id = generatedUploadId;
      delete row.id;
      return row;
    });

    // Insert in chunks of 100 for network safety
    const chunkSize = 100;
    for (let i = 0; i < dbReqs.length; i += chunkSize) {
      const chunk = dbReqs.slice(i, i + chunkSize);
      const { error: chunkErr } = await supabase
        .from('material_requirements')
        .insert(chunk);
      if (chunkErr) throw chunkErr;
    }

    // 4. Upsert Master Materials if provided
    if (params.masterMaterials && params.masterMaterials.length > 0) {
      const dbMats = params.masterMaterials.map((m) => {
        const row = mapModelToDbMaterial(m);
        delete row.id;
        return row;
      });
      await supabase
        .from('master_materials')
        .upsert(dbMats, { onConflict: 'code' });
    }

    return { success: true, uploadId: generatedUploadId };
  } catch (err: any) {
    console.error('Failed to sync Excel upload to Supabase:', err);
    return { success: false, error: err.message || String(err) };
  }
}

export async function deleteRequirementsFromSupabase(query: {
  by: 'id' | 'ids' | 'or' | 'style' | 'updateDate' | 'uploadId';
  value: string | string[];
  includeHistory?: boolean;
}): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, deletedCount: 0, error: 'Supabase client not initialized' };

  try {
    let deletedCount = 0;

    if (query.by === 'id') {
      const { error } = await supabase
        .from('material_requirements')
        .delete()
        .eq('id', query.value as string);
      if (error) throw error;
      deletedCount = 1;
    } else if (query.by === 'ids') {
      const ids = query.value as string[];
      const { error } = await supabase
        .from('material_requirements')
        .delete()
        .in('id', ids);
      if (error) throw error;
      deletedCount = ids.length;
    } else if (query.by === 'or') {
      const orNum = query.value as string;
      const { data, error } = await supabase
        .from('material_requirements')
        .delete()
        .eq('or_number', orNum)
        .select('id');
      if (error) throw error;
      deletedCount = data?.length || 0;

      if (query.includeHistory) {
        await supabase.from('upload_history').delete().eq('or_number', orNum);
        await supabase.from('or_style_relations').delete().eq('or_number', orNum);
      }
    } else if (query.by === 'style') {
      const styleName = query.value as string;
      const { data, error } = await supabase
        .from('material_requirements')
        .delete()
        .eq('style', styleName)
        .select('id');
      if (error) throw error;
      deletedCount = data?.length || 0;
    } else if (query.by === 'updateDate') {
      const uDate = query.value as string;
      const { data, error } = await supabase
        .from('material_requirements')
        .delete()
        .eq('update_date', uDate)
        .select('id');
      if (error) throw error;
      deletedCount = data?.length || 0;
    } else if (query.by === 'uploadId') {
      const uId = query.value as string;
      const { data, error } = await supabase
        .from('material_requirements')
        .delete()
        .eq('upload_id', uId)
        .select('id');
      if (error) throw error;
      deletedCount = data?.length || 0;
      await supabase.from('upload_history').delete().eq('id', uId);
    }

    return { success: true, deletedCount };
  } catch (err: any) {
    console.error('Failed to delete requirements from Supabase:', err);
    return { success: false, deletedCount: 0, error: err.message || String(err) };
  }
}

export async function logDeletionToSupabase(logItem: DeletionHistoryItem): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const row = mapModelToDbDeletion(logItem);
    delete row.id;
    await supabase.from('deletion_history').insert(row);
  } catch (e) {
    console.error('Failed to log deletion to Supabase:', e);
  }
}

export async function saveScheduleToSupabase(schedule: ProductionSchedule): Promise<{ success: boolean; id?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false };

  try {
    const row = mapModelToDbSchedule(schedule);
    if (!row.id) {
      delete row.id;
      const { data, error } = await supabase
        .from('production_schedules')
        .insert(row)
        .select('id')
        .single();
      if (error) throw error;
      return { success: true, id: data.id };
    } else {
      const { error } = await supabase
        .from('production_schedules')
        .upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return { success: true, id: schedule.id };
    }
  } catch (e) {
    console.error('Failed to save schedule to Supabase:', e);
    return { success: false };
  }
}

export async function deleteScheduleFromSupabase(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('production_schedules')
      .delete()
      .eq('id', id);
    return !error;
  } catch (e) {
    console.error('Failed to delete schedule from Supabase:', e);
    return false;
  }
}

export async function seedLocalDataToSupabase(data: {
  materialRequirements: MaterialItemRequirement[];
  uploadHistory: UploadHistoryItem[];
  productionSchedules: ProductionSchedule[];
  orStyleRelations: OrStyleRelation[];
  materials: Material[];
}): Promise<{ success: boolean; message: string; insertedCount: number; details?: any }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, message: 'Supabase belum terkonfigurasi. Pastikan Project URL dan Anon Key sudah diisi.', insertedCount: 0 };

  try {
    let totalInserted = 0;

    // 1. Relations: deduplicate by or_number to prevent ON CONFLICT DO UPDATE batch collisions
    if (data.orStyleRelations.length > 0) {
      const relMap = new Map<string, any>();
      for (const r of data.orStyleRelations) {
        if (!r.orNumber?.trim()) continue;
        const row = mapModelToDbRelation(r);
        delete row.id;
        relMap.set(r.orNumber.trim().toUpperCase(), row);
      }
      const relRows = Array.from(relMap.values());
      if (relRows.length > 0) {
        const { error } = await supabase.from('or_style_relations').upsert(relRows, { onConflict: 'or_number' });
        if (error) {
          console.error('Error upserting relations:', error);
          throw new Error(`Gagal menyimpan relasi OR: ${error.message}`);
        }
      }
    }

    // 2. Upload History: deduplicate or insert safely
    if (data.uploadHistory.length > 0) {
      const histRows = data.uploadHistory.map((h) => {
        const row = mapModelToDbUploadHistory(h);
        delete row.id; // Let Supabase generate valid UUID
        return row;
      });
      const { error } = await supabase.from('upload_history').insert(histRows);
      if (error) {
        console.error('Error inserting upload history:', error);
        throw new Error(`Gagal menyimpan riwayat upload: ${error.message}`);
      }
    }

    // 3. Materials: deduplicate by code
    if (data.materials.length > 0) {
      const matMap = new Map<string, any>();
      for (const m of data.materials) {
        if (!m.code?.trim()) continue;
        const row = mapModelToDbMaterial(m);
        delete row.id;
        matMap.set(m.code.trim().toUpperCase(), row);
      }
      const matRows = Array.from(matMap.values());
      if (matRows.length > 0) {
        const { error } = await supabase.from('master_materials').upsert(matRows, { onConflict: 'code' });
        if (error) {
          console.error('Error upserting master materials:', error);
          throw new Error(`Gagal menyimpan master material: ${error.message}`);
        }
      }
    }

    // 4. Schedules
    if (data.productionSchedules.length > 0) {
      const schRows = data.productionSchedules.map((s) => {
        const row = mapModelToDbSchedule(s);
        delete row.id;
        return row;
      });
      const { error } = await supabase.from('production_schedules').insert(schRows);
      if (error) {
        console.error('Error inserting production schedules:', error);
        throw new Error(`Gagal menyimpan jadwal produksi: ${error.message}`);
      }
    }

    // 5. Requirements in chunks with strict date normalization and error check
    if (data.materialRequirements.length > 0) {
      const reqRows = data.materialRequirements.map((r) => {
        const row = mapModelToDbRequirement(r);
        delete row.id;
        delete row.upload_id;
        return row;
      });
      const chunkSize = 100;
      for (let i = 0; i < reqRows.length; i += chunkSize) {
        const chunk = reqRows.slice(i, i + chunkSize);
        const { error: chunkErr } = await supabase.from('material_requirements').insert(chunk);
        if (chunkErr) {
          console.error('Error inserting material requirements chunk:', chunkErr);
          throw new Error(`Gagal menyimpan detail material: ${chunkErr.message}`);
        }
        totalInserted += chunk.length;
      }
    }

    // Verify row count directly from Supabase
    const { count: verifiedCount } = await supabase
      .from('material_requirements')
      .select('*', { count: 'exact', head: true });

    return {
      success: true,
      message: `Migrasi data ke Supabase berhasil! Tersimpan ${verifiedCount || totalInserted} baris material di cloud online. Semua device tim sekarang dapat melihat data yang sama.`,
      insertedCount: verifiedCount || totalInserted,
    };
  } catch (err: any) {
    console.error('Failed to seed local data to Supabase:', err);
    return {
      success: false,
      message: `Migrasi gagal: ${err.message || String(err)}`,
      insertedCount: 0,
    };
  }
}
