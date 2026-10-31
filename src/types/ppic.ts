export type MaterialCategory = 'Raw Material' | 'Packaging' | 'Chemical' | 'Auxiliary';

export type MaterialUnit = 'Kg' | 'Pcs' | 'Roll' | 'Drum' | 'Box' | 'Liter' | 'Yard' | 'Meter';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Material {
  id: string;
  code: string;
  name: string;
  category: MaterialCategory;
  unit: MaterialUnit;
  totalStock: number;
  allocatedStock: number;
  safetyStock: number;
  leadTimeDays: number;
  supplierName: string;
  defaultWarehouse: string;
  unitPrice: number; // in IDR
  minOrderQty: number;
  // OR & Material Requirement linkage
  orNumber?: string;
  style?: string;
  requiredQty?: number; // Kebutuhan Material
  receivedQty?: number; // Jumlah Material Diterima
}

export interface OrStyleRelation {
  id: string;
  orNumber: string;
  style: string;
  createdAt: string;
}

export interface ProductionSchedule {
  id: string;
  orNumber: string;
  productionDate: string; // YYYY-MM-DD (Tanggal Produksi / Mulai)
  finishDate: string; // YYYY-MM-DD (Tanggal Selesai)
  productionLine: string; // Line 1, Line 2, Line 3, etc.
  style: string;
  target: number; // Positif
  status?: 'Terjadwal' | 'Sedang Berjalan' | 'Selesai' | 'Tertunda';
  notes?: string;
}

// Backward compatibility alias
export type WorkOrder = ProductionSchedule;

export interface MaterialItemRequirement {
  id: string;
  orNumber: string;
  style: string;
  materialCode: string;
  materialName: string;
  category: MaterialCategory;
  unit: MaterialUnit;
  requiredQty: number; // Kebutuhan
  receivedQty: number; // Diterima
  unitPrice: number;
  supplierName?: string;
}

export interface ScheduleConflict {
  scheduleId: string;
  orNumber: string;
  line: string;
  productionDate: string;
  finishDate: string;
  conflictingWith: Array<{
    id: string;
    orNumber: string;
    style: string;
    productionDate: string;
    finishDate: string;
  }>;
}

export interface MaterialRiskAssessment {
  id: string;
  orNumber: string;
  style: string;
  materialCode: string;
  materialName: string;
  category: MaterialCategory;
  unit: MaterialUnit;
  requiredQty: number;
  receivedQty: number;
  shortageQty: number;
  shortageRatio: number; // percentage 0-100%
  shortageScore: number; // 0, 25, 50, 75, 100
  productionDate: string;
  finishDate: string;
  productionLine: string;
  daysToProduction: number; // distance in days from today
  urgencyScore: number; // 0, 25, 50, 75, 100
  riskScore: number; // (60% x shortageScore) + (40% x urgencyScore)
  riskCategory: RiskLevel;
  hasSchedule: boolean;
  isCompleteData: boolean;
  recommendedAction: string;
}

export interface OrRiskSummary {
  orNumber: string;
  style: string;
  productionDate: string;
  finishDate: string;
  productionLine: string;
  totalMaterials: number;
  readyMaterialsCount: number;
  notReadyMaterialsCount: number;
  highestRiskScore: number;
  highestRiskCategory: RiskLevel;
  averageRiskScore: number;
  materials: MaterialRiskAssessment[];
  hasSchedule: boolean;
}

export interface ParetoItem {
  materialCode: string;
  materialName: string;
  unit: MaterialUnit;
  shortageQty: number;
  shortageValue: number; // shortageQty * unitPrice
  contributionPercent: number; // % of total shortage value
  cumulativePercent: number; // cumulative %
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  location: string;
  capacityMax: number;
  capacityUsed: number;
  manager: string;
}

export interface WarehouseStockItem {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  warehouseCode: string;
  batchLot: string;
  qty: number;
  unit: MaterialUnit;
  binLocation: string;
  expiryDate: string;
  qcStatus: 'Approved' | 'Quarantine' | 'Rejected';
}

export interface StockTransferPayload {
  materialId: string;
  fromWarehouse: string;
  toWarehouse: string;
  qty: number;
  batchLot?: string;
  reason: string;
  requestedBy: string;
}

export interface ProductionSimulationConfig {
  demandMultiplier: number;
  leadTimeDelayDays: number;
  transferQcTransit: boolean;
}
