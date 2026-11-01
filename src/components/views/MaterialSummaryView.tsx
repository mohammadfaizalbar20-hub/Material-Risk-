import React, { useState, useMemo } from 'react';
import { usePpic } from '../../context/PpicContext';
import { MaterialItemRequirement, Material, MaterialCategory, MaterialUnit } from '../../types/ppic';
import * as XLSX from 'xlsx';
import {
  Boxes,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
  FileCheck,
  Tag,
  Hash,
  Sparkles,
  Layers,
  ArrowUpDown,
  Trash2,
  Edit2,
  Info,
  Calendar,
  GitCompare,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';

export const MaterialSummaryView: React.FC = () => {
  const {
    materials,
    materialRequirements,
    registeredOrNumbers,
    searchRegisteredOrs,
    getOrSummary,
    addMaterialRequirement,
    updateMaterialRequirement,
    deleteMaterialRequirement,
    addMaterial,
    updateMaterial,
    deleteMaterial,
    setActiveMenu,
    lastImportedInfo,
    setLastImportedInfo,
    activeSearchQuery,
    setActiveSearchQuery,
  } = usePpic();

  // Active view tab:
  // - 'REQUIREMENTS' (Master Data Material Transaksi OR)
  // - 'DAILY_DIFF' (Komparasi Perkembangan Tanggal)
  // - 'CATALOG' (Katalog Bahan Baku & Stok Fisik)
  const [activeTab, setActiveTab] = useState<'REQUIREMENTS' | 'DAILY_DIFF' | 'CATALOG'>('REQUIREMENTS');

  // Filters for Master Data Material Requirements Table
  const [selectedOrFilter, setSelectedOrFilter] = useState<string>('ALL');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'READY' | 'BELUM_READY'>('ALL');
  const [onlyRecentFilter, setOnlyRecentFilter] = useState<boolean>(false);

  // Modal states
  const [addReqModalOpen, setAddReqModalOpen] = useState<boolean>(false);
  const [editingReq, setEditingReq] = useState<MaterialItemRequirement | null>(null);

  // Form data for Requirement modal
  const [reqFormData, setReqFormData] = useState<{
    orNumber: string;
    style: string;
    materialCode: string;
    materialName: string;
    category: MaterialCategory;
    unit: MaterialUnit;
    requiredQty: number;
    receivedQty: number;
    unitPrice: number;
    supplierName: string;
    updateDate: string;
  }>({
    orNumber: 'OR-2026-001',
    style: '',
    materialCode: '',
    materialName: '',
    category: 'Raw Material',
    unit: 'Kg',
    requiredQty: 1000,
    receivedQty: 1000,
    unitPrice: 25000,
    supplierName: '',
    updateDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  });

  // Daily Comparison State (Komparasi Perkembangan Antar Tanggal)
  const [compareOr, setCompareOr] = useState<string>(registeredOrNumbers[0] || 'OR-2026-001');

  // Distinct Update Dates available across requirements
  const availableUpdateDates = useMemo(() => {
    const set = new Set(materialRequirements.map((r) => r.updateDate).filter(Boolean) as string[]);
    return Array.from(set).sort().reverse();
  }, [materialRequirements]);

  // Master Data Material Rows with calculated Kekurangan & Status
  // Rumus wajib:
  // Kekurangan = Diterima - Kebutuhan
  // READY jika Kekurangan >= 0
  // BELUM READY jika Kekurangan < 0
  const processedRequirements = useMemo(() => {
    return materialRequirements.map((req) => {
      const shortage = req.receivedQty - req.requiredQty; // Kekurangan = Diterima - Kebutuhan
      const isReady = shortage >= 0;
      return {
        ...req,
        shortage,
        isReady,
        statusLabel: isReady ? 'READY' : 'BELUM READY',
        effectiveDate: req.updateDate || '2026-10-31',
      };
    });
  }, [materialRequirements]);

  // Filtered requirements
  const filteredRequirements = useMemo(() => {
    return processedRequirements.filter((r) => {
      // 1. Search Query
      const q = activeSearchQuery.toLowerCase();
      if (q) {
        const matchCode = r.materialCode.toLowerCase().includes(q);
        const matchName = r.materialName.toLowerCase().includes(q);
        const matchOr = r.orNumber.toLowerCase().includes(q);
        const matchStyle = r.style.toLowerCase().includes(q);
        const matchSupplier = (r.supplierName || '').toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchOr && !matchStyle && !matchSupplier) {
          return false;
        }
      }

      // 2. OR Filter (Single source of truth)
      if (selectedOrFilter !== 'ALL' && r.orNumber.toUpperCase() !== selectedOrFilter.toUpperCase()) {
        return false;
      }

      // 3. Tanggal Update Filter
      if (selectedDateFilter !== 'ALL' && r.effectiveDate !== selectedDateFilter) {
        return false;
      }

      // 4. Status Filter
      if (statusFilter === 'READY' && !r.isReady) return false;
      if (statusFilter === 'BELUM_READY' && r.isReady) return false;

      // 5. Only recent filter
      if (onlyRecentFilter && !r.isRecentlyImported) return false;

      return true;
    });
  }, [processedRequirements, activeSearchQuery, selectedOrFilter, selectedDateFilter, statusFilter, onlyRecentFilter]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const total = filteredRequirements.length;
    const ready = filteredRequirements.filter((r) => r.isReady).length;
    const notReady = total - ready;
    const totalRequired = filteredRequirements.reduce((sum, r) => sum + r.requiredQty, 0);
    const totalReceived = filteredRequirements.reduce((sum, r) => sum + r.receivedQty, 0);
    const recentlyImportedCount = filteredRequirements.filter((r) => r.isRecentlyImported).length;

    return {
      total,
      ready,
      notReady,
      readyPercent: total > 0 ? Math.round((ready / total) * 100) : 0,
      notReadyPercent: total > 0 ? Math.round((notReady / total) * 100) : 0,
      totalRequired,
      totalReceived,
      recentlyImportedCount,
    };
  }, [filteredRequirements]);

  // Comparison logic for Daily Diff (Komparasi Perkembangan Tanggal)
  const comparisonData = useMemo(() => {
    const orReqs = materialRequirements.filter(
      (r) => r.orNumber.trim().toUpperCase() === compareOr.trim().toUpperCase()
    );

    // Get unique dates for this OR
    const dates = Array.from(new Set(orReqs.map((r) => r.updateDate || '2026-10-31'))).sort();

    const dateA = dates[0] || '2026-10-25';
    const dateB = dates[dates.length - 1] || '2026-10-31';

    const reqsA = orReqs.filter((r) => (r.updateDate || '2026-10-31') === dateA);
    const reqsB = orReqs.filter((r) => (r.updateDate || '2026-10-31') === dateB);

    // Group by materialCode
    const codes = Array.from(new Set([...reqsA.map((r) => r.materialCode), ...reqsB.map((r) => r.materialCode)]));

    const rows = codes.map((code) => {
      const itemA = reqsA.find((r) => r.materialCode === code);
      const itemB = reqsB.find((r) => r.materialCode === code);

      const reqA = itemA?.requiredQty ?? 0;
      const recA = itemA?.receivedQty ?? 0;
      const shortA = recA - reqA;
      const readyA = shortA >= 0;

      const reqB = itemB?.requiredQty ?? 0;
      const recB = itemB?.receivedQty ?? 0;
      const shortB = recB - reqB;
      const readyB = shortB >= 0;

      const diffReceived = recB - recA;
      const diffShortage = shortB - shortA;

      return {
        materialCode: code,
        materialName: itemB?.materialName || itemA?.materialName || code,
        unit: itemB?.unit || itemA?.unit || 'Kg',
        dateA,
        dateB,
        reqA,
        recA,
        shortA,
        readyA,
        reqB,
        recB,
        shortB,
        readyB,
        diffReceived,
        diffShortage,
      };
    });

    return {
      dateA,
      dateB,
      datesAvailable: dates,
      rows,
      hasMultipleDates: dates.length > 1,
    };
  }, [materialRequirements, compareOr]);

  // Handlers for modal
  const handleOpenAddModal = () => {
    setEditingReq(null);
    setReqFormData({
      orNumber: selectedOrFilter !== 'ALL' ? selectedOrFilter : registeredOrNumbers[0] || 'OR-2026-001',
      style: '',
      materialCode: '',
      materialName: '',
      category: 'Raw Material',
      unit: 'Kg',
      requiredQty: 1000,
      receivedQty: 500,
      unitPrice: 25000,
      supplierName: '',
      updateDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
    });
    setAddReqModalOpen(true);
  };

  const handleOpenEditModal = (req: MaterialItemRequirement) => {
    setEditingReq(req);
    setReqFormData({
      orNumber: req.orNumber,
      style: req.style,
      materialCode: req.materialCode,
      materialName: req.materialName,
      category: req.category,
      unit: req.unit,
      requiredQty: req.requiredQty,
      receivedQty: req.receivedQty,
      unitPrice: req.unitPrice,
      supplierName: req.supplierName || '',
      updateDate: req.updateDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
    });
    setAddReqModalOpen(true);
  };

  const handleSubmitReqForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqFormData.materialCode || !reqFormData.materialName || !reqFormData.orNumber) return;

    if (editingReq) {
      updateMaterialRequirement(editingReq.id, reqFormData);
    } else {
      addMaterialRequirement(reqFormData);
    }
    setAddReqModalOpen(false);
  };

  // Export exact Master Data Material table to Excel
  const handleExportMasterDataExcel = () => {
    const wb = XLSX.utils.book_new();
    const exportData = filteredRequirements.map((r) => ({
      'Tanggal Update': r.effectiveDate,
      'Kode Material': r.materialCode,
      'Nama Material': r.materialName,
      'Satuan': r.unit,
      'Nomor OR Terkait': r.orNumber,
      'Style Terkait': r.style,
      'Kebutuhan': r.requiredQty,
      'Diterima': r.receivedQty,
      'Kekurangan': r.shortage,
      'Status': r.statusLabel,
      'Kategori': r.category,
      'Supplier': r.supplierName || '-',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Master_Data_Material');
    XLSX.writeFile(wb, `Master_Data_Material_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Master Data Material Header */}
      <div className="p-5 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 mb-1.5">
            <Boxes className="w-3.5 h-3.5" />
            Master Data Material PPIC
          </div>
          <h2 className="text-base md:text-lg font-bold text-slate-900">
            Master Data Material & Kesiapan Produksi
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Hasil pembacaan Excel otomatis per <strong>Tanggal Update</strong>: Kebutuhan, Diterima, Kekurangan (<code>Diterima - Kebutuhan</code>), serta status <strong>READY</strong> atau <strong>BELUM READY</strong> per baris transaksi OR.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveMenu('Upload Excel')}
            className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Unggah File Excel
          </button>
          <button
            onClick={handleExportMasterDataExcel}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Ekspor Excel (.xlsx)
          </button>
          <button
            onClick={handleOpenAddModal}
            className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tambah Baris Manual
          </button>
        </div>
      </div>

      {/* Prominent Banner for Newly Read/Saved Excel Data */}
      {lastImportedInfo && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-950 flex items-center gap-2">
                <span>Data Excel Berhasil Dibaca & Disimpan Otomatis ke Master Data Material</span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-200 text-emerald-900 rounded-full">
                  {lastImportedInfo.count} Baris Transaksi
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-100 text-blue-800 rounded-full flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {lastImportedInfo.updateDate}
                </span>
              </div>
              <p className="text-xs text-emerald-800 mt-0.5">
                Nomor OR: <strong className="font-mono">{lastImportedInfo.orNumber}</strong> {lastImportedInfo.style && `· Style: ${lastImportedInfo.style}`}. Data langsung aktif dan terhubung ke seluruh sistem.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setSelectedOrFilter(lastImportedInfo.orNumber);
                setSelectedDateFilter(lastImportedInfo.updateDate);
                setOnlyRecentFilter(true);
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-md shadow-2xs transition-colors cursor-pointer"
            >
              Filter Data Baru Ini
            </button>
            <button
              onClick={() => {
                setSelectedOrFilter('ALL');
                setSelectedDateFilter('ALL');
                setOnlyRecentFilter(false);
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 rounded transition-colors cursor-pointer"
            >
              Tampilkan Semua
            </button>
            <button
              onClick={() => setLastImportedInfo(null)}
              className="p-1 text-emerald-600 hover:text-emerald-900 rounded cursor-pointer"
              title="Tutup pemberitahuan"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-medium text-slate-500">Total Baris Transaksi</div>
          <div className="text-xl md:text-2xl font-bold font-mono text-slate-900 mt-1">
            {metrics.total.toLocaleString('id-ID')}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {registeredOrNumbers.length} Nomor OR terdaftar (Single Source of Truth)
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Status READY (Kekurangan ≥ 0)
          </div>
          <div className="text-xl md:text-2xl font-bold font-mono text-emerald-700 mt-1">
            {metrics.ready.toLocaleString('id-ID')}
            <span className="text-xs font-normal text-emerald-600 ml-1.5">({metrics.readyPercent}%)</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Material siap untuk proses produksi
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-medium text-red-700 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Status BELUM READY (Kekurangan &lt; 0)
          </div>
          <div className="text-xl md:text-2xl font-bold font-mono text-red-700 mt-1">
            {metrics.notReady.toLocaleString('id-ID')}
            <span className="text-xs font-normal text-red-600 ml-1.5">({metrics.notReadyPercent}%)</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Perlu pemenuhan penerimaan material
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-medium text-blue-700 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Tanggal Update Terdata
          </div>
          <div className="text-xl md:text-2xl font-bold font-mono text-blue-700 mt-1">
            {availableUpdateDates.length} Tanggal
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Terbaru: {availableUpdateDates[0] || '-'}
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('REQUIREMENTS')}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === 'REQUIREMENTS'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Boxes className="w-4 h-4" />
          Master Data Material (Kebutuhan & Status Kesiapan OR)
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-800 font-mono">
            {materialRequirements.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('DAILY_DIFF')}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === 'DAILY_DIFF'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <GitCompare className="w-4 h-4 text-emerald-600" />
          Komparasi Perkembangan Antar Tanggal
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
            Daily Diff
          </span>
        </button>

        <button
          onClick={() => setActiveTab('CATALOG')}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === 'CATALOG'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          Katalog Master Material & Stok Fisik
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-700 font-mono">
            {materials.length}
          </span>
        </button>
      </div>

      {/* TAB 1: MASTER DATA MATERIAL TRANSACTION TABLE */}
      {activeTab === 'REQUIREMENTS' && (
        <div className="space-y-4">
          {/* Filter Toolbar */}
          <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Filter 1: Nomor OR (Single Source of Truth) */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-blue-600" />
                    Nomor OR:
                  </span>
                  <select
                    value={selectedOrFilter}
                    onChange={(e) => setSelectedOrFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none font-semibold text-slate-900"
                  >
                    <option value="ALL">Semua Nomor OR ({registeredOrNumbers.length})</option>
                    {registeredOrNumbers.map((or) => (
                      <option key={or} value={or}>
                        {or}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filter 2: Tanggal Update */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    Tanggal Update:
                  </span>
                  <select
                    value={selectedDateFilter}
                    onChange={(e) => setSelectedDateFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="ALL">Semua Tanggal ({availableUpdateDates.length})</option>
                    {availableUpdateDates.map((dt) => (
                      <option key={dt} value={dt}>
                        {dt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filter 3: Status READY / BELUM READY */}
                <div className="flex items-center gap-1">
                  {[
                    { id: 'ALL', label: 'Semua Status' },
                    { id: 'READY', label: 'READY (≥ 0)' },
                    { id: 'BELUM_READY', label: 'BELUM READY (< 0)' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setStatusFilter(f.id as any)}
                      className={`px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${
                        statusFilter === f.id
                          ? f.id === 'READY'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold'
                            : f.id === 'BELUM_READY'
                            ? 'bg-red-50 text-red-800 border-red-300 font-semibold'
                            : 'bg-slate-900 text-white border-slate-900 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Filter 4: Data Baru Dibaca Toggle */}
                {metrics.recentlyImportedCount > 0 && (
                  <button
                    onClick={() => setOnlyRecentFilter(!onlyRecentFilter)}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      onlyRecentFilter
                        ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                        : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 font-medium'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Baru Dibaca ({metrics.recentlyImportedCount})
                  </button>
                )}
              </div>

              {/* Live search input */}
              <div className="relative min-w-[240px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={activeSearchQuery}
                  onChange={(e) => setActiveSearchQuery(e.target.value)}
                  placeholder="Cari kode, nama, OR, style..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <div>
                Menampilkan <strong className="text-slate-900">{filteredRequirements.length}</strong> dari {materialRequirements.length} baris transaksi material
                {selectedOrFilter !== 'ALL' && (
                  <span className="ml-2 font-mono text-blue-700 font-semibold">
                    [OR: {selectedOrFilter}]
                  </span>
                )}
                {selectedDateFilter !== 'ALL' && (
                  <span className="ml-2 font-mono text-emerald-700 font-semibold">
                    [Tanggal: {selectedDateFilter}]
                  </span>
                )}
              </div>

              {(selectedOrFilter !== 'ALL' || selectedDateFilter !== 'ALL' || statusFilter !== 'ALL' || onlyRecentFilter || activeSearchQuery) && (
                <button
                  onClick={() => {
                    setSelectedOrFilter('ALL');
                    setSelectedDateFilter('ALL');
                    setStatusFilter('ALL');
                    setOnlyRecentFilter(false);
                    setActiveSearchQuery('');
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer"
                >
                  Reset Semua Filter
                </button>
              )}
            </div>
          </div>

          {/* MAIN MASTER DATA MATERIAL TABLE */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-3 px-3 w-10 text-center">#</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Tanggal Update</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Kode Material</th>
                    <th className="py-3 px-3.5">Nama Material</th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">Satuan</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Nomor OR Terkait</th>
                    <th className="py-3 px-3.5">Style Terkait</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Kebutuhan</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Diterima</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap bg-slate-100/60 font-bold">
                      Kekurangan
                      <span className="block text-[10px] font-normal text-slate-500">
                        (Diterima - Kebutuhan)
                      </span>
                    </th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap">Status Kesiapan</th>
                    <th className="py-3 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequirements.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-slate-400 text-xs">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Boxes className="w-8 h-8 text-slate-300" />
                          <span className="font-medium text-slate-600">
                            Tidak ada data material yang sesuai kriteria filter.
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Unggah berkas Excel atau klik reset filter untuk melihat seluruh data.
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRequirements.map((row, idx) => {
                      const isShortage = row.shortage < 0;
                      return (
                        <tr
                          key={row.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            row.isRecentlyImported
                              ? 'bg-blue-50/30 border-l-4 border-l-blue-500'
                              : ''
                          }`}
                        >
                          {/* Row Index */}
                          <td className="py-3 px-3 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>

                          {/* Tanggal Update */}
                          <td className="py-3 px-3.5 font-mono text-slate-700 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px]">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              {row.effectiveDate}
                            </span>
                          </td>

                          {/* 1. Kode Material */}
                          <td className="py-3 px-3.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{row.materialCode}</span>
                              {row.isRecentlyImported && (
                                <span className="px-1.5 py-0.5 text-[9px] font-sans font-bold bg-blue-100 text-blue-700 rounded-full">
                                  Baru Dibaca
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 2. Nama Material */}
                          <td className="py-3 px-3.5 font-medium text-slate-900 min-w-[200px]">
                            <div>{row.materialName}</div>
                            {row.supplierName && (
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {row.supplierName}
                              </div>
                            )}
                          </td>

                          {/* 3. Satuan */}
                          <td className="py-3 px-3 text-center font-mono font-medium text-slate-700 whitespace-nowrap">
                            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                              {row.unit}
                            </span>
                          </td>

                          {/* 4. Nomor OR terkait */}
                          <td className="py-3 px-3.5 font-mono font-semibold text-blue-700 whitespace-nowrap">
                            <button
                              onClick={() => setSelectedOrFilter(row.orNumber)}
                              className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200 transition-colors cursor-pointer"
                              title="Klik untuk filter nomor OR ini"
                            >
                              {row.orNumber}
                            </button>
                          </td>

                          {/* 5. Style terkait */}
                          <td className="py-3 px-3.5 text-slate-700 min-w-[180px]">
                            {row.style || '-'}
                          </td>

                          {/* 6. Kebutuhan */}
                          <td className="py-3 px-3.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {row.requiredQty.toLocaleString('id-ID')}
                          </td>

                          {/* 7. Diterima */}
                          <td className="py-3 px-3.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {row.receivedQty.toLocaleString('id-ID')}
                          </td>

                          {/* 8. Kekurangan (Rumus: Diterima - Kebutuhan) */}
                          <td
                            className={`py-3 px-3.5 text-right font-mono font-bold whitespace-nowrap ${
                              isShortage
                                ? 'text-red-700 bg-red-50/70'
                                : row.shortage === 0
                                ? 'text-slate-800 bg-slate-50'
                                : 'text-emerald-700 bg-emerald-50/70'
                            }`}
                          >
                            {row.shortage > 0 ? `+${row.shortage.toLocaleString('id-ID')}` : row.shortage.toLocaleString('id-ID')} {row.unit}
                          </td>

                          {/* 9. Status READY / BELUM READY */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {row.isReady ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                READY
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300 shadow-2xs">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                                BELUM READY
                              </span>
                            )}
                          </td>

                          {/* Action Menu */}
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditModal(row)}
                                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded cursor-pointer"
                                title="Edit baris kebutuhan"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`Hapus baris kebutuhan ${row.materialCode} (${row.orNumber})?`)) {
                                    deleteMaterialRequirement(row.id);
                                  }
                                }}
                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded cursor-pointer"
                                title="Hapus baris kebutuhan"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: KOMPARASI PERKEMBANGAN ANTAR TANGGAL (DAILY DIFF) */}
      {activeTab === 'DAILY_DIFF' && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Komparasi Perkembangan Kebutuhan & Penerimaan Antar Tanggal Update
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Bandingkan data material antar tanggal untuk melacak perubahan Kebutuhan, penambahan material Diterima, dan pengurangan defisit material.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-700">Pilih Nomor OR:</label>
              <select
                value={compareOr}
                onChange={(e) => setCompareOr(e.target.value)}
                className="px-3 py-1.5 text-xs font-mono font-bold text-blue-700 border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500"
              >
                {registeredOrNumbers.map((or) => (
                  <option key={or} value={or}>
                    {or}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Comparison Summary Header */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-700">Periode Perbandingan:</span>
              <div className="flex items-center gap-2 font-mono">
                <span className="px-2.5 py-1 bg-white border border-slate-300 rounded text-slate-800 font-bold">
                  {comparisonData.dateA}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-400" />
                <span className="px-2.5 py-1 bg-blue-50 border border-blue-300 rounded text-blue-800 font-bold">
                  {comparisonData.dateB} (Terbaru)
                </span>
              </div>
            </div>

            <div className="text-[11px] text-slate-500">
              {comparisonData.hasMultipleDates ? (
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ditemukan riwayat pembaruan antar tanggal untuk OR {compareOr}.
                </span>
              ) : (
                <span className="text-slate-500">
                  OR ini baru memiliki 1 tanggal update. Unggah kembali di tanggal lain untuk melihat perbandingan dinamis.
                </span>
              )}
            </div>
          </div>

          {/* Comparison Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/80 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">Kode Material</th>
                  <th className="py-2.5 px-3">Nama Material</th>
                  <th className="py-2.5 px-3 text-center">Satuan</th>
                  <th className="py-2.5 px-3 text-right bg-slate-50">Diterima ({comparisonData.dateA})</th>
                  <th className="py-2.5 px-3 text-right bg-blue-50/50">Diterima ({comparisonData.dateB})</th>
                  <th className="py-2.5 px-3 text-right font-bold">Perubahan Diterima</th>
                  <th className="py-2.5 px-3 text-right">Kebutuhan</th>
                  <th className="py-2.5 px-3 text-center">Status Awal</th>
                  <th className="py-2.5 px-3 text-center">Status Akhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {comparisonData.rows.map((row) => (
                  <tr key={row.materialCode} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{row.materialCode}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-800">{row.materialName}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600">{row.unit}</td>

                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 bg-slate-50">
                      {row.recA.toLocaleString('id-ID')}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700 bg-blue-50/50">
                      {row.recB.toLocaleString('id-ID')}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono font-bold">
                      {row.diffReceived > 0 ? (
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                          +{row.diffReceived.toLocaleString('id-ID')} {row.unit}
                        </span>
                      ) : row.diffReceived === 0 ? (
                        <span className="text-slate-400">0</span>
                      ) : (
                        <span className="text-red-600">
                          {row.diffReceived.toLocaleString('id-ID')} {row.unit}
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                      {row.reqB.toLocaleString('id-ID')}
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${row.readyA ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                        {row.readyA ? 'READY' : 'BELUM READY'}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${row.readyB ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                        {row.readyB ? 'READY' : 'BELUM READY'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: MASTER MATERIAL CATALOG */}
      {activeTab === 'CATALOG' && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                Katalog Master Material ({materials.length} Item Terdaftar)
              </h3>
              <p className="text-[11px] text-slate-500">
                Data master bahan baku dan saldo stok fisik (bebas duplikasi kode material).
              </p>
            </div>
            <button
              onClick={() => {
                const code = `RM-${Math.floor(100 + Math.random() * 900)}`;
                addMaterial({
                  code,
                  name: 'Material Baru',
                  category: 'Raw Material',
                  unit: 'Kg',
                  totalStock: 1000,
                  allocatedStock: 0,
                  safetyStock: 300,
                  leadTimeDays: 7,
                  supplierName: 'PT Mitra Material Baru',
                  defaultWarehouse: 'WH-01',
                  unitPrice: 25000,
                  minOrderQty: 100,
                });
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-xs cursor-pointer"
            >
              + Tambah Master Material
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/70 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3.5">Kode Material</th>
                  <th className="py-2.5 px-3.5">Deskripsi Material</th>
                  <th className="py-2.5 px-3">Kategori</th>
                  <th className="py-2.5 px-3 text-right">Saldo Stok Fisik</th>
                  <th className="py-2.5 px-3 text-right">Safety Stock</th>
                  <th className="py-2.5 px-3 text-center">Lead Time</th>
                  <th className="py-2.5 px-3.5">Supplier Utama</th>
                  <th className="py-2.5 px-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {materials.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3.5 font-mono font-bold text-slate-900">{m.code}</td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-900">{m.name}</td>
                    <td className="py-2.5 px-3">
                      <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {m.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                      {m.totalStock.toLocaleString('id-ID')} {m.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                      {m.safetyStock.toLocaleString('id-ID')} {m.unit}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                      {m.leadTimeDays} Hari
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-600">{m.supplierName}</td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => {
                          if (confirm(`Hapus master material ${m.code}?`)) {
                            deleteMaterial(m.id);
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                        title="Hapus Master"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Requirement Modal */}
      {addReqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold">
                  {editingReq ? 'Edit Baris Kebutuhan Material' : 'Tambah Baris Kebutuhan Material'}
                </h3>
              </div>
              <button
                onClick={() => setAddReqModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitReqForm} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nomor OR Terkait (Single Source)
                  </label>
                  <input
                    type="text"
                    required
                    list="modalOrDatalist"
                    value={reqFormData.orNumber}
                    onChange={(e) => setReqFormData({ ...reqFormData, orNumber: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    placeholder="Contoh: OR-2026-001"
                  />
                  <datalist id="modalOrDatalist">
                    {registeredOrNumbers.map((or) => (
                      <option key={or} value={or} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tanggal Update *
                  </label>
                  <input
                    type="date"
                    required
                    value={reqFormData.updateDate}
                    onChange={(e) => setReqFormData({ ...reqFormData, updateDate: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Style Terkait
                </label>
                <input
                  type="text"
                  value={reqFormData.style}
                  onChange={(e) => setReqFormData({ ...reqFormData, style: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  placeholder="Contoh: Bomber Jacket Navy"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kode Material
                  </label>
                  <input
                    type="text"
                    required
                    value={reqFormData.materialCode}
                    onChange={(e) => setReqFormData({ ...reqFormData, materialCode: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    placeholder="Contoh: FAB-TASLAN-NVY"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Satuan (UoM)
                  </label>
                  <select
                    value={reqFormData.unit}
                    onChange={(e) => setReqFormData({ ...reqFormData, unit: e.target.value as MaterialUnit })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="Yard">Yard</option>
                    <option value="Meter">Meter</option>
                    <option value="Kg">Kg</option>
                    <option value="Pcs">Pcs</option>
                    <option value="Roll">Roll</option>
                    <option value="Drum">Drum</option>
                    <option value="Box">Box</option>
                    <option value="Liter">Liter</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Lengkap Material
                </label>
                <input
                  type="text"
                  required
                  value={reqFormData.materialName}
                  onChange={(e) => setReqFormData({ ...reqFormData, materialName: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  placeholder="Contoh: Fabric Taslan Waterproof Navy 210T"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kebutuhan
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={reqFormData.requiredQty}
                    onChange={(e) => setReqFormData({ ...reqFormData, requiredQty: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Diterima
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={reqFormData.receivedQty}
                    onChange={(e) => setReqFormData({ ...reqFormData, receivedQty: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-3 rounded bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                <span className="text-slate-600 font-medium">Perhitungan Kekurangan:</span>
                <span className={`font-mono font-bold ${reqFormData.receivedQty - reqFormData.requiredQty < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {reqFormData.receivedQty - reqFormData.requiredQty} {reqFormData.unit} (
                  {reqFormData.receivedQty - reqFormData.requiredQty >= 0 ? 'READY' : 'BELUM READY'})
                </span>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddReqModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-xs cursor-pointer"
                >
                  {editingReq ? 'Perbarui Kebutuhan' : 'Simpan Kebutuhan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
