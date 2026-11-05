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
 * Validates whether a string is an RFC4122 v4 UUID
 */
export function isValidUuid(str?: string | null): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

/**
 * Generates an RFC4122 v4 compliant UUID
 */
export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
  let target = clean;
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    target = `https://${target}`;
  }
  try {
    const parsed = new URL(target);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalizes input URL by trimming, stripping /rest/v1 or /rest paths,
 * trailing slashes, and auto-prepending https:// if needed.
 * Guarantees that Supabase JavaScript Client never receives a double /rest/v1 path.
 */
export function cleanSupabaseUrl(urlString?: string | null): string {
  if (!urlString || typeof urlString !== 'string') return '';
  let clean = urlString.trim();
  if (!clean) return '';
  // Don't modify if it's obviously an API key
  if (clean.startsWith('sb_publishable_') || clean.startsWith('eyJ')) {
    return clean;
  }
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `https://${clean}`;
  }
  try {
    const parsed = new URL(clean);
    // Standard Supabase project URLs should be origin only (https://[project-id].supabase.co)
    if (parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.supabase.in')) {
      return `${parsed.protocol}//${parsed.host}`;
    }
    // For localhost or custom proxy, strip /rest/v1 or /rest from pathname
    const pathname = parsed.pathname
      .replace(/\/rest\/v1\/?$/, '')
      .replace(/\/rest\/?$/, '')
      .replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return clean.replace(/\/rest\/v1\/?$/, '').replace(/\/rest\/?$/, '').replace(/\/+$/, '');
  }
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
): Promise<{
  success: boolean;
  message: string;
  tableCount?: number;
  missingTables?: string[];
}> {
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
      message: 'Format Project URL tidak valid. URL harus diawali dengan https:// (contoh: https://xyzcompany.supabase.co). Jangan memasukkan akhiran /rest/v1.',
    };
  }

  let testClient: SupabaseClient;
  try {
    testClient = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
  } catch (err: any) {
    return {
      success: false,
      message: `Gagal menginisialisasi klien Supabase: ${err?.message || 'Format URL/Key tidak valid'}`,
    };
  }

  try {
    // Check all required PPIC core tables to ensure complete database readiness
    const requiredTables = [
      { name: 'material_requirements', label: 'Detail Kebutuhan Material' },
      { name: 'or_style_relations', label: 'Relasi OR & Style' },
      { name: 'upload_history', label: 'Riwayat Upload Excel' },
      { name: 'production_schedules', label: 'Jadwal Produksi' },
      { name: 'master_materials', label: 'Master Material' },
    ];

    const results = await Promise.all(
      requiredTables.map(async (tbl) => {
        const res = await testClient.from(tbl.name).select('id', { count: 'exact', head: true });
        return { table: tbl.name, label: tbl.label, error: res.error, count: res.count ?? 0 };
      })
    );

    const missingOrFailed = results.filter((r) => r.error !== null);

    if (missingOrFailed.length > 0) {
      const isRouteOrPathError = missingOrFailed.some(
        (r) =>
          r.error?.message?.toLowerCase().includes('invalid path') ||
          r.error?.message?.toLowerCase().includes('relation') ||
          r.error?.message?.toLowerCase().includes('does not exist') ||
          (r.error as any)?.code === '42P01' ||
          (r.error as any)?.code === 'PGRST106' ||
          (r.error as any)?.code === 'PGRST205'
      );

      const tableNames = missingOrFailed.map((r) => `"${r.table}"`).join(', ');

      if (isRouteOrPathError) {
        return {
          success: false,
          missingTables: missingOrFailed.map((r) => r.table),
          message: `Koneksi berhasil terhubung ke server Supabase, namun tabel ${tableNames} belum dibuat di database Anda. Silakan klik tombol "Lihat Skema Tabel SQL Supabase" di bawah, salin query SQL, dan jalankan di menu "SQL Editor" pada Supabase Dashboard.`,
        };
      }

      return {
        success: false,
        missingTables: missingOrFailed.map((r) => r.table),
        message: `Koneksi gagal pada tabel ${tableNames}: ${missingOrFailed[0].error?.message}. Pastikan izin RLS aktif dan skema tabel sudah dijalankan.`,
      };
    }

    const reqCount = results.find((r) => r.table === 'material_requirements')?.count || 0;

    return {
      success: true,
      message: 'Koneksi ke Supabase berhasil! Seluruh 5 tabel terpusat (material_requirements, or_style_relations, upload_history, production_schedules, master_materials) telah aktif dan siap digunakan.',
      tableCount: reqCount,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Gagal menghubungi server Supabase: ${err?.message || String(err)}. Periksa koneksi internet atau format Project URL.`,
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
}): Promise<{
  success: boolean;
  message: string;
  insertedCount: number;
  details?: {
    requirements: { local: number; remote: number };
    relations: { local: number; remote: number };
    history: { local: number; remote: number };
    materials: { local: number; remote: number };
    schedules: { local: number; remote: number };
  };
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      success: false,
      message: 'Supabase belum terkonfigurasi. Pastikan Project URL dan Anon Key sudah diisi di tab Pengaturan.',
      insertedCount: 0,
    };
  }

  try {
    // -------------------------------------------------------------------------
    // STEP 1 (Independen/Parent): Master Materials Katalog
    // -------------------------------------------------------------------------
    if (data.materials && data.materials.length > 0) {
      const matMap = new Map<string, any>();
      for (const m of data.materials) {
        if (!m.code?.trim()) continue;
        const row = mapModelToDbMaterial(m);
        if (!isValidUuid(row.id)) {
          delete row.id;
        }
        matMap.set(m.code.trim().toUpperCase(), row);
      }
      const matRows = Array.from(matMap.values());
      if (matRows.length > 0) {
        const { error: matErr } = await supabase
          .from('master_materials')
          .upsert(matRows, { onConflict: 'code' });

        if (matErr) {
          console.error('Error upserting master materials:', matErr);
          const isMissing = matErr.message?.toLowerCase().includes('does not exist') ||
            matErr.message?.toLowerCase().includes('invalid path') ||
            (matErr as any)?.code === '42P01';
          throw new Error(
            `[Tabel: master_materials | Operasi: Upsert] ${matErr.message}${
              isMissing
                ? ' (Tabel "master_materials" belum dibuat di Supabase. Jalankan skema SQL di Supabase SQL Editor).'
                : ''
            }`
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // STEP 2 (Independen/Parent): OR & Style Relations
    // -------------------------------------------------------------------------
    if (data.orStyleRelations && data.orStyleRelations.length > 0) {
      const relMap = new Map<string, any>();
      for (const r of data.orStyleRelations) {
        if (!r.orNumber?.trim()) continue;
        let cleanOr = r.orNumber.trim();
        let cleanStyle = (r.style || '').trim();

        // Deteksi jika nilai OR dan Style tertukar saat input/unggah (misal Style panjang masuk ke kolom OR)
        if (
          cleanOr.length > 50 &&
          cleanStyle.length > 0 &&
          cleanStyle.length <= 50 &&
          /^(OR|PO|SO|WO|MO)[-_0-9]/i.test(cleanStyle) &&
          !/^(OR|PO|SO|WO|MO)[-_0-9]/i.test(cleanOr)
        ) {
          const temp = cleanOr;
          cleanOr = cleanStyle.toUpperCase();
          cleanStyle = temp;
        } else {
          cleanOr = cleanOr.toUpperCase();
        }

        const row = {
          id: isValidUuid(r.id) ? r.id : undefined,
          or_number: cleanOr,
          style: cleanStyle || `Style ${cleanOr}`,
        };
        relMap.set(cleanOr, row);
      }
      const relRows = Array.from(relMap.values());
      if (relRows.length > 0) {
        const { error: relErr } = await supabase
          .from('or_style_relations')
          .upsert(relRows, { onConflict: 'or_number' });

        if (relErr) {
          console.error('Error upserting relations:', relErr);
          const isMissing = relErr.message?.toLowerCase().includes('invalid path') ||
            relErr.message?.toLowerCase().includes('does not exist') ||
            relErr.message?.toLowerCase().includes('relation') ||
            (relErr as any)?.code === '42P01' ||
            (relErr as any)?.code === 'PGRST106' ||
            (relErr as any)?.code === 'PGRST205';

          const isLengthErr = relErr.message?.toLowerCase().includes('value too long') ||
            relErr.message?.toLowerCase().includes('character varying');

          if (isLengthErr) {
            const longStyleRow = relRows.find((row) => (row.style || '').length > 255);
            const longOrRow = relRows.find((row) => (row.or_number || '').length > 255);
            const offendingCol = longStyleRow ? 'style' : (longOrRow ? 'or_number' : 'style / or_number');
            const sampleLen = longStyleRow ? longStyleRow.style.length : (longOrRow ? longOrRow.or_number.length : 256);
            const sampleVal = longStyleRow ? longStyleRow.style : (longOrRow ? longOrRow.or_number : '');
            const sampleOr = longStyleRow ? longStyleRow.or_number : (longOrRow ? longOrRow.or_number : '');

            throw new Error(
              `[Tabel: or_style_relations | Kolom: ${offendingCol} | Operasi: Upsert Relasi OR] ${relErr.message}. Kolom pada database Supabase Anda saat ini masih dibatasi tipe VARCHAR(255), sedangkan terdapat data lokal sepanjang ${sampleLen} karakter (OR: "${sampleOr}", nilai: "${sampleVal.slice(0, 40)}..."). Silakan jalankan script SQL migrasi "Pembaruan Kolom ke TEXT" di Supabase SQL Editor (dapat disalin 1-klik di tab Pengaturan) agar seluruh teks panjang tersimpan 100% utuh tanpa dipotong.`
            );
          }

          throw new Error(
            `[Tabel: or_style_relations | Operasi: Upsert Relasi OR] ${relErr.message}${
              isMissing
                ? ' (Tabel "or_style_relations" belum dibuat di database Supabase Anda. Buka menu SQL Editor pada Supabase Dashboard dan jalankan skema SQL yang disediakan di tombol "Lihat Skema Tabel SQL Supabase").'
                : ''
            }`
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // STEP 3 (Parent): Upload History dengan UUID Mapping yang Aman
    // -------------------------------------------------------------------------
    // Map local ID to PostgreSQL UUID v4 to maintain exact foreign key references
    const uploadIdMap = new Map<string, string>();

    if (data.uploadHistory && data.uploadHistory.length > 0) {
      // Fetch existing upload records to prevent duplicate entries and map IDs
      const { data: existingUploads, error: fetchHistErr } = await supabase
        .from('upload_history')
        .select('id, or_number, update_date, file_name');

      if (fetchHistErr) {
        console.error('Error fetching upload history:', fetchHistErr);
        throw new Error(`[Tabel: upload_history | Operasi: Select] ${fetchHistErr.message}`);
      }

      const existingSet = new Set<string>();
      if (existingUploads) {
        for (const ex of existingUploads) {
          const key = `${ex.or_number}_${ex.update_date}_${ex.file_name}`.toLowerCase();
          existingSet.add(key);
        }
      }

      const newHistRows: any[] = [];
      for (const h of data.uploadHistory) {
        const assignedUuid = isValidUuid(h.id) ? h.id : generateUuid();
        if (h.id) {
          uploadIdMap.set(h.id, assignedUuid);
        }

        const compKey = `${h.orNumber}_${safeDbDate(h.updateDate)}_${h.fileName}`.toLowerCase();
        if (existingSet.has(compKey)) {
          // If already in Supabase, find existing remote ID to reuse
          const matched = existingUploads?.find(
            (ex) => `${ex.or_number}_${ex.update_date}_${ex.file_name}`.toLowerCase() === compKey
          );
          if (matched && h.id) {
            uploadIdMap.set(h.id, matched.id);
          }
        } else {
          const row = mapModelToDbUploadHistory(h);
          row.id = assignedUuid;
          row.update_date = safeDbDate(h.updateDate);
          newHistRows.push(row);
          existingSet.add(compKey);
        }
      }

      if (newHistRows.length > 0) {
        const { error: histErr } = await supabase.from('upload_history').insert(newHistRows);
        if (histErr) {
          console.error('Error inserting upload history:', histErr);
          throw new Error(`[Tabel: upload_history | Operasi: Insert] ${histErr.message}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // STEP 4 (Child): Detail Material Requirements (Chunked & Idempotent)
    // -------------------------------------------------------------------------
    if (data.materialRequirements && data.materialRequirements.length > 0) {
      // Find all distinct OR numbers in the incoming migration dataset
      const distinctOrs = Array.from(
        new Set(
          data.materialRequirements
            .map((r) => r.orNumber?.trim())
            .filter((x): x is string => Boolean(x))
        )
      );

      // Clean existing requirements for these specific ORs to ensure idempotency (no duplicate rows)
      if (distinctOrs.length > 0) {
        const orChunkSize = 50;
        for (let i = 0; i < distinctOrs.length; i += orChunkSize) {
          const orChunk = distinctOrs.slice(i, i + orChunkSize);
          const { error: delErr } = await supabase
            .from('material_requirements')
            .delete()
            .in('or_number', orChunk);

          if (delErr) {
            console.warn('Warning during idempotent cleanup of existing ORs:', delErr);
          }
        }
      }

      // Map rows with valid UUIDs, normalized dates, and mapped upload_id foreign keys
      const reqRows = data.materialRequirements.map((r) => {
        let cleanOr = (r.orNumber || '').trim();
        let cleanStyle = (r.style || '').trim();

        // Deteksi jika OR dan Style tertukar pada baris material
        if (
          cleanOr.length > 50 &&
          cleanStyle.length > 0 &&
          cleanStyle.length <= 50 &&
          /^(OR|PO|SO|WO|MO)[-_0-9]/i.test(cleanStyle) &&
          !/^(OR|PO|SO|WO|MO)[-_0-9]/i.test(cleanOr)
        ) {
          const temp = cleanOr;
          cleanOr = cleanStyle.toUpperCase();
          cleanStyle = temp;
        } else {
          cleanOr = cleanOr.toUpperCase();
        }

        const row = mapModelToDbRequirement(r);
        row.or_number = cleanOr;
        row.style = cleanStyle || `Style ${cleanOr}`;
        row.id = isValidUuid(r.id) ? r.id : generateUuid();
        if (r.uploadId && uploadIdMap.has(r.uploadId)) {
          row.upload_id = uploadIdMap.get(r.uploadId);
        } else if (r.uploadId && isValidUuid(r.uploadId)) {
          row.upload_id = r.uploadId;
        } else {
          row.upload_id = null;
        }
        row.update_date = safeDbDate(r.updateDate);
        return row;
      });

      // Insert in chunks of 100 rows for high reliability and network resilience
      const chunkSize = 100;
      for (let i = 0; i < reqRows.length; i += chunkSize) {
        const chunk = reqRows.slice(i, i + chunkSize);
        const { error: chunkErr } = await supabase.from('material_requirements').insert(chunk);
        if (chunkErr) {
          console.error('Error inserting material requirements chunk:', chunkErr);
          const isMissing = chunkErr.message?.toLowerCase().includes('invalid path') ||
            chunkErr.message?.toLowerCase().includes('does not exist') ||
            (chunkErr as any)?.code === '42P01';

          const isLengthErr = chunkErr.message?.toLowerCase().includes('value too long') ||
            chunkErr.message?.toLowerCase().includes('character varying');

          if (isLengthErr) {
            throw new Error(
              `[Tabel: material_requirements | Operasi: Insert Batch ${Math.floor(i / chunkSize) + 1}] ${
                chunkErr.message
              }. Kolom pada database Supabase Anda saat ini masih bertipe VARCHAR(255). Jalankan script SQL migrasi "Pembaruan Kolom ke TEXT" di Supabase SQL Editor (tersedia tombol salin 1-klik di tab Pengaturan) agar seluruh nama material dan style panjang tersimpan utuh.`
            );
          }

          throw new Error(
            `[Tabel: material_requirements | Operasi: Insert Batch ${Math.floor(i / chunkSize) + 1}] ${
              chunkErr.message
            }${
              isMissing
                ? ' (Tabel "material_requirements" belum dibuat di Supabase. Jalankan skema SQL di Supabase SQL Editor).'
                : ''
            }`
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // STEP 5 (Independen): Production Schedules
    // -------------------------------------------------------------------------
    if (data.productionSchedules && data.productionSchedules.length > 0) {
      const schRows = data.productionSchedules.map((s) => {
        const row = mapModelToDbSchedule(s);
        row.id = isValidUuid(s.id) ? s.id : generateUuid();
        row.production_date = safeDbDate(s.productionDate);
        row.finish_date = safeDbDate(s.finishDate);
        return row;
      });

      const { error: schErr } = await supabase
        .from('production_schedules')
        .upsert(schRows, { onConflict: 'id' });

      if (schErr) {
        console.error('Error upserting production schedules:', schErr);
        throw new Error(`[Tabel: production_schedules | Operasi: Upsert] ${schErr.message}`);
      }
    }

    // -------------------------------------------------------------------------
    // STEP 6: VERIFIKASI LANGSUNG JUMLAH DATA LOKAL VS SUPABASE
    // -------------------------------------------------------------------------
    const [reqCountRes, relCountRes, histCountRes, matCountRes, schCountRes] = await Promise.all([
      supabase.from('material_requirements').select('id', { count: 'exact', head: true }),
      supabase.from('or_style_relations').select('id', { count: 'exact', head: true }),
      supabase.from('upload_history').select('id', { count: 'exact', head: true }),
      supabase.from('master_materials').select('id', { count: 'exact', head: true }),
      supabase.from('production_schedules').select('id', { count: 'exact', head: true }),
    ]);

    const verifiedCounts = {
      requirements: { local: data.materialRequirements.length, remote: reqCountRes.count ?? 0 },
      relations: { local: data.orStyleRelations.length, remote: relCountRes.count ?? 0 },
      history: { local: data.uploadHistory.length, remote: histCountRes.count ?? 0 },
      materials: { local: data.materials.length, remote: matCountRes.count ?? 0 },
      schedules: { local: data.productionSchedules.length, remote: schCountRes.count ?? 0 },
    };

    return {
      success: true,
      message: `Migrasi data ke Supabase berhasil dan terverifikasi!\n• Detail Material: ${verifiedCounts.requirements.remote} baris tersimpan (Lokal: ${verifiedCounts.requirements.local})\n• Relasi OR & Style: ${verifiedCounts.relations.remote} item\n• Riwayat Unggahan: ${verifiedCounts.history.remote} file\n• Master Material: ${verifiedCounts.materials.remote} item\n• Jadwal Produksi: ${verifiedCounts.schedules.remote} jadwal\nSemua device tim sekarang otomatis tersambung ke database terpusat yang sama.`,
      insertedCount: verifiedCounts.requirements.remote,
      details: verifiedCounts,
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
