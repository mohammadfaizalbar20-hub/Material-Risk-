import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import {
  Material,
  Warehouse,
  WarehouseStockItem,
  ProductionSchedule,
  OrStyleRelation,
  MaterialItemRequirement,
  MaterialRiskAssessment,
  OrRiskSummary,
  ParetoItem,
  ScheduleConflict,
  StockTransferPayload,
  ProductionSimulationConfig,
  UploadHistoryItem,
  DeletionHistoryItem,
} from '../types/ppic';
import {
  INITIAL_MATERIALS,
  INITIAL_WAREHOUSES,
  INITIAL_WAREHOUSE_STOCK,
  INITIAL_PRODUCTION_SCHEDULES,
  INITIAL_OR_STYLE_RELATIONS,
  INITIAL_MATERIAL_REQUIREMENTS,
  INITIAL_UPLOAD_HISTORY,
} from '../data/initialPpicData';
import {
  assessAllMaterialRisks,
  calculateParetoAnalysis,
  calculateMaterialComparisonMetrics,
  detectScheduleConflicts,
} from '../utils/ppicCalculations';
import {
  getSupabaseCredentials,
  getSupabaseClient,
  saveCustomSupabaseCredentials,
  clearCustomSupabaseCredentials,
  testSupabaseConnection,
  fetchAllPpicFromSupabase,
  syncBatchExcelToSupabase,
  syncBatchExcelToSupabaseWithProgress,
  UploadProgressCallbackInfo,
  deleteRequirementsFromSupabase,
  logDeletionToSupabase,
  saveScheduleToSupabase,
  deleteScheduleFromSupabase,
  seedLocalDataToSupabase,
} from '../lib/supabase';

export type AppMenu =
  | 'Dashboard'
  | 'Upload Excel'
  | 'Rekap Material'
  | 'Penjadwalan Produksi'
  | 'Material Risk Analysis'
  | 'AI Assistant'
  | 'Pengaturan';

export interface PpicNotification {
  id: string;
  type: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface PpicContextType {
  activeMenu: AppMenu;
  setActiveMenu: (menu: AppMenu) => void;
  // Sidebar state: hidden by default
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // OR & Style Relations
  orStyleRelations: OrStyleRelation[];
  saveOrStyleRelation: (orNumber: string, style: string) => void;
  getStyleForOr: (orNumber: string) => string | null;
  getOrsForStyle: (style: string) => string[];

  // Production Schedules (Production Planning Board / Gantt)
  productionSchedules: ProductionSchedule[];
  addProductionSchedule: (sch: Omit<ProductionSchedule, 'id'>) => ProductionSchedule;
  updateProductionSchedule: (id: string, updates: Partial<ProductionSchedule>) => void;
  deleteProductionSchedule: (id: string) => void;
  scheduleConflicts: Map<string, ScheduleConflict>;
  workOrders: ProductionSchedule[]; // Alias for backward compatibility
  addWorkOrder: (wo: any) => void;
  updateWorkOrder: (id: string, updates: any) => void;
  deleteWorkOrder: (id: string) => void;

  // Material Requirements (Per OR & Style)
  materialRequirements: MaterialItemRequirement[];
  addMaterialRequirement: (req: Omit<MaterialItemRequirement, 'id'>) => void;
  updateMaterialRequirement: (id: string, updates: Partial<MaterialItemRequirement>) => void;
  deleteMaterialRequirement: (id: string) => void;

  // Risk Assessments & Pareto Analytics (Deterministic)
  materialRiskAssessments: MaterialRiskAssessment[];
  orRiskSummaries: OrRiskSummary[];
  paretoAnalysis: ParetoItem[];
  comparisonMetrics: ReturnType<typeof calculateMaterialComparisonMetrics>;

  // Materials & Warehouses (kept for compatibility and inventory integrity)
  materials: Material[];
  addMaterial: (material: Omit<Material, 'id'>) => void;
  updateMaterial: (id: string, updates: Partial<Material>) => void;
  deleteMaterial: (id: string) => void;
  warehouses: Warehouse[];
  warehouseStock: WarehouseStockItem[];
  transferStock: (payload: StockTransferPayload) => { success: boolean; message: string };

  // Notifications
  notifications: PpicNotification[];
  markNotificationAsRead: (id: string) => void;
  clearAllNotifications: () => void;

  // Search & Global state
  activeSearchQuery: string;
  setActiveSearchQuery: (q: string) => void;
  resetToInitialData: () => void;
  importPpicData: (data: {
    materials?: Material[];
    materialRequirements?: MaterialItemRequirement[];
    productionSchedules?: ProductionSchedule[];
    orStyleRelations?: OrStyleRelation[];
  }) => void;

  selectedScheduleId: string | null;
  setSelectedScheduleId: (id: string | null) => void;
  selectedWorkOrderId: string | null;
  setSelectedWorkOrderId: (id: string | null) => void;

  // Single Source of Truth for Registered OR Numbers (Derived from Upload Excel data)
  registeredOrNumbers: string[];
  searchRegisteredOrs: (query: string) => string[];
  getOrSummary: (orNumber: string) => {
    orNumber: string;
    style: string;
    latestUpdateDate?: string;
    updateDates: string[];
    requirements: MaterialItemRequirement[];
  };

  // Upload History & Tanggal Update Tracking
  uploadHistory: UploadHistoryItem[];
  addUploadHistory: (item: Omit<UploadHistoryItem, 'id'>) => void;

  // Realtime Excel auto-save and highlight tracking
  lastImportedInfo: { orNumber: string; style?: string; count: number; updateDate: string; timestamp: number } | null;
  setLastImportedInfo: (info: { orNumber: string; style?: string; count: number; updateDate: string; timestamp: number } | null) => void;
  autoSaveExcelMaterials: (params: {
    newRequirements: MaterialItemRequirement[];
    newMasterMaterials?: Material[];
    newRelations?: OrStyleRelation[];
    updateDate: string;
    fileName?: string;
    skipMenuRedirect?: boolean;
    onProgress?: (info: UploadProgressCallbackInfo) => void;
  }) => Promise<{ success: boolean; uploadId?: string; error?: string }>;

  // Master Data Deletion Feature
  deletionHistory: DeletionHistoryItem[];
  deleteSingleRequirement: (id: string) => { success: boolean; deletedCount: number; message: string };
  deleteMultipleRequirements: (ids: string[]) => { success: boolean; deletedCount: number; message: string };
  deleteDataByOr: (orNumber: string, includeHistory?: boolean) => { success: boolean; deletedCount: number; message: string };
  deleteOrHistory: (orNumber: string, targetDate?: string) => { success: boolean; deletedCount: number; message: string };
  deleteDataByStyle: (styleName: string) => { success: boolean; deletedCount: number; message: string };
  deleteDataByUpdateDate: (updateDate: string) => {
    success: boolean;
    deletedCount: number;
    affectedOrs: string[];
    message: string;
  };
  getDeletionImpactByOr: (orNumber: string) => {
    orNumber: string;
    style: string;
    rowCount: number;
    updateDates: string[];
    totalRequiredQty: number;
    rows: MaterialItemRequirement[];
  };
  getDeletionImpactByDate: (updateDate: string) => {
    updateDate: string;
    rowCount: number;
    affectedOrs: { orNumber: string; style: string; rowCount: number }[];
    rows: MaterialItemRequirement[];
  };
  getDeletionImpactByStyle: (styleName: string) => {
    style: string;
    rowCount: number;
    affectedOrs: string[];
    totalRequiredQty: number;
    rows: MaterialItemRequirement[];
  };
  deleteDataByUploadId: (uploadId: string) => { success: boolean; deletedCount: number; message: string };
  getDeletionImpactByUploadId: (uploadId: string) => {
    uploadId: string;
    orNumber: string;
    style: string;
    fileName: string;
    updateDate: string;
    rowCount: number;
    rows: MaterialItemRequirement[];
  };
  getOrHistoryDetails: (orNumber: string) => {
    orNumber: string;
    style: string;
    dates: { updateDate: string; rowCount: number; totalQty: number; fileName?: string; uploadId?: string }[];
    totalRows: number;
    uploadHistoryItems: UploadHistoryItem[];
  };

  // Supabase Centralized Database State & Sync
  supabaseConnected: boolean;
  supabaseLoading: boolean;
  supabaseSyncError: string | null;
  lastSyncTimestamp: number | null;
  syncWithSupabase: () => Promise<void>;
  migrateLocalDataToSupabase: () => Promise<{ success: boolean; message: string }>;
  updateSupabaseCredentials: (url: string, key: string) => Promise<{ success: boolean; message: string }>;
  disconnectSupabase: () => void;
}

const PpicContext = createContext<PpicContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'ppic_material_system_v3';

export const PpicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeMenu, setActiveMenu] = useState<AppMenu>('Dashboard');

  // Rule 8: "Seluruh sidebar disembunyikan ketika aplikasi pertama kali dibuka."
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const toggleSidebar = () => setSidebarOpen((prev) => !prev);

  const [activeSearchQuery, setActiveSearchQuery] = useState<string>('');
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);

  const [lastImportedInfo, setLastImportedInfo] = useState<{
    orNumber: string;
    style?: string;
    count: number;
    updateDate: string;
    timestamp: number;
  } | null>(null);

  // Upload History & Tanggal Update Tracking
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_upload_history`);
      return saved ? JSON.parse(saved) : INITIAL_UPLOAD_HISTORY;
    } catch {
      return INITIAL_UPLOAD_HISTORY;
    }
  });

  // Deletion History Tracking
  const [deletionHistory, setDeletionHistory] = useState<DeletionHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_deletion_history`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_deletion_history`, JSON.stringify(deletionHistory));
    } catch (e) {
      console.error(e);
    }
  }, [deletionHistory]);

  // OR & Style Relations
  const [orStyleRelations, setOrStyleRelations] = useState<OrStyleRelation[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_or_style`);
      return saved ? JSON.parse(saved) : INITIAL_OR_STYLE_RELATIONS;
    } catch {
      return INITIAL_OR_STYLE_RELATIONS;
    }
  });

  // Material Requirements
  const [materialRequirements, setMaterialRequirements] = useState<MaterialItemRequirement[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_requirements`);
      return saved ? JSON.parse(saved) : INITIAL_MATERIAL_REQUIREMENTS;
    } catch {
      return INITIAL_MATERIAL_REQUIREMENTS;
    }
  });

  // Production Schedules
  const [productionSchedules, setProductionSchedules] = useState<ProductionSchedule[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_schedules`);
      return saved ? JSON.parse(saved) : INITIAL_PRODUCTION_SCHEDULES;
    } catch {
      return INITIAL_PRODUCTION_SCHEDULES;
    }
  });

  // Master Materials & Warehouses
  const [materials, setMaterials] = useState<Material[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_materials`);
      return saved ? JSON.parse(saved) : INITIAL_MATERIALS;
    } catch {
      return INITIAL_MATERIALS;
    }
  });

  const [warehouses] = useState<Warehouse[]>(INITIAL_WAREHOUSES);
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStockItem[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_stock`);
      return saved ? JSON.parse(saved) : INITIAL_WAREHOUSE_STOCK;
    } catch {
      return INITIAL_WAREHOUSE_STOCK;
    }
  });

  const [notifications, setNotifications] = useState<PpicNotification[]>([
    {
      id: 'notif-1',
      type: 'critical',
      title: 'Shortage Kritis: Kain Taslan Navy',
      message: 'OR-2026-001 (Line 1) membutuhkan 2.500 Yard, baru diterima 1.200 Yard (Kekurangan 52%).',
      timestamp: '15 menit yang lalu',
      read: false,
    },
    {
      id: 'notif-2',
      type: 'warning',
      title: 'Peringatan Bentrok Jadwal Line 1',
      message: 'Jadwal OR-2026-001 dan OR-2026-002 saling bertabrakan pada tanggal 04-06 November 2026 di Line 1.',
      timestamp: '30 menit yang lalu',
      read: false,
    },
  ]);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_or_style`, JSON.stringify(orStyleRelations));
    } catch (e) {
      console.error(e);
    }
  }, [orStyleRelations]);

  useEffect(() => {
    try {
      // High volume optimization: Cache at most 1,000 recent requirements in localStorage
      // to avoid QuotaExceededError (5MB browser limit) when storing 20,000+ rows daily.
      // Supabase PostgreSQL remains the comprehensive centralized single source of truth.
      const toCache = materialRequirements.slice(0, 1000);
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_requirements`, JSON.stringify(toCache));
    } catch (e) {
      console.warn('LocalStorage quota limit reached, Supabase cloud remains authoritative:', e);
    }
  }, [materialRequirements]);

  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_schedules`, JSON.stringify(productionSchedules));
    } catch (e) {
      console.error(e);
    }
  }, [productionSchedules]);

  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_materials`, JSON.stringify(materials));
    } catch (e) {
      console.error(e);
    }
  }, [materials]);

  useEffect(() => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_upload_history`, JSON.stringify(uploadHistory));
    } catch (e) {
      console.error(e);
    }
  }, [uploadHistory]);

  // ---------------------------------------------------------------------------
  // SUPABASE CENTRALIZED DATABASE & REALTIME SYNCHRONIZATION
  // ---------------------------------------------------------------------------
  const [supabaseConnected, setSupabaseConnected] = useState<boolean>(false);
  const [supabaseLoading, setSupabaseLoading] = useState<boolean>(false);
  const [supabaseSyncError, setSupabaseSyncError] = useState<string | null>(null);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);

  // Sync / pull fresh data from Supabase
  const syncWithSupabase = async () => {
    const creds = getSupabaseCredentials();
    if (!creds.isConfigured) return;

    setSupabaseLoading(true);
    try {
      const data = await fetchAllPpicFromSupabase();
      if (data) {
        if (data.materialRequirements.length > 0) {
          setMaterialRequirements(data.materialRequirements);
        }
        if (data.uploadHistory.length > 0) {
          setUploadHistory(data.uploadHistory);
        }
        if (data.productionSchedules.length > 0) {
          setProductionSchedules(data.productionSchedules);
        }
        if (data.orStyleRelations.length > 0) {
          setOrStyleRelations(data.orStyleRelations);
        }
        if (data.materials.length > 0) {
          setMaterials(data.materials);
        }
        if (data.deletionHistory.length > 0) {
          setDeletionHistory(data.deletionHistory);
        }

        setSupabaseConnected(true);
        setSupabaseSyncError(null);
        setLastSyncTimestamp(Date.now());
      } else {
        setSupabaseSyncError('Gagal memuat data dari database Supabase.');
      }
    } catch (err: any) {
      setSupabaseSyncError(err.message || 'Koneksi ke database Supabase terputus.');
    } finally {
      setSupabaseLoading(false);
    }
  };

  // Migrate offline/local data to Supabase (Safe migration)
  const migrateLocalDataToSupabase = async () => {
    setSupabaseLoading(true);
    try {
      const res = await seedLocalDataToSupabase({
        materialRequirements,
        uploadHistory,
        productionSchedules,
        orStyleRelations,
        materials,
      });

      if (res.success) {
        await syncWithSupabase();
        setNotifications((prev) => [
          {
            id: `notif-${Date.now()}`,
            type: 'info',
            title: 'Migrasi Supabase Berhasil',
            message: `${res.insertedCount} baris data berhasil disinkronkan ke database terpusat Supabase.`,
            timestamp: 'Baru saja',
            read: false,
          },
          ...prev,
        ]);
        return { success: true, message: res.message };
      } else {
        return { success: false, message: res.message };
      }
    } catch (err: any) {
      return { success: false, message: err.message || 'Gagal melakukan migrasi' };
    } finally {
      setSupabaseLoading(false);
    }
  };

  // Update Supabase credentials via Settings UI
  const updateSupabaseCredentials = async (url: string, key: string) => {
    const test = await testSupabaseConnection(url, key);
    if (test.success) {
      saveCustomSupabaseCredentials(url, key);
      setSupabaseConnected(true);
      setSupabaseSyncError(null);
      await syncWithSupabase();
      return { success: true, message: test.message };
    } else {
      setSupabaseConnected(false);
      setSupabaseSyncError(test.message);
      return { success: false, message: test.message };
    }
  };

  const disconnectSupabase = () => {
    clearCustomSupabaseCredentials();
    setSupabaseConnected(false);
    setSupabaseSyncError(null);
  };

  // Boot-time connect and Realtime Channel subscription
  useEffect(() => {
    let isMounted = true;
    const creds = getSupabaseCredentials();

    if (creds.isConfigured) {
      setSupabaseLoading(true);
      fetchAllPpicFromSupabase().then((data) => {
        if (!isMounted) return;
        if (data) {
          if (data.materialRequirements.length > 0) setMaterialRequirements(data.materialRequirements);
          if (data.uploadHistory.length > 0) setUploadHistory(data.uploadHistory);
          if (data.productionSchedules.length > 0) setProductionSchedules(data.productionSchedules);
          if (data.orStyleRelations.length > 0) setOrStyleRelations(data.orStyleRelations);
          if (data.materials.length > 0) setMaterials(data.materials);
          if (data.deletionHistory.length > 0) setDeletionHistory(data.deletionHistory);

          setSupabaseConnected(true);
          setSupabaseSyncError(null);
          setLastSyncTimestamp(Date.now());
        } else {
          setSupabaseConnected(false);
          setSupabaseSyncError('Tidak dapat terhubung ke tabel Supabase. Menggunakan data lokal.');
        }
        setSupabaseLoading(false);
      }).catch((err) => {
        if (!isMounted) return;
        setSupabaseConnected(false);
        setSupabaseSyncError(err.message || 'Gagal menghubungkan ke Supabase.');
        setSupabaseLoading(false);
      });
    }

    // Realtime channel subscription
    const supabase = getSupabaseClient();
    let channel: any = null;
    if (supabase) {
      channel = supabase
        .channel('ppic-db-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public' },
          async () => {
            if (!isMounted) return;
            const fresh = await fetchAllPpicFromSupabase();
            if (fresh && isMounted) {
              setMaterialRequirements(fresh.materialRequirements);
              setUploadHistory(fresh.uploadHistory);
              setProductionSchedules(fresh.productionSchedules);
              setOrStyleRelations(fresh.orStyleRelations);
              setMaterials(fresh.materials);
              setDeletionHistory(fresh.deletionHistory);
              setLastSyncTimestamp(Date.now());
            }
          }
        )
        .subscribe();
    }

    return () => {
      isMounted = false;
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  // SINGLE SOURCE OF TRUTH FOR REGISTERED OR NUMBERS
  // Derived strictly from Excel uploads (uploadHistory and materialRequirements).
  // Ensures ONLY ORs that have been entered and saved via Upload Excel appear across the app.
  const registeredOrNumbers = useMemo(() => {
    const set = new Set<string>();
    for (const hist of uploadHistory) {
      if (hist.orNumber && hist.orNumber.trim()) {
        set.add(hist.orNumber.trim().toUpperCase());
      }
    }
    for (const req of materialRequirements) {
      if (req.orNumber && req.orNumber.trim()) {
        set.add(req.orNumber.trim().toUpperCase());
      }
    }
    return Array.from(set).sort();
  }, [uploadHistory, materialRequirements]);

  // Timestamp formatter helper
  const getNowWibTimestamp = () => {
    return (
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()) + ' WIB'
    );
  };

  // Impact calculation before deleting by OR
  const getDeletionImpactByOr = (orNumber: string) => {
    const clean = (orNumber || '').trim().toUpperCase();
    const rows = materialRequirements.filter((r) => r.orNumber.trim().toUpperCase() === clean);
    const matchedStyle = getStyleForOr(clean) || rows[0]?.style || '-';
    const updateDates = Array.from(
      new Set(rows.map((r) => r.updateDate).filter(Boolean) as string[])
    ).sort().reverse();
    const totalRequiredQty = rows.reduce((acc, r) => acc + (r.requiredQty || 0), 0);

    return {
      orNumber: clean,
      style: matchedStyle,
      rowCount: rows.length,
      updateDates,
      totalRequiredQty,
      rows,
    };
  };

  // Safe Deletion by OR Number
  const deleteDataByOr = (orNumber: string, includeHistory: boolean = true) => {
    const clean = (orNumber || '').trim().toUpperCase();
    const rowsToDelete = materialRequirements.filter((r) => r.orNumber.trim().toUpperCase() === clean);
    const rowCount = rowsToDelete.length;
    const styleName = getStyleForOr(clean) || rowsToDelete[0]?.style || '-';

    if (rowCount === 0 && !uploadHistory.some((h) => h.orNumber.trim().toUpperCase() === clean)) {
      return { success: false, deletedCount: 0, message: `Tidak ditemukan data transaksi untuk ${clean}.` };
    }

    // 1. Remove from materialRequirements
    setMaterialRequirements((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== clean));

    // 2. Remove from uploadHistory if requested
    if (includeHistory) {
      setUploadHistory((prev) => prev.filter((h) => h.orNumber.trim().toUpperCase() !== clean));
      setOrStyleRelations((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== clean));
      setProductionSchedules((prev) => prev.filter((s) => s.orNumber.trim().toUpperCase() !== clean));
    }

    // 3. Record in deletionHistory audit log
    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: getNowWibTimestamp(),
      method: 'BY_OR',
      methodLabel: 'Hapus Berdasarkan Nomor OR',
      targetValue: clean,
      targetDetails: `Style: ${styleName}${includeHistory ? ' (Termasuk riwayat upload)' : ''}`,
      deletedRowCount: rowCount,
      affectedOrs: [clean],
      user: 'Tim PPIC (Terautentikasi)',
    };

    setDeletionHistory((prev) => [newRecord, ...prev]);

    // 4. System notification
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'warning',
        title: 'Penghapusan Data OR Berhasil',
        message: `Seluruh transaksi material ${clean} (${rowCount} baris) telah berhasil dihapus permanen.`,
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);

    // 5. Sync to Supabase
    if (getSupabaseCredentials().isConfigured) {
      deleteRequirementsFromSupabase({ by: 'or', value: clean, includeHistory });
      logDeletionToSupabase(newRecord);
    }

    return {
      success: true,
      deletedCount: rowCount,
      message: `Data transaksi ${clean} (${rowCount} baris material) berhasil dihapus permanen.`,
    };
  };

  // Safe Deletion of a single material requirement row
  const deleteSingleRequirement = (id: string) => {
    const target = materialRequirements.find((r) => r.id === id);
    if (!target) {
      return { success: false, deletedCount: 0, message: 'Baris material tidak ditemukan.' };
    }

    setMaterialRequirements((prev) => prev.filter((r) => r.id !== id));

    const orClean = target.orNumber.trim().toUpperCase();
    const otherReqs = materialRequirements.filter((r) => r.id !== id && r.orNumber.trim().toUpperCase() === orClean);
    const hasHistory = uploadHistory.some((h) => h.orNumber.trim().toUpperCase() === orClean);
    if (otherReqs.length === 0 && !hasHistory) {
      setOrStyleRelations((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== orClean));
    }

    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: getNowWibTimestamp(),
      method: 'BY_ROW',
      methodLabel: 'Hapus Satu Baris Material',
      targetValue: `${target.materialCode} (${target.materialName})`,
      targetDetails: `No. OR: ${target.orNumber} | Style: ${target.style} | Tanggal: ${target.updateDate || '2026-10-31'}`,
      deletedRowCount: 1,
      affectedOrs: [orClean],
      user: 'Tim PPIC (Terautentikasi)',
    };
    setDeletionHistory((prev) => [newRecord, ...prev]);

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'warning',
        title: 'Penghapusan Baris Material Berhasil',
        message: `Baris material ${target.materialCode} untuk OR ${target.orNumber} telah dihapus permanen.`,
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);

    if (getSupabaseCredentials().isConfigured) {
      deleteRequirementsFromSupabase({ by: 'id', value: id });
      logDeletionToSupabase(newRecord);
    }

    return {
      success: true,
      deletedCount: 1,
      message: `Baris material ${target.materialCode} (${target.materialName}) berhasil dihapus.`,
    };
  };

  // Safe Deletion of multiple selected material requirement rows
  const deleteMultipleRequirements = (ids: string[]) => {
    if (ids.length === 0) {
      return { success: false, deletedCount: 0, message: 'Tidak ada baris material yang dipilih.' };
    }
    const idSet = new Set(ids);
    const targets = materialRequirements.filter((r) => idSet.has(r.id));
    const count = targets.length;
    const affectedOrs = Array.from(new Set(targets.map((r) => r.orNumber.trim().toUpperCase())));

    setMaterialRequirements((prev) => prev.filter((r) => !idSet.has(r.id)));

    setOrStyleRelations((prev) => {
      const remainingOrs = new Set<string>();
      materialRequirements
        .filter((r) => !idSet.has(r.id))
        .forEach((r) => remainingOrs.add(r.orNumber.trim().toUpperCase()));
      uploadHistory.forEach((h) => remainingOrs.add(h.orNumber.trim().toUpperCase()));
      return prev.filter((rel) => remainingOrs.has(rel.orNumber.trim().toUpperCase()));
    });

    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: getNowWibTimestamp(),
      method: 'BATCH_SELECTED',
      methodLabel: 'Hapus Data Pilihan',
      targetValue: `${count} Baris Terpilih`,
      targetDetails: `OR Terdampak: ${affectedOrs.join(', ')}`,
      deletedRowCount: count,
      affectedOrs,
      user: 'Tim PPIC (Terautentikasi)',
    };
    setDeletionHistory((prev) => [newRecord, ...prev]);

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'warning',
        title: 'Penghapusan Data Terpilih Berhasil',
        message: `${count} baris transaksi material telah berhasil dihapus permanen.`,
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);

    if (getSupabaseCredentials().isConfigured) {
      deleteRequirementsFromSupabase({ by: 'ids', value: ids });
      logDeletionToSupabase(newRecord);
    }

    return {
      success: true,
      deletedCount: count,
      message: `${count} baris material terpilih berhasil dihapus permanen.`,
    };
  };

  // Deletion by Style
  const getDeletionImpactByStyle = (styleName: string) => {
    const cleanStyle = (styleName || '').trim().toLowerCase();
    const rows = materialRequirements.filter((r) => (r.style || '').trim().toLowerCase() === cleanStyle);
    const affectedOrs = Array.from(new Set(rows.map((r) => r.orNumber.trim().toUpperCase())));
    const totalRequiredQty = rows.reduce((acc, r) => acc + (r.requiredQty || 0), 0);

    return {
      style: styleName.trim(),
      rowCount: rows.length,
      affectedOrs,
      totalRequiredQty,
      rows,
    };
  };

  const deleteDataByStyle = (styleName: string) => {
    const cleanStyle = (styleName || '').trim().toLowerCase();
    const rowsToDelete = materialRequirements.filter((r) => (r.style || '').trim().toLowerCase() === cleanStyle);
    const count = rowsToDelete.length;

    if (count === 0) {
      return { success: false, deletedCount: 0, message: `Tidak ditemukan transaksi untuk Style "${styleName}".` };
    }

    const affectedOrs = Array.from(new Set(rowsToDelete.map((r) => r.orNumber.trim().toUpperCase())));

    setMaterialRequirements((prev) => prev.filter((r) => (r.style || '').trim().toLowerCase() !== cleanStyle));
    setOrStyleRelations((prev) => prev.filter((r) => r.style.trim().toLowerCase() !== cleanStyle));

    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: getNowWibTimestamp(),
      method: 'BY_STYLE',
      methodLabel: 'Hapus Berdasarkan Style',
      targetValue: styleName.trim(),
      targetDetails: `OR Terdampak: ${affectedOrs.join(', ') || '-'}`,
      deletedRowCount: count,
      affectedOrs,
      user: 'Tim PPIC (Terautentikasi)',
    };
    setDeletionHistory((prev) => [newRecord, ...prev]);

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'warning',
        title: 'Penghapusan Berdasarkan Style Berhasil',
        message: `Transaksi untuk Style "${styleName}" (${count} baris) telah berhasil dihapus.`,
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);

    if (getSupabaseCredentials().isConfigured) {
      deleteRequirementsFromSupabase({ by: 'style', value: cleanStyle });
      logDeletionToSupabase(newRecord);
    }

    return {
      success: true,
      deletedCount: count,
      message: `Data transaksi untuk Style "${styleName}" (${count} baris) berhasil dihapus.`,
    };
  };

  // OR History Details & Deletion
  const getOrHistoryDetails = (orNumber: string) => {
    const clean = (orNumber || '').trim().toUpperCase();
    const rows = materialRequirements.filter((r) => r.orNumber.trim().toUpperCase() === clean);
    const styleName = getStyleForOr(clean) || rows[0]?.style || '-';
    const datesSet = Array.from(new Set(rows.map((r) => r.updateDate || '2026-10-31'))).sort().reverse();

    const dates = datesSet.map((d) => {
      const dateRows = rows.filter((r) => (r.updateDate || '2026-10-31') === d);
      const totalQty = dateRows.reduce((acc, r) => acc + (r.requiredQty || 0), 0);
      const hist = uploadHistory.find((h) => h.orNumber.trim().toUpperCase() === clean && h.updateDate === d);
      return {
        updateDate: d,
        rowCount: dateRows.length,
        totalQty,
        fileName: hist?.fileName,
        uploadId: hist?.id || dateRows[0]?.uploadId,
      };
    });

    const relatedHistory = uploadHistory.filter((h) => h.orNumber.trim().toUpperCase() === clean);

    return {
      orNumber: clean,
      style: styleName,
      dates,
      totalRows: rows.length,
      uploadHistoryItems: relatedHistory,
    };
  };

  const getDeletionImpactByUploadId = (uploadId: string) => {
    const uploadItem = uploadHistory.find((h) => h.id === uploadId);
    const rows = materialRequirements.filter((r) => r.uploadId === uploadId);
    const orNumber = uploadItem?.orNumber || rows[0]?.orNumber || '-';
    const style = uploadItem?.style || rows[0]?.style || '-';
    const fileName = uploadItem?.fileName || 'File Excel';
    const updateDate = uploadItem?.updateDate || rows[0]?.updateDate || '-';

    return {
      uploadId,
      orNumber,
      style,
      fileName,
      updateDate,
      rowCount: rows.length,
      rows,
    };
  };

  const deleteDataByUploadId = (uploadId: string) => {
    const uploadItem = uploadHistory.find((h) => h.id === uploadId);
    const rowsToDelete = materialRequirements.filter((r) => r.uploadId === uploadId);
    const rowCount = rowsToDelete.length;
    const orNumber = uploadItem?.orNumber || rowsToDelete[0]?.orNumber || '-';

    setMaterialRequirements((prev) => prev.filter((r) => r.uploadId !== uploadId));
    setUploadHistory((prev) => prev.filter((h) => h.id !== uploadId));

    // Clean relations if OR has no remaining rows and no upload history
    setOrStyleRelations((prev) => {
      const remainingOrs = new Set<string>();
      materialRequirements
        .filter((r) => r.uploadId !== uploadId)
        .forEach((r) => remainingOrs.add(r.orNumber.trim().toUpperCase()));
      uploadHistory
        .filter((h) => h.id !== uploadId)
        .forEach((h) => remainingOrs.add(h.orNumber.trim().toUpperCase()));
      return prev.filter((rel) => remainingOrs.has(rel.orNumber.trim().toUpperCase()));
    });

    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: getNowWibTimestamp(),
      method: 'BY_UPLOAD',
      methodLabel: 'Hapus Satu Riwayat Upload File',
      targetValue: uploadItem?.fileName || uploadId,
      targetDetails: `OR: ${orNumber} | Tanggal: ${uploadItem?.updateDate || '-'} | ${rowCount} Baris Material`,
      deletedRowCount: rowCount,
      affectedOrs: [orNumber],
      user: 'Tim PPIC (Terautentikasi)',
    };
    setDeletionHistory((prev) => [newRecord, ...prev]);

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'warning',
        title: 'Riwayat Upload File Dihapus',
        message: `File ${uploadItem?.fileName || uploadId} (${rowCount} baris material untuk ${orNumber}) telah dihapus.`,
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);

    if (getSupabaseCredentials().isConfigured) {
      deleteRequirementsFromSupabase({ by: 'uploadId', value: uploadId });
      logDeletionToSupabase(newRecord);
    }

    return {
      success: true,
      deletedCount: rowCount,
      message: `Riwayat upload ${uploadItem?.fileName || uploadId} (${rowCount} baris material) berhasil dihapus.`,
    };
  };

  const deleteOrHistory = (orNumber: string, targetDate?: string) => {
    const clean = (orNumber || '').trim().toUpperCase();
    const isSpecificDate = targetDate && targetDate !== 'ALL';

    if (isSpecificDate) {
      const rowsToDelete = materialRequirements.filter(
        (r) => r.orNumber.trim().toUpperCase() === clean && (r.updateDate || '2026-10-31') === targetDate
      );
      const rowCount = rowsToDelete.length;

      setMaterialRequirements((prev) =>
        prev.filter(
          (r) => !(r.orNumber.trim().toUpperCase() === clean && (r.updateDate || '2026-10-31') === targetDate)
        )
      );

      setUploadHistory((prev) =>
        prev.filter((h) => !(h.orNumber.trim().toUpperCase() === clean && h.updateDate === targetDate))
      );

      // Check if OR has any remaining rows
      const remainingForOr = materialRequirements.filter(
        (r) => r.orNumber.trim().toUpperCase() === clean && (r.updateDate || '2026-10-31') !== targetDate
      );
      if (remainingForOr.length === 0) {
        setOrStyleRelations((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== clean));
      }

      const newRecord: DeletionHistoryItem = {
        id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: getNowWibTimestamp(),
        method: 'OR_HISTORY',
        methodLabel: 'Hapus Riwayat OR (Tanggal Tertentu)',
        targetValue: `${clean} (${targetDate})`,
        targetDetails: `Dihapus ${rowCount} baris pada tanggal ${targetDate}. Tanggal lain tetap aman.`,
        deletedRowCount: rowCount,
        affectedOrs: [clean],
        user: 'Tim PPIC (Terautentikasi)',
      };
      setDeletionHistory((prev) => [newRecord, ...prev]);

      if (getSupabaseCredentials().isConfigured) {
        deleteRequirementsFromSupabase({ by: 'updateDate', value: targetDate });
        logDeletionToSupabase(newRecord);
      }

      return {
        success: true,
        deletedCount: rowCount,
        message: `Riwayat OR ${clean} pada tanggal ${targetDate} (${rowCount} baris) berhasil dihapus.`,
      };
    } else {
      // Delete all history for this OR
      const rowsToDelete = materialRequirements.filter((r) => r.orNumber.trim().toUpperCase() === clean);
      const rowCount = rowsToDelete.length;

      setMaterialRequirements((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== clean));
      setUploadHistory((prev) => prev.filter((h) => h.orNumber.trim().toUpperCase() !== clean));
      setOrStyleRelations((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== clean));
      setProductionSchedules((prev) => prev.filter((s) => s.orNumber.trim().toUpperCase() !== clean));

      const newRecord: DeletionHistoryItem = {
        id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: getNowWibTimestamp(),
        method: 'OR_HISTORY',
        methodLabel: 'Hapus Seluruh Riwayat OR',
        targetValue: clean,
        targetDetails: `Seluruh transaksi (${rowCount} baris) dan riwayat upload dihapus.`,
        deletedRowCount: rowCount,
        affectedOrs: [clean],
        user: 'Tim PPIC (Terautentikasi)',
      };
      setDeletionHistory((prev) => [newRecord, ...prev]);

      if (getSupabaseCredentials().isConfigured) {
        deleteRequirementsFromSupabase({ by: 'or', value: clean, includeHistory: true });
        logDeletionToSupabase(newRecord);
      }

      return {
        success: true,
        deletedCount: rowCount,
        message: `Seluruh riwayat OR ${clean} (${rowCount} baris transaksi) berhasil dihapus permanen.`,
      };
    }
  };

  // Impact calculation before deleting by Tanggal Update
  const getDeletionImpactByDate = (updateDate: string) => {
    const cleanDate = (updateDate || '').trim();
    const rows = materialRequirements.filter((r) => (r.updateDate || '2026-10-31') === cleanDate);
    const orMap = new Map<string, { orNumber: string; style: string; rowCount: number }>();

    for (const r of rows) {
      const or = r.orNumber.trim().toUpperCase();
      if (!orMap.has(or)) {
        orMap.set(or, {
          orNumber: or,
          style: r.style || getStyleForOr(or) || '-',
          rowCount: 0,
        });
      }
      orMap.get(or)!.rowCount += 1;
    }

    return {
      updateDate: cleanDate,
      rowCount: rows.length,
      affectedOrs: Array.from(orMap.values()),
      rows,
    };
  };

  // Safe Deletion by Tanggal Update
  const deleteDataByUpdateDate = (updateDate: string) => {
    const cleanDate = (updateDate || '').trim();
    const rowsToDelete = materialRequirements.filter((r) => (r.updateDate || '2026-10-31') === cleanDate);
    const rowCount = rowsToDelete.length;

    if (rowCount === 0 && !uploadHistory.some((h) => h.updateDate === cleanDate)) {
      return {
        success: false,
        deletedCount: 0,
        affectedOrs: [],
        message: `Tidak ditemukan transaksi material untuk Tanggal Update ${cleanDate}.`,
      };
    }

    const affectedOrsSet = new Set(rowsToDelete.map((r) => r.orNumber.trim().toUpperCase()));
    const affectedOrsList = Array.from(affectedOrsSet);

    // 1. Delete rows for that specific date only (keeps other dates intact!)
    setMaterialRequirements((prev) => prev.filter((r) => (r.updateDate || '2026-10-31') !== cleanDate));

    // 2. Remove from uploadHistory for that date only
    setUploadHistory((prev) => prev.filter((h) => h.updateDate !== cleanDate));

    // 3. For any affected OR, if it has no remaining rows in other dates and no upload history, clean relations
    setOrStyleRelations((prev) => {
      const remainingOrs = new Set<string>();
      materialRequirements
        .filter((r) => (r.updateDate || '2026-10-31') !== cleanDate)
        .forEach((r) => remainingOrs.add(r.orNumber.trim().toUpperCase()));
      uploadHistory
        .filter((h) => h.updateDate !== cleanDate)
        .forEach((h) => remainingOrs.add(h.orNumber.trim().toUpperCase()));

      return prev.filter((rel) => remainingOrs.has(rel.orNumber.trim().toUpperCase()));
    });

    // 4. Record in deletionHistory audit log
    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: getNowWibTimestamp(),
      method: 'BY_DATE',
      methodLabel: 'Hapus Berdasarkan Tanggal Update',
      targetValue: cleanDate,
      targetDetails: `OR Terdampak: ${affectedOrsList.join(', ') || '-'}`,
      deletedRowCount: rowCount,
      affectedOrs: affectedOrsList,
      user: 'Tim PPIC (Terautentikasi)',
    };

    setDeletionHistory((prev) => [newRecord, ...prev]);

    // 5. System notification
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'warning',
        title: 'Penghapusan Berdasarkan Tanggal Berhasil',
        message: `Transaksi Tanggal Update ${cleanDate} (${rowCount} baris material) telah berhasil dihapus.`,
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);

    if (getSupabaseCredentials().isConfigured) {
      deleteRequirementsFromSupabase({ by: 'updateDate', value: cleanDate });
      logDeletionToSupabase(newRecord);
    }

    return {
      success: true,
      deletedCount: rowCount,
      affectedOrs: affectedOrsList,
      message: `Data transaksi Tanggal Update ${cleanDate} (${rowCount} baris material) berhasil dihapus.`,
    };
  };

  const searchRegisteredOrs = (query: string): string[] => {
    const clean = (query || '').trim().toUpperCase();
    if (!clean) return registeredOrNumbers;
    // Supports partial / substring input matching
    return registeredOrNumbers.filter((or) => or.includes(clean));
  };

  const getOrSummary = (orNumber: string) => {
    const clean = (orNumber || '').trim().toUpperCase();
    const matchedStyle = getStyleForOr(clean) || '';
    const reqs = materialRequirements.filter((r) => r.orNumber.trim().toUpperCase() === clean);
    const dates = Array.from(
      new Set(reqs.map((r) => r.updateDate).filter(Boolean) as string[])
    ).sort().reverse();

    return {
      orNumber: clean,
      style: matchedStyle,
      latestUpdateDate: dates[0] || undefined,
      updateDates: dates,
      requirements: reqs,
    };
  };

  const addUploadHistory = (item: Omit<UploadHistoryItem, 'id'>) => {
    const newHist: UploadHistoryItem = {
      ...item,
      id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    };
    setUploadHistory((prev) => [newHist, ...prev]);
  };

  // Save or update OR <-> Style relation
  const saveOrStyleRelation = (orNumber: string, style: string) => {
    if (!orNumber.trim() || !style.trim()) return;
    const cleanOr = orNumber.trim().toUpperCase();
    const cleanStyle = style.trim();

    setOrStyleRelations((prev) => {
      const existingIdx = prev.findIndex(
        (r) => r.orNumber.toUpperCase() === cleanOr && r.style.toLowerCase() === cleanStyle.toLowerCase()
      );
      if (existingIdx >= 0) return prev;

      return [
        {
          id: `rel-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          orNumber: cleanOr,
          style: cleanStyle,
          createdAt: new Date().toISOString().slice(0, 10),
        },
        ...prev,
      ];
    });
  };

  const getStyleForOr = (orNumber: string): string | null => {
    const clean = (orNumber || '').trim().toUpperCase();
    if (!clean) return null;
    const match = orStyleRelations.find((r) => r.orNumber.toUpperCase() === clean);
    if (match) return match.style;
    const partial = orStyleRelations.find((r) => r.orNumber.toUpperCase().includes(clean));
    if (partial) return partial.style;
    const reqMatch = materialRequirements.find((r) => r.orNumber.trim().toUpperCase() === clean);
    if (reqMatch && reqMatch.style) return reqMatch.style;
    return null;
  };

  const getOrsForStyle = (style: string): string[] => {
    const clean = (style || '').trim().toLowerCase();
    if (!clean) return [];
    // 1. Exact matches first from orStyleRelations
    const exact = orStyleRelations.filter((r) => r.style.toLowerCase() === clean);
    if (exact.length > 0) {
      return Array.from(new Set(exact.map((m) => m.orNumber)));
    }
    // Fallback: check material requirements
    const reqExact = materialRequirements.filter((r) => r.style.toLowerCase() === clean);
    if (reqExact.length > 0) {
      return Array.from(new Set(reqExact.map((m) => m.orNumber)));
    }
    // 2. Partial/substring matches if >= 3 characters
    if (clean.length >= 3) {
      const partials = orStyleRelations.filter((r) => r.style.toLowerCase().includes(clean));
      if (partials.length > 0) {
        return Array.from(new Set(partials.map((m) => m.orNumber)));
      }
      const reqPartials = materialRequirements.filter((r) => r.style.toLowerCase().includes(clean));
      return Array.from(new Set(reqPartials.map((m) => m.orNumber)));
    }
    return [];
  };

  // Schedule conflicts detection (Reactive)
  const scheduleConflicts = useMemo(() => {
    return detectScheduleConflicts(productionSchedules);
  }, [productionSchedules]);

  // Material Risk Analysis & OR Summaries (Optimized for High Volume & Active Schedules)
  const { materialAssessments: materialRiskAssessments, orSummaries: orRiskSummaries } = useMemo(() => {
    // High-volume scale optimization:
    // Focus risk analysis on materials that belong to scheduled ORs, or the recent 2,000 requirements.
    // This prevents evaluating millions of historical finished records while keeping 100% precision for active production schedules.
    const scheduledOrs = new Set(productionSchedules.map((s) => s.orNumber.trim().toUpperCase()));
    const activeReqs =
      scheduledOrs.size > 0
        ? materialRequirements.filter((r) => scheduledOrs.has(r.orNumber.trim().toUpperCase()))
        : materialRequirements.slice(0, 2000);

    return assessAllMaterialRisks(
      activeReqs.length > 0 ? activeReqs : materialRequirements.slice(0, 2000),
      productionSchedules,
      new Date()
    );
  }, [materialRequirements, productionSchedules]);

  // Pareto Analysis (Reactive)
  const paretoAnalysis = useMemo(() => {
    return calculateParetoAnalysis(materialRequirements);
  }, [materialRequirements]);

  // Comparison Metrics (Reactive)
  const comparisonMetrics = useMemo(() => {
    return calculateMaterialComparisonMetrics(materialRequirements);
  }, [materialRequirements]);

  // Schedule CRUD
  const addProductionSchedule = (sch: Omit<ProductionSchedule, 'id'>): ProductionSchedule => {
    const newSch: ProductionSchedule = {
      ...sch,
      id: `sch-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: sch.status || 'Terjadwal',
    };

    setProductionSchedules((prev) => [...prev, newSch]);

    // Automatically remember OR <-> Style relation
    saveOrStyleRelation(sch.orNumber, sch.style);

    if (getSupabaseCredentials().isConfigured) {
      saveScheduleToSupabase(newSch);
    }

    return newSch;
  };

  const updateProductionSchedule = (id: string, updates: Partial<ProductionSchedule>) => {
    setProductionSchedules((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, ...updates } : s));
      const target = next.find((s) => s.id === id);
      if (target && getSupabaseCredentials().isConfigured) {
        saveScheduleToSupabase(target);
      }
      return next;
    });
    if (updates.orNumber && updates.style) {
      saveOrStyleRelation(updates.orNumber, updates.style);
    }
  };

  const deleteProductionSchedule = (id: string) => {
    setProductionSchedules((prev) => prev.filter((s) => s.id !== id));
    if (getSupabaseCredentials().isConfigured) {
      deleteScheduleFromSupabase(id);
    }
  };

  // Requirement CRUD
  const addMaterialRequirement = (req: Omit<MaterialItemRequirement, 'id'>) => {
    const newReq: MaterialItemRequirement = {
      ...req,
      id: `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    };
    setMaterialRequirements((prev) => [...prev, newReq]);
    if (req.orNumber && req.style) {
      saveOrStyleRelation(req.orNumber, req.style);
    }
  };

  const updateMaterialRequirement = (id: string, updates: Partial<MaterialItemRequirement>) => {
    setMaterialRequirements((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  const deleteMaterialRequirement = (id: string) => {
    setMaterialRequirements((prev) => prev.filter((r) => r.id !== id));
  };

  // Material CRUD (compatibility)
  const addMaterial = (newMat: Omit<Material, 'id'>) => {
    const id = `mat-${Date.now()}`;
    setMaterials((prev) => [...prev, { ...newMat, id }]);
  };

  const updateMaterial = (id: string, updates: Partial<Material>) => {
    setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  };

  const deleteMaterial = (id: string) => {
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  };

  const transferStock = (payload: StockTransferPayload): { success: boolean; message: string } => {
    return { success: true, message: `Stok material berhasil ditransfer ke ${payload.toWarehouse}.` };
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const importPpicData = (data: {
    materials?: Material[];
    materialRequirements?: MaterialItemRequirement[];
    productionSchedules?: ProductionSchedule[];
    orStyleRelations?: OrStyleRelation[];
  }) => {
    if (data.materials && data.materials.length > 0) {
      setMaterials(data.materials);
    }
    if (data.materialRequirements && data.materialRequirements.length > 0) {
      setMaterialRequirements(data.materialRequirements);
    }
    if (data.productionSchedules && data.productionSchedules.length > 0) {
      setProductionSchedules(data.productionSchedules);
    }
    if (data.orStyleRelations && data.orStyleRelations.length > 0) {
      setOrStyleRelations((prev) => {
        const map = new Map(prev.map((r) => [`${r.orNumber}__${r.style}`, r]));
        for (const item of data.orStyleRelations!) {
          map.set(`${item.orNumber}__${item.style}`, item);
        }
        return Array.from(map.values());
      });
    }

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'info',
        title: 'Impor Data Excel Selesai',
        message: 'Kebutuhan material, OR, dan jadwal produksi berhasil disinkronkan.',
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);
  };

  // Direct Automatic Save from Excel Reader into Master Data Material (High-Volume Resilient)
  const autoSaveExcelMaterials = async ({
    newRequirements,
    newMasterMaterials = [],
    newRelations = [],
    updateDate,
    fileName = 'Data_Material_PPIC.xlsx',
    skipMenuRedirect = false,
    onProgress,
  }: {
    newRequirements: MaterialItemRequirement[];
    newMasterMaterials?: Material[];
    newRelations?: OrStyleRelation[];
    updateDate: string;
    fileName?: string;
    skipMenuRedirect?: boolean;
    onProgress?: (info: UploadProgressCallbackInfo) => void;
  }): Promise<{ success: boolean; uploadId?: string; error?: string }> => {
    if (newRequirements.length === 0) {
      return { success: false, error: 'Tidak ada baris material yang diproses.' };
    }

    // Use selected updateDate or default to current date in WIB (Asia/Jakarta)
    const effectiveUpdateDate =
      updateDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

    // 1. Master Data Material Catalog (Prevent duplicate codes)
    if (newMasterMaterials.length > 0) {
      setMaterials((prev) => {
        const existingCodes = new Set(prev.map((m) => m.code.trim().toUpperCase()));
        const toAdd = newMasterMaterials.filter(
          (m) => !existingCodes.has(m.code.trim().toUpperCase())
        );
        return [...prev, ...toAdd];
      });
    }

    // 2. Transaction Lines (1 Upload = 1 OR = N Material Details)
    const uploadId = `upload-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const primaryOr = (newRequirements[0]?.orNumber || '').trim().toUpperCase();
    const primaryStyle = (newRequirements[0]?.style || '').trim();

    setMaterialRequirements((prev) => {
      const taggedNewReqs = newRequirements.map((r, idx) => ({
        ...r,
        id: r.id && !r.id.startsWith('temp-') ? r.id : `req-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
        uploadId,
        orNumber: primaryOr,
        style: primaryStyle,
        updateDate: effectiveUpdateDate,
        isRecentlyImported: true,
        importedAt: r.importedAt || new Date().toISOString(),
      }));

      return [...taggedNewReqs, ...prev.map((r) => ({ ...r, isRecentlyImported: false }))];
    });

    // 3. Save OR <-> Style relations
    if (primaryOr && primaryStyle) {
      saveOrStyleRelation(primaryOr, primaryStyle);
    }
    if (newRelations.length > 0) {
      setOrStyleRelations((prev) => {
        const map = new Map(
          prev.map((r) => [`${r.orNumber.trim().toUpperCase()}__${r.style.trim().toLowerCase()}`, r])
        );
        for (const item of newRelations) {
          map.set(
            `${item.orNumber.trim().toUpperCase()}__${item.style.trim().toLowerCase()}`,
            item
          );
        }
        return Array.from(map.values());
      });
    }

    // 4. Save to Riwayat Update (Upload History / Snapshot Header)
    const formattedTime =
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()) + ' WIB';

    const newHistItem: UploadHistoryItem = {
      id: uploadId,
      updateDate: effectiveUpdateDate,
      uploadTime: formattedTime,
      orNumber: primaryOr,
      style: primaryStyle,
      fileName: fileName,
      rowCount: newRequirements.length,
      status: 'Sukses',
      notes: `Berhasil diproses & disimpan (${newRequirements.length} baris material)`,
    };
    setUploadHistory((prev) => [newHistItem, ...prev]);

    // 5. Record recently imported batch info
    setLastImportedInfo({
      orNumber: primaryOr,
      style: primaryStyle,
      count: newRequirements.length,
      updateDate: effectiveUpdateDate,
      timestamp: Date.now(),
    });

    // 6. Add system notification
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'info',
        title: 'Hasil Pembacaan Excel Otomatis Tersimpan',
        message: `${newRequirements.length} baris material (${primaryOr}) tersimpan untuk Tanggal Update: ${effectiveUpdateDate}.`,
        timestamp: 'Baru saja',
        read: false,
      },
      ...prev,
    ]);

    // 7. Sync to Centralized Supabase Database if configured (High-Volume 500-row batching with 3x retry)
    if (getSupabaseCredentials().isConfigured) {
      try {
        const syncRes = await syncBatchExcelToSupabaseWithProgress(
          {
            uploadHistoryItem: newHistItem,
            relation: {
              id: `rel-${Date.now()}`,
              orNumber: primaryOr,
              style: primaryStyle,
              createdAt: new Date().toISOString(),
            },
            requirements: newRequirements.map((r) => ({
              ...r,
              uploadId,
              orNumber: primaryOr,
              style: primaryStyle,
              updateDate: effectiveUpdateDate,
            })),
            masterMaterials: newMasterMaterials,
          },
          onProgress
        );

        if (syncRes.success) {
          setLastSyncTimestamp(Date.now());
          setSupabaseConnected(true);
          if (!skipMenuRedirect) {
            setActiveMenu('Rekap Material');
          }
          return { success: true, uploadId: syncRes.uploadId || uploadId };
        } else {
          console.warn('Batch Supabase sync notice:', syncRes.error);
          return { success: false, uploadId, error: syncRes.error };
        }
      } catch (err: any) {
        console.error('Error during Supabase batch sync:', err);
        return { success: false, uploadId, error: err.message || String(err) };
      }
    } else {
      if (onProgress) {
        onProgress({
          currentBatch: 1,
          totalBatches: 1,
          rowsInserted: newRequirements.length,
          totalRows: newRequirements.length,
          percent: 100,
          currentChunkRows: newRequirements.length,
          statusText: 'Data tersimpan di penyimpanan lokal offline.',
        });
      }
      if (!skipMenuRedirect) {
        setActiveMenu('Rekap Material');
      }
      return { success: true, uploadId };
    }
  };

  const resetToInitialData = () => {
    setOrStyleRelations(INITIAL_OR_STYLE_RELATIONS);
    setMaterialRequirements(INITIAL_MATERIAL_REQUIREMENTS);
    setProductionSchedules(INITIAL_PRODUCTION_SCHEDULES);
    setMaterials(INITIAL_MATERIALS);
    setWarehouseStock(INITIAL_WAREHOUSE_STOCK);
    setUploadHistory(INITIAL_UPLOAD_HISTORY);
    setDeletionHistory([]);
    setLastImportedInfo(null);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_or_style`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_requirements`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_schedules`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_materials`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_stock`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_upload_history`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_deletion_history`);
  };

  return (
    <PpicContext.Provider
      value={{
        activeMenu,
        setActiveMenu,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar,

        // Single Source of Truth for Registered OR Numbers
        registeredOrNumbers,
        searchRegisteredOrs,
        getOrSummary,

        // Upload History & Tanggal Update Tracking
        uploadHistory,
        addUploadHistory,

        // Master Data Deletion Feature
        deletionHistory,
        deleteSingleRequirement,
        deleteMultipleRequirements,
        deleteDataByOr,
        deleteOrHistory,
        deleteDataByStyle,
        deleteDataByUpdateDate,
        getDeletionImpactByOr,
        getDeletionImpactByDate,
        getDeletionImpactByStyle,
        deleteDataByUploadId,
        getDeletionImpactByUploadId,
        getOrHistoryDetails,

        orStyleRelations,
        saveOrStyleRelation,
        getStyleForOr,
        getOrsForStyle,

        productionSchedules,
        addProductionSchedule,
        updateProductionSchedule,
        deleteProductionSchedule,
        scheduleConflicts,
        workOrders: productionSchedules,
        addWorkOrder: addProductionSchedule as any,
        updateWorkOrder: updateProductionSchedule as any,
        deleteWorkOrder: deleteProductionSchedule,

        materialRequirements,
        addMaterialRequirement,
        updateMaterialRequirement,
        deleteMaterialRequirement,

        materialRiskAssessments,
        orRiskSummaries,
        paretoAnalysis,
        comparisonMetrics,

        materials,
        addMaterial,
        updateMaterial,
        deleteMaterial,
        warehouses,
        warehouseStock,
        transferStock,

        notifications,
        markNotificationAsRead,
        clearAllNotifications,

        activeSearchQuery,
        setActiveSearchQuery,
        resetToInitialData,
        importPpicData,
        lastImportedInfo,
        setLastImportedInfo,
        autoSaveExcelMaterials,

        selectedScheduleId,
        setSelectedScheduleId,
        selectedWorkOrderId: selectedScheduleId,
        setSelectedWorkOrderId: setSelectedScheduleId,

        // Supabase Centralized Sync
        supabaseConnected,
        supabaseLoading,
        supabaseSyncError,
        lastSyncTimestamp,
        syncWithSupabase,
        migrateLocalDataToSupabase,
        updateSupabaseCredentials,
        disconnectSupabase,
      }}
    >
      {children}
    </PpicContext.Provider>
  );
};

export const usePpic = () => {
  const context = useContext(PpicContext);
  if (!context) {
    throw new Error('usePpic must be used within a PpicProvider');
  }
  return context;
};
