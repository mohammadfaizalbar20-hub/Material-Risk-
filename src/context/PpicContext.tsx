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
  }) => void;

  // Master Data Deletion Feature
  deletionHistory: DeletionHistoryItem[];
  deleteDataByOr: (orNumber: string) => { success: boolean; deletedCount: number; message: string };
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
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_requirements`, JSON.stringify(materialRequirements));
    } catch (e) {
      console.error(e);
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
  const deleteDataByOr = (orNumber: string) => {
    const clean = (orNumber || '').trim().toUpperCase();
    const rowsToDelete = materialRequirements.filter((r) => r.orNumber.trim().toUpperCase() === clean);
    const rowCount = rowsToDelete.length;
    const styleName = getStyleForOr(clean) || rowsToDelete[0]?.style || '-';

    if (rowCount === 0 && !uploadHistory.some((h) => h.orNumber.trim().toUpperCase() === clean)) {
      return { success: false, deletedCount: 0, message: `Tidak ditemukan data transaksi untuk ${clean}.` };
    }

    // 1. Remove from materialRequirements
    setMaterialRequirements((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== clean));

    // 2. Remove from uploadHistory
    setUploadHistory((prev) => prev.filter((h) => h.orNumber.trim().toUpperCase() !== clean));

    // 3. Remove relation from orStyleRelations
    setOrStyleRelations((prev) => prev.filter((r) => r.orNumber.trim().toUpperCase() !== clean));

    // 4. Remove matching production schedules so no dangling invalid schedule remains
    setProductionSchedules((prev) => prev.filter((s) => s.orNumber.trim().toUpperCase() !== clean));

    // 5. Record in deletionHistory audit log
    const nowWib = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date()) + ' WIB';

    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowWib,
      method: 'BY_OR',
      methodLabel: 'Berdasarkan Nomor OR',
      targetValue: clean,
      targetDetails: `Style: ${styleName}`,
      deletedRowCount: rowCount,
      affectedOrs: [clean],
      user: 'Tim PPIC (Terautentikasi)',
    };

    setDeletionHistory((prev) => [newRecord, ...prev]);

    // 6. System notification
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

    return {
      success: true,
      deletedCount: rowCount,
      message: `Data transaksi ${clean} (${rowCount} baris material) berhasil dihapus permanen.`,
    };
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
    const nowWib = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date()) + ' WIB';

    const newRecord: DeletionHistoryItem = {
      id: `del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowWib,
      method: 'BY_DATE',
      methodLabel: 'Berdasarkan Tanggal Update',
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
    return partial ? partial.style : null;
  };

  const getOrsForStyle = (style: string): string[] => {
    const clean = (style || '').trim().toLowerCase();
    if (!clean) return [];
    // 1. Exact matches first
    const exact = orStyleRelations.filter((r) => r.style.toLowerCase() === clean);
    if (exact.length > 0) {
      return Array.from(new Set(exact.map((m) => m.orNumber)));
    }
    // 2. Partial/substring matches if >= 3 characters
    if (clean.length >= 3) {
      const partials = orStyleRelations.filter((r) => r.style.toLowerCase().includes(clean));
      return Array.from(new Set(partials.map((m) => m.orNumber)));
    }
    return [];
  };

  // Schedule conflicts detection (Reactive)
  const scheduleConflicts = useMemo(() => {
    return detectScheduleConflicts(productionSchedules);
  }, [productionSchedules]);

  // Material Risk Analysis & OR Summaries (Reactive based on schedules and requirements)
  const { materialAssessments: materialRiskAssessments, orSummaries: orRiskSummaries } = useMemo(() => {
    return assessAllMaterialRisks(materialRequirements, productionSchedules, new Date());
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

    return newSch;
  };

  const updateProductionSchedule = (id: string, updates: Partial<ProductionSchedule>) => {
    setProductionSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
    if (updates.orNumber && updates.style) {
      saveOrStyleRelation(updates.orNumber, updates.style);
    }
  };

  const deleteProductionSchedule = (id: string) => {
    setProductionSchedules((prev) => prev.filter((s) => s.id !== id));
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

  // Direct Automatic Save from Excel Reader into Master Data Material
  const autoSaveExcelMaterials = ({
    newRequirements,
    newMasterMaterials = [],
    newRelations = [],
    updateDate,
    fileName = 'Data_Material_PPIC.xlsx',
  }: {
    newRequirements: MaterialItemRequirement[];
    newMasterMaterials?: Material[];
    newRelations?: OrStyleRelation[];
    updateDate: string;
    fileName?: string;
  }) => {
    if (newRequirements.length === 0) return;

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

    // 2. Transaction Lines (Preserve distinct transaction per OR and historical update dates)
    // "Jika material dan Nomor OR yang sama diunggah kembali pada tanggal berbeda, simpan sebagai update/transaksi pada tanggal baru. Jangan menghapus riwayat data tanggal sebelumnya. Hindari duplikasi akibat pengulangan upload file yang sama pada tanggal yang sama."
    const targetOrs = new Set(newRequirements.map((r) => r.orNumber.trim().toUpperCase()));

    setMaterialRequirements((prev) => {
      // Remove only previous lines for the SAME OR on the SAME updateDate (so re-uploads on the same day update that day's data)
      // Keep earlier or later updateDates for that same OR intact for daily progress comparison!
      const kept = prev
        .filter((r) => {
          const isSameOr = targetOrs.has(r.orNumber.trim().toUpperCase());
          const isSameDate = (r.updateDate || '') === effectiveUpdateDate;
          return !(isSameOr && isSameDate);
        })
        .map((r) => ({ ...r, isRecentlyImported: false }));

      const taggedNewReqs = newRequirements.map((r) => ({
        ...r,
        updateDate: effectiveUpdateDate,
        isRecentlyImported: true,
        importedAt: r.importedAt || new Date().toISOString(),
      }));

      return [...taggedNewReqs, ...kept];
    });

    // 3. Save OR <-> Style relations
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

    // 4. Save to Riwayat Update (Upload History)
    const primaryOr = newRequirements[0]?.orNumber || '';
    const primaryStyle = newRequirements[0]?.style || '';
    const formattedTime =
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()) + ' WIB';

    const newHistItem: UploadHistoryItem = {
      id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      updateDate: effectiveUpdateDate,
      uploadTime: formattedTime,
      orNumber: primaryOr,
      style: primaryStyle,
      fileName: fileName,
      rowCount: newRequirements.length,
      status: 'Sukses',
      notes: `Berhasil diproses & disimpan untuk tanggal update ${effectiveUpdateDate}`,
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

    // 7. Direct automatic navigation to Master Data Material
    setActiveMenu('Rekap Material');
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
        deleteDataByOr,
        deleteDataByUpdateDate,
        getDeletionImpactByOr,
        getDeletionImpactByDate,

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
