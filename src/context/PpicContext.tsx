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
} from '../types/ppic';
import {
  INITIAL_MATERIALS,
  INITIAL_WAREHOUSES,
  INITIAL_WAREHOUSE_STOCK,
  INITIAL_PRODUCTION_SCHEDULES,
  INITIAL_OR_STYLE_RELATIONS,
  INITIAL_MATERIAL_REQUIREMENTS,
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

  const resetToInitialData = () => {
    setOrStyleRelations(INITIAL_OR_STYLE_RELATIONS);
    setMaterialRequirements(INITIAL_MATERIAL_REQUIREMENTS);
    setProductionSchedules(INITIAL_PRODUCTION_SCHEDULES);
    setMaterials(INITIAL_MATERIALS);
    setWarehouseStock(INITIAL_WAREHOUSE_STOCK);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_or_style`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_requirements`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_schedules`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_materials`);
    localStorage.removeItem(`${LOCAL_STORAGE_KEY}_stock`);
  };

  return (
    <PpicContext.Provider
      value={{
        activeMenu,
        setActiveMenu,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar,

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
