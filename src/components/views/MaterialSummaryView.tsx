import React, { useState, useMemo } from 'react';
import { usePpic } from '../../context/PpicContext';
import { MaterialItemRequirement, MaterialCategory, MaterialUnit } from '../../types/ppic';
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
  Trash2,
  Edit2,
  Calendar,
  GitCompare,
  ArrowRight,
  History,
  CheckSquare,
  Square,
  RefreshCw,
  FolderMinus,
} from 'lucide-react';

export const MaterialSummaryView: React.FC = () => {
  const {
    materials,
    materialRequirements,
    registeredOrNumbers,
    getOrSummary,
    addMaterialRequirement,
    updateMaterialRequirement,
    deleteMaterialRequirement,
    setActiveMenu,
    lastImportedInfo,
    activeSearchQuery,
    setActiveSearchQuery,
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
    getOrHistoryDetails,
  } = usePpic();

  // Active view tab:
  // - 'REQUIREMENTS' (Master Data Material Transaksi OR)
  // - 'DAILY_DIFF' (Komparasi Perkembangan Tanggal)
  // - 'CATALOG' (Katalog Bahan Baku & Stok Fisik)
  const [activeTab, setActiveTab] = useState<'REQUIREMENTS' | 'DAILY_DIFF' | 'CATALOG'>('REQUIREMENTS');

  // Manual Text-Input Filters for Master Data Material Table (NO dropdown of ORs!)
  const [searchOrInput, setSearchOrInput] = useState<string>('');
  const [searchStyleInput, setSearchStyleInput] = useState<string>('');
  const [searchMaterialInput, setSearchMaterialInput] = useState<string>('');
  const [searchDateInput, setSearchDateInput] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'READY' | 'BELUM_READY'>('ALL');
  const [onlyRecentFilter, setOnlyRecentFilter] = useState<boolean>(false);

  // Checkbox selection state for batch deletion
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Modal states for Add / Edit
  const [addReqModalOpen, setAddReqModalOpen] = useState<boolean>(false);
  const [editingReq, setEditingReq] = useState<MaterialItemRequirement | null>(null);

  // Deletion Management Modal States
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [deleteMethodTab, setDeleteMethodTab] = useState<
    'BY_OR' | 'OR_HISTORY' | 'BY_STYLE' | 'BY_DATE' | 'BATCH_SELECTED' | 'AUDIT_LOG'
  >('BY_OR');

  // Form states inside Deletion Modal
  const [deleteOrInput, setDeleteOrInput] = useState<string>('');
  const [deleteOrIncludeHistory, setDeleteOrIncludeHistory] = useState<boolean>(true);

  const [deleteHistoryOrInput, setDeleteHistoryOrInput] = useState<string>('');
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>('ALL');

  const [deleteStyleInput, setDeleteStyleInput] = useState<string>('');
  const [deleteDateInput, setDeleteDateInput] = useState<string>('');

  // Universal Two-Step Confirmation Dialog State
  const [confirmationState, setConfirmationState] = useState<{
    method: 'BY_ROW' | 'BATCH_SELECTED' | 'BY_OR' | 'OR_HISTORY' | 'BY_STYLE' | 'BY_DATE';
    title: string;
    criteriaLabel: string;
    criteriaValue: string;
    summaryDescription: string;
    rowCount: number;
    affectedOrs: string[];
    affectedDates: string[];
    onConfirm: () => void;
  } | null>(null);

  // Status message notice
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form data for Add / Edit Requirement Modal
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
  // Formula: Kekurangan = Diterima - Kebutuhan
  // READY jika Kekurangan >= 0, BELUM READY jika Kekurangan < 0
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

  // Filtered requirements based on manual text inputs (NO dropdown of ORs!)
  const filteredRequirements = useMemo(() => {
    return processedRequirements.filter((r) => {
      // 1. Global / Material search input (partial match)
      if (searchMaterialInput.trim()) {
        const q = searchMaterialInput.trim().toLowerCase();
        const matchCode = r.materialCode.toLowerCase().includes(q);
        const matchName = r.materialName.toLowerCase().includes(q);
        const matchSupplier = (r.supplierName || '').toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchSupplier) return false;
      }

      // 2. Additional global active search query if present
      if (activeSearchQuery.trim()) {
        const q = activeSearchQuery.trim().toLowerCase();
        const matchCode = r.materialCode.toLowerCase().includes(q);
        const matchName = r.materialName.toLowerCase().includes(q);
        const matchOr = r.orNumber.toLowerCase().includes(q);
        const matchStyle = r.style.toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchOr && !matchStyle) return false;
      }

      // 3. No. OR manual text input (partial / substring match)
      if (searchOrInput.trim()) {
        const qOr = searchOrInput.trim().toUpperCase();
        if (!r.orNumber.toUpperCase().includes(qOr)) return false;
      }

      // 4. Style manual text input (partial / substring match)
      if (searchStyleInput.trim()) {
        const qStyle = searchStyleInput.trim().toLowerCase();
        if (!r.style.toLowerCase().includes(qStyle)) return false;
      }

      // 5. Tanggal Update manual text / date input
      if (searchDateInput.trim()) {
        const qDate = searchDateInput.trim();
        if (!r.effectiveDate.includes(qDate)) return false;
      }

      // 6. Status filter (READY / BELUM READY)
      if (statusFilter === 'READY' && !r.isReady) return false;
      if (statusFilter === 'BELUM_READY' && r.isReady) return false;

      // 7. Only recent filter
      if (onlyRecentFilter && !r.isRecentlyImported) return false;

      return true;
    });
  }, [
    processedRequirements,
    searchMaterialInput,
    activeSearchQuery,
    searchOrInput,
    searchStyleInput,
    searchDateInput,
    statusFilter,
    onlyRecentFilter,
  ]);

  // Checkbox selection helpers
  const allFilteredSelected = useMemo(() => {
    if (filteredRequirements.length === 0) return false;
    return filteredRequirements.every((r) => selectedRowIds.has(r.id));
  }, [filteredRequirements, selectedRowIds]);

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // Unselect all currently filtered
      const next = new Set(selectedRowIds);
      filteredRequirements.forEach((r) => next.delete(r.id));
      setSelectedRowIds(next);
    } else {
      // Select all currently filtered
      const next = new Set(selectedRowIds);
      filteredRequirements.forEach((r) => next.add(r.id));
      setSelectedRowIds(next);
    }
  };

  const toggleSelectRow = (id: string) => {
    const next = new Set(selectedRowIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRowIds(next);
  };

  const clearSelection = () => {
    setSelectedRowIds(new Set());
  };

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

  // Daily diff comparison data
  const comparisonData = useMemo(() => {
    const orReqs = materialRequirements.filter(
      (r) => r.orNumber.trim().toUpperCase() === compareOr.trim().toUpperCase()
    );

    const dates = Array.from(new Set(orReqs.map((r) => r.updateDate || '2026-10-31'))).sort();
    const dateA = dates[0] || '2026-10-25';
    const dateB = dates[dates.length - 1] || '2026-10-31';

    const reqsA = orReqs.filter((r) => (r.updateDate || '2026-10-31') === dateA);
    const reqsB = orReqs.filter((r) => (r.updateDate || '2026-10-31') === dateB);

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

  // Handlers for Add / Edit Modal
  const handleOpenAddModal = () => {
    setEditingReq(null);
    setReqFormData({
      orNumber: searchOrInput.trim() || registeredOrNumbers[0] || 'OR-2026-001',
      style: searchStyleInput.trim() || '',
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
      setNotice({ type: 'success', message: `Baris material ${reqFormData.materialCode} berhasil diperbarui.` });
    } else {
      addMaterialRequirement(reqFormData);
      setNotice({ type: 'success', message: `Baris material ${reqFormData.materialCode} berhasil ditambahkan.` });
    }
    setAddReqModalOpen(false);
  };

  // Export exact Master Data Material table to Excel
  const handleExportMasterDataExcel = () => {
    const wb = XLSX.utils.book_new();
    const exportData = filteredRequirements.map((r) => ({
      'Tanggal Update': r.effectiveDate,
      'No. OR': r.orNumber,
      'Style': r.style,
      'Kode Material': r.materialCode,
      'Nama Material': r.materialName,
      'Kebutuhan': r.requiredQty,
      'Diterima': r.receivedQty,
      'Satuan': r.unit,
      'Kekurangan': r.shortage,
      'Status Kesiapan': r.statusLabel,
      'Kategori': r.category,
      'Supplier': r.supplierName || '-',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Master_Data_Material');
    XLSX.writeFile(wb, `Master_Data_Material_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Impact Calculations for Hapus Data Modal
  const typedOrImpact = useMemo(() => {
    if (!deleteOrInput.trim()) return null;
    return getDeletionImpactByOr(deleteOrInput.trim());
  }, [deleteOrInput, getDeletionImpactByOr, materialRequirements]);

  const typedOrHistoryDetails = useMemo(() => {
    if (!deleteHistoryOrInput.trim()) return null;
    return getOrHistoryDetails(deleteHistoryOrInput.trim());
  }, [deleteHistoryOrInput, getOrHistoryDetails, materialRequirements]);

  const typedStyleImpact = useMemo(() => {
    if (!deleteStyleInput.trim()) return null;
    return getDeletionImpactByStyle(deleteStyleInput.trim());
  }, [deleteStyleInput, getDeletionImpactByStyle, materialRequirements]);

  const typedDateImpact = useMemo(() => {
    if (!deleteDateInput.trim()) return null;
    return getDeletionImpactByDate(deleteDateInput.trim());
  }, [deleteDateInput, getDeletionImpactByDate, materialRequirements]);

  // Selected rows impact calculation
  const selectedRowsImpact = useMemo(() => {
    if (selectedRowIds.size === 0) return null;
    const selectedRows = materialRequirements.filter((r) => selectedRowIds.has(r.id));
    const affectedOrs = Array.from(new Set(selectedRows.map((r) => r.orNumber)));
    const affectedDates = Array.from(new Set(selectedRows.map((r) => r.updateDate || '2026-10-31')));
    return {
      rowCount: selectedRows.length,
      affectedOrs,
      affectedDates,
      rows: selectedRows,
    };
  }, [selectedRowIds, materialRequirements]);

  // Deletion Execution Handlers through Two-Step Confirmation
  // 1. Single Row Deletion via Aksi Column
  const handleRequestDeleteSingleRow = (row: typeof processedRequirements[0]) => {
    setConfirmationState({
      method: 'BY_ROW',
      title: 'Hapus 1 Baris Material',
      criteriaLabel: 'Kode & No. OR',
      criteriaValue: `${row.materialCode} (${row.orNumber})`,
      summaryDescription: `Material "${row.materialName}" pada OR ${row.orNumber} (Style: ${row.style || '-'})`,
      rowCount: 1,
      affectedOrs: [row.orNumber],
      affectedDates: [row.effectiveDate],
      onConfirm: () => {
        const res = deleteSingleRequirement(row.id);
        if (res.success) {
          const next = new Set(selectedRowIds);
          next.delete(row.id);
          setSelectedRowIds(next);
          setNotice({ type: 'success', message: res.message });
        } else {
          setNotice({ type: 'error', message: res.message });
        }
      },
    });
  };

  // 2. Batch Deletion via Checkboxes
  const handleRequestDeleteSelectedBatch = () => {
    if (!selectedRowsImpact || selectedRowsImpact.rowCount === 0) return;
    const ids = Array.from(selectedRowIds);
    setConfirmationState({
      method: 'BATCH_SELECTED',
      title: 'Hapus Data Terpilih (Batch)',
      criteriaLabel: 'Jumlah Baris Terpilih',
      criteriaValue: `${ids.length} Baris Material`,
      summaryDescription: `Menghapus ${ids.length} baris material yang dicentang pada tabel Master Data`,
      rowCount: ids.length,
      affectedOrs: selectedRowsImpact.affectedOrs,
      affectedDates: selectedRowsImpact.affectedDates,
      onConfirm: () => {
        const res = deleteMultipleRequirements(ids);
        if (res.success) {
          clearSelection();
          setNotice({ type: 'success', message: res.message });
        } else {
          setNotice({ type: 'error', message: res.message });
        }
      },
    });
  };

  // 3. Delete by Typed No. OR
  const handleRequestDeleteByOr = () => {
    if (!typedOrImpact || typedOrImpact.rowCount === 0) return;
    const targetOr = typedOrImpact.orNumber;
    setConfirmationState({
      method: 'BY_OR',
      title: 'Hapus Data Berdasarkan Nomor OR',
      criteriaLabel: 'Nomor OR',
      criteriaValue: targetOr,
      summaryDescription: `Seluruh transaksi material milik OR ${targetOr} (Style: ${typedOrImpact.style || '-'})${
        deleteOrIncludeHistory ? ' beserta riwayat upload terkait' : ''
      }`,
      rowCount: typedOrImpact.rowCount,
      affectedOrs: [targetOr],
      affectedDates: typedOrImpact.updateDates,
      onConfirm: () => {
        const res = deleteDataByOr(targetOr, deleteOrIncludeHistory);
        if (res.success) {
          setDeleteOrInput('');
          setDeleteModalOpen(false);
          setNotice({ type: 'success', message: res.message });
        } else {
          setNotice({ type: 'error', message: res.message });
        }
      },
    });
  };

  // 4. Delete OR History (Snapshot specific date vs All history)
  const handleRequestDeleteOrHistory = () => {
    if (!typedOrHistoryDetails || typedOrHistoryDetails.totalRows === 0) return;
    const targetOr = typedOrHistoryDetails.orNumber;
    const isAll = selectedHistoryDate === 'ALL';
    const targetRows = isAll
      ? typedOrHistoryDetails.totalRows
      : typedOrHistoryDetails.dates.find((d) => d.updateDate === selectedHistoryDate)?.rowCount || 0;

    setConfirmationState({
      method: 'OR_HISTORY',
      title: 'Hapus Riwayat Upload OR',
      criteriaLabel: 'Nomor OR & Tanggal Riwayat',
      criteriaValue: `${targetOr} [${isAll ? 'Semua Tanggal Riwayat' : selectedHistoryDate}]`,
      summaryDescription: isAll
        ? `Menghapus seluruh riwayat upload dan snapshot transaksi untuk OR ${targetOr}`
        : `Menghapus snapshot upload tanggal ${selectedHistoryDate} untuk OR ${targetOr}`,
      rowCount: targetRows,
      affectedOrs: [targetOr],
      affectedDates: isAll ? typedOrHistoryDetails.dates.map((d) => d.updateDate) : [selectedHistoryDate],
      onConfirm: () => {
        const res = deleteOrHistory(targetOr, isAll ? undefined : selectedHistoryDate);
        if (res.success) {
          setDeleteHistoryOrInput('');
          setDeleteModalOpen(false);
          setNotice({ type: 'success', message: res.message });
        } else {
          setNotice({ type: 'error', message: res.message });
        }
      },
    });
  };

  // 5. Delete by Style
  const handleRequestDeleteByStyle = () => {
    if (!typedStyleImpact || typedStyleImpact.rowCount === 0) return;
    const targetStyle = typedStyleImpact.style;
    setConfirmationState({
      method: 'BY_STYLE',
      title: 'Hapus Data Berdasarkan Style',
      criteriaLabel: 'Nama Style',
      criteriaValue: targetStyle,
      summaryDescription: `Seluruh transaksi material dengan Style "${targetStyle}" (${typedStyleImpact.affectedOrs.length} OR)`,
      rowCount: typedStyleImpact.rowCount,
      affectedOrs: typedStyleImpact.affectedOrs,
      affectedDates: [],
      onConfirm: () => {
        const res = deleteDataByStyle(targetStyle);
        if (res.success) {
          setDeleteStyleInput('');
          setDeleteModalOpen(false);
          setNotice({ type: 'success', message: res.message });
        } else {
          setNotice({ type: 'error', message: res.message });
        }
      },
    });
  };

  // 6. Delete by Update Date
  const handleRequestDeleteByDate = () => {
    if (!typedDateImpact || typedDateImpact.rowCount === 0) return;
    const targetDate = typedDateImpact.updateDate;
    setConfirmationState({
      method: 'BY_DATE',
      title: 'Hapus Data Berdasarkan Tanggal Update',
      criteriaLabel: 'Tanggal Update',
      criteriaValue: targetDate,
      summaryDescription: `Seluruh transaksi material pada Tanggal Update ${targetDate} (${typedDateImpact.affectedOrs.length} OR)`,
      rowCount: typedDateImpact.rowCount,
      affectedOrs: typedDateImpact.affectedOrs.map((o) => o.orNumber),
      affectedDates: [targetDate],
      onConfirm: () => {
        const res = deleteDataByUpdateDate(targetDate);
        if (res.success) {
          setDeleteDateInput('');
          setDeleteModalOpen(false);
          setNotice({ type: 'success', message: res.message });
        } else {
          setNotice({ type: 'error', message: res.message });
        }
      },
    });
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
            Tabel terintegrasi hasil pembacaan file Excel per <strong>Tanggal Update</strong>, No. OR, Style, serta status <strong>READY</strong> atau <strong>BELUM READY</strong> berdasarkan rumus <code>Kekurangan = Diterima - Kebutuhan</code>.
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
          <button
            onClick={() => {
              setDeleteModalOpen(true);
              setNotice(null);
              if (registeredOrNumbers.length > 0 && !deleteOrInput) {
                setDeleteOrInput(registeredOrNumbers[0]);
              }
              if (registeredOrNumbers.length > 0 && !deleteHistoryOrInput) {
                setDeleteHistoryOrInput(registeredOrNumbers[0]);
              }
              if (availableUpdateDates.length > 0 && !deleteDateInput) {
                setDeleteDateInput(availableUpdateDates[0]);
              }
            }}
            className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="Buka panel Hapus Data Master Material"
          >
            <Trash2 className="w-4 h-4 text-rose-600" />
            Hapus Data
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
              <div className="text-xs font-bold text-emerald-950 flex items-center gap-2 flex-wrap">
                <span>Data Excel Berhasil Disimpan Otomatis ke Master Data Material</span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-200 text-emerald-900 rounded-full">
                  {lastImportedInfo.count} Baris Transaksi
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-100 text-blue-800 rounded-full flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {lastImportedInfo.updateDate}
                </span>
                {lastImportedInfo.orNumber && (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-600 text-white rounded-full">
                    No. OR: {lastImportedInfo.orNumber}
                  </span>
                )}
                {lastImportedInfo.style && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-200 text-slate-800 rounded-full">
                    Style: {lastImportedInfo.style}
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-800 mt-0.5">
                Semua baris material langsung terhubung sebagai single source of truth untuk seluruh menu PPIC.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notice Banner */}
      {notice && (
        <div
          className={`p-3.5 rounded-lg text-xs flex items-center justify-between shadow-xs ${
            notice.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
              : 'bg-rose-50 text-rose-900 border border-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{notice.message}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-slate-600 ml-3 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-blue-600" />
            Total Baris Material
          </div>
          <div className="text-xl md:text-2xl font-bold font-mono text-slate-900 mt-1">
            {metrics.total.toLocaleString('id-ID')}
            <span className="text-xs font-normal text-slate-400 ml-1.5">baris</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {registeredOrNumbers.length} Nomor OR terdaftar
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Status READY (≥ 0)
          </div>
          <div className="text-xl md:text-2xl font-bold font-mono text-emerald-700 mt-1">
            {metrics.ready.toLocaleString('id-ID')}
            <span className="text-xs font-normal text-emerald-600 ml-1.5">({metrics.readyPercent}%)</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Material siap untuk produksi
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-medium text-red-700 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Status BELUM READY (&lt; 0)
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
          {/* SEARCH & FILTER TOOLBAR: ALL MANUAL TEXT INPUTS (NO DROPDOWN OF ORs!) */}
          <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
            <div className="flex flex-col gap-3">
              {/* Row 1: Manual Text Input Search Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {/* 1. Manual Text Input: No. OR */}
                <div className="relative">
                  <span className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Hash className="w-3 h-3 text-blue-600" />
                    Cari No. OR (Ketik Manual):
                  </span>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={searchOrInput}
                      onChange={(e) => setSearchOrInput(e.target.value)}
                      placeholder="Ketik No. OR (misal: OR-2026)..."
                      className="w-full pl-8 pr-7 py-1.5 text-xs font-mono border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                    />
                    {searchOrInput && (
                      <button
                        onClick={() => setSearchOrInput('')}
                        className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                        title="Hapus filter OR"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. Manual Text Input: Style */}
                <div className="relative">
                  <span className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Tag className="w-3 h-3 text-purple-600" />
                    Cari Style (Ketik Manual):
                  </span>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={searchStyleInput}
                      onChange={(e) => setSearchStyleInput(e.target.value)}
                      placeholder="Ketik Style (misal: Bomber)..."
                      className="w-full pl-8 pr-7 py-1.5 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                    />
                    {searchStyleInput && (
                      <button
                        onClick={() => setSearchStyleInput('')}
                        className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                        title="Hapus filter Style"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 3. Manual Text Input: Kode / Nama Material */}
                <div className="relative">
                  <span className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Boxes className="w-3 h-3 text-emerald-600" />
                    Cari Kode / Nama Material:
                  </span>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={searchMaterialInput}
                      onChange={(e) => setSearchMaterialInput(e.target.value)}
                      placeholder="Ketik kode / nama material..."
                      className="w-full pl-8 pr-7 py-1.5 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                    />
                    {searchMaterialInput && (
                      <button
                        onClick={() => setSearchMaterialInput('')}
                        className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                        title="Hapus filter material"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 4. Manual Text / Date Input: Tanggal Update */}
                <div className="relative">
                  <span className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-amber-600" />
                    Cari Tanggal Update (YYYY-MM-DD):
                  </span>
                  <div className="relative">
                    <input
                      type="date"
                      value={searchDateInput}
                      onChange={(e) => setSearchDateInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                    />
                    {searchDateInput && (
                      <button
                        onClick={() => setSearchDateInput('')}
                        className="absolute right-8 top-2 text-slate-400 hover:text-slate-600"
                        title="Hapus filter tanggal"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 2: Status Filter & Batch Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">Status:</span>
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

                {/* Batch Selection Action Button */}
                <div className="flex items-center gap-2">
                  {selectedRowIds.size > 0 && (
                    <div className="flex items-center gap-2 animate-in fade-in duration-150">
                      <span className="text-xs font-semibold text-slate-700">
                        {selectedRowIds.size} baris terpilih
                      </span>
                      <button
                        onClick={handleRequestDeleteSelectedBatch}
                        className="px-3 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Hapus seluruh baris yang dicentang"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Hapus Data Terpilih ({selectedRowIds.size} Baris)
                      </button>
                      <button
                        onClick={clearSelection}
                        className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        Batal Pilih
                      </button>
                    </div>
                  )}

                  {(searchOrInput || searchStyleInput || searchMaterialInput || searchDateInput || statusFilter !== 'ALL' || onlyRecentFilter || activeSearchQuery) && (
                    <button
                      onClick={() => {
                        setSearchOrInput('');
                        setSearchStyleInput('');
                        setSearchMaterialInput('');
                        setSearchDateInput('');
                        setStatusFilter('ALL');
                        setOnlyRecentFilter(false);
                        setActiveSearchQuery('');
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer ml-auto"
                    >
                      Reset Semua Pencarian
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 pt-1 flex items-center justify-between">
              <div>
                Menampilkan <strong className="text-slate-900">{filteredRequirements.length}</strong> dari {materialRequirements.length} baris material.
                {searchOrInput && (
                  <span className="ml-2 font-mono text-blue-700 font-semibold">[No. OR: "{searchOrInput}"]</span>
                )}
                {searchStyleInput && (
                  <span className="ml-2 font-semibold text-purple-700">[Style: "{searchStyleInput}"]</span>
                )}
                {searchMaterialInput && (
                  <span className="ml-2 font-semibold text-emerald-700">[Material: "{searchMaterialInput}"]</span>
                )}
                {searchDateInput && (
                  <span className="ml-2 font-mono text-amber-700 font-semibold">[Tanggal: "{searchDateInput}"]</span>
                )}
              </div>
            </div>
          </div>

          {/* MAIN MASTER DATA MATERIAL TABLE
              EXACT COLUMNS AS REQUIRED:
              1. Checkbox
              2. Tanggal Update
              3. No. OR
              4. Style
              5. Kode Material
              6. Nama Material
              7. Kebutuhan
              8. Diterima
              9. Satuan
              10. Status Kesiapan
              11. Aksi
          */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    {/* Far Left Checkbox for Batch Selection */}
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                        title="Pilih Semua / Batal Pilih Semua"
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                      />
                    </th>
                    {/* 1. Tanggal Update */}
                    <th className="py-3 px-3.5 whitespace-nowrap">Tanggal Update</th>
                    {/* 2. No. OR */}
                    <th className="py-3 px-3.5 whitespace-nowrap">No. OR</th>
                    {/* 3. Style */}
                    <th className="py-3 px-3.5 min-w-[140px]">Style</th>
                    {/* 4. Kode Material */}
                    <th className="py-3 px-3.5 whitespace-nowrap">Kode Material</th>
                    {/* 5. Nama Material */}
                    <th className="py-3 px-3.5 min-w-[200px]">Nama Material</th>
                    {/* 6. Kebutuhan */}
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Kebutuhan</th>
                    {/* 7. Diterima */}
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Diterima</th>
                    {/* 8. Satuan */}
                    <th className="py-3 px-3 text-center whitespace-nowrap">Satuan</th>
                    {/* 9. Status Kesiapan */}
                    <th className="py-3 px-3.5 text-center whitespace-nowrap bg-slate-100/60">
                      Status Kesiapan
                      <span className="block text-[10px] font-normal text-slate-500">
                        (Kekurangan = Diterima - Kebutuhan)
                      </span>
                    </th>
                    {/* 10. Aksi */}
                    <th className="py-3 px-3 text-center whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequirements.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-400 text-xs">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Boxes className="w-8 h-8 text-slate-300" />
                          <span className="font-bold text-slate-700 text-sm">
                            Data tidak ditemukan
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Tidak ada data material yang sesuai dengan kriteria pencarian Anda.
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRequirements.map((row) => {
                      const isSelected = selectedRowIds.has(row.id);
                      const isShortage = row.shortage < 0;

                      return (
                        <tr
                          key={row.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isSelected ? 'bg-blue-50/40' : row.isRecentlyImported ? 'bg-blue-50/20' : ''
                          }`}
                        >
                          {/* Far Left Checkbox */}
                          <td className="py-3 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectRow(row.id)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                            />
                          </td>

                          {/* 1. Tanggal Update */}
                          <td className="py-3 px-3.5 font-mono text-slate-700 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px]">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              {row.effectiveDate}
                            </span>
                          </td>

                          {/* 2. No. OR */}
                          <td className="py-3 px-3.5 font-mono font-bold text-blue-700 whitespace-nowrap">
                            <button
                              onClick={() => setSearchOrInput(row.orNumber)}
                              className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200 transition-colors cursor-pointer text-left"
                              title="Klik untuk filter No. OR ini"
                            >
                              {row.orNumber}
                            </button>
                          </td>

                          {/* 3. Style */}
                          <td className="py-3 px-3.5 text-slate-800 font-medium">
                            {row.style || '-'}
                          </td>

                          {/* 4. Kode Material */}
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

                          {/* 5. Nama Material */}
                          <td className="py-3 px-3.5 font-medium text-slate-900">
                            <div>{row.materialName}</div>
                            {row.supplierName && (
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {row.supplierName}
                              </div>
                            )}
                          </td>

                          {/* 6. Kebutuhan */}
                          <td className="py-3 px-3.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {row.requiredQty.toLocaleString('id-ID')}
                          </td>

                          {/* 7. Diterima */}
                          <td className="py-3 px-3.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {row.receivedQty.toLocaleString('id-ID')}
                          </td>

                          {/* 8. Satuan */}
                          <td className="py-3 px-3 text-center font-mono font-medium text-slate-700 whitespace-nowrap">
                            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                              {row.unit}
                            </span>
                          </td>

                          {/* 9. Status Kesiapan */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap bg-slate-50/50">
                            {row.isReady ? (
                              <div className="inline-flex flex-col items-center">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  READY
                                </span>
                                <span className="text-[10px] font-mono text-emerald-700 mt-0.5">
                                  +{row.shortage.toLocaleString('id-ID')} {row.unit}
                                </span>
                              </div>
                            ) : (
                              <div className="inline-flex flex-col items-center">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300">
                                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                                  BELUM READY
                                </span>
                                <span className="text-[10px] font-mono text-red-700 mt-0.5 font-bold">
                                  {row.shortage.toLocaleString('id-ID')} {row.unit}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 10. Aksi */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditModal(row)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded cursor-pointer transition-colors"
                                title="Edit baris material ini"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRequestDeleteSingleRow(row)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded cursor-pointer transition-colors"
                                title="Hapus baris material ini"
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
                {registeredOrNumbers.length === 0 ? (
                  <option value="">Belum ada Nomor OR</option>
                ) : (
                  registeredOrNumbers.map((or) => {
                    const summary = getOrSummary(or);
                    return (
                      <option key={or} value={or}>
                        {or} {summary?.style ? `— ${summary.style}` : ''}
                      </option>
                    );
                  })
                )}
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
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Katalog Master Material & Referensi Satuan</h3>
              <p className="text-xs text-slate-500">
                Daftar referensi kode, nama, dan satuan material yang digunakan untuk mengenali hasil pembacaan file Excel.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-3 px-3.5">Kode Material</th>
                  <th className="py-3 px-3.5">Nama Material</th>
                  <th className="py-3 px-3 text-center">Satuan</th>
                  <th className="py-3 px-3.5">Kategori</th>
                  <th className="py-3 px-3.5 text-right">Stok Fisik Gudang</th>
                  <th className="py-3 px-3.5">Supplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {materials.map((mat) => (
                  <tr key={mat.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3.5 font-mono font-bold text-slate-900">{mat.code}</td>
                    <td className="py-2.5 px-3.5 font-medium text-slate-800">{mat.name}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600">{mat.unit}</td>
                    <td className="py-2.5 px-3.5 text-slate-600">{mat.category}</td>
                    <td className="py-2.5 px-3.5 text-right font-mono font-bold text-slate-900">
                      {mat.totalStock.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-500">{mat.supplierName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: TAMBAH / EDIT BARIS KEBUTUHAN MANUAL */}
      {addReqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editingReq ? 'Edit Baris Kebutuhan Material' : 'Tambah Baris Kebutuhan Material'}
              </h3>
              <button
                onClick={() => setAddReqModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitReqForm} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    No. OR (Nomor Order)
                  </label>
                  <input
                    type="text"
                    required
                    value={reqFormData.orNumber}
                    onChange={(e) => setReqFormData({ ...reqFormData, orNumber: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    placeholder="Contoh: OR-2026-001"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tanggal Update
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
                  Nama Style
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

      {/* MODAL 2: PANEL PENGELOLAAN DAN PENGHAPUSAN MASTER DATA (6 TAB METODE) */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Header Modal */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-rose-500/20 text-rose-400 rounded-md border border-rose-500/30">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Pengelolaan & Penghapusan Master Data Material</h3>
                  <p className="text-[11px] text-slate-400">
                    Pilih metode penghapusan data transaksi material secara terukur, selektif, dan aman.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDeleteModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
                title="Tutup panel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Method Selector Tabs */}
              <div className="flex items-center border-b border-slate-200 overflow-x-auto gap-1">
                <button
                  type="button"
                  onClick={() => setDeleteMethodTab('BY_OR')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    deleteMethodTab === 'BY_OR'
                      ? 'border-rose-600 text-rose-700 bg-rose-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5 text-rose-600" />
                  1. Hapus Berdasarkan No. OR
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteMethodTab('OR_HISTORY')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    deleteMethodTab === 'OR_HISTORY'
                      ? 'border-rose-600 text-rose-700 bg-rose-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <History className="w-3.5 h-3.5 text-rose-600" />
                  2. Hapus Riwayat OR
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteMethodTab('BY_STYLE')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    deleteMethodTab === 'BY_STYLE'
                      ? 'border-rose-600 text-rose-700 bg-rose-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Tag className="w-3.5 h-3.5 text-rose-600" />
                  3. Hapus Berdasarkan Style
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteMethodTab('BY_DATE')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    deleteMethodTab === 'BY_DATE'
                      ? 'border-rose-600 text-rose-700 bg-rose-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5 text-rose-600" />
                  4. Hapus Berdasarkan Tanggal
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteMethodTab('BATCH_SELECTED')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    deleteMethodTab === 'BATCH_SELECTED'
                      ? 'border-rose-600 text-rose-700 bg-rose-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5 text-rose-600" />
                  5. Hapus Pilihan ({selectedRowIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteMethodTab('AUDIT_LOG')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    deleteMethodTab === 'AUDIT_LOG'
                      ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FolderMinus className="w-3.5 h-3.5 text-blue-600" />
                  Riwayat ({deletionHistory.length})
                </button>
              </div>

              {/* METHOD 1: HAPUS BERDASARKAN NO. OR */}
              {deleteMethodTab === 'BY_OR' && (
                <div className="space-y-4">
                  <div className="p-3 bg-rose-50/60 border border-rose-200 rounded-lg text-xs text-rose-950 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-rose-900">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      Metode Hapus Berdasarkan Nomor OR:
                    </p>
                    <p className="text-[11px] text-rose-800">
                      Ketik Nomor OR secara manual. Sistem akan memindai seluruh transaksi material terkait OR tersebut dan memberikan ringkasan dampak sebelum dihapus.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700">
                      Ketik Nomor OR yang Akan Dihapus:
                    </label>
                    <div className="relative">
                      <Hash className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={deleteOrInput}
                        onChange={(e) => setDeleteOrInput(e.target.value.toUpperCase())}
                        placeholder="Contoh: OR-2026-001..."
                        className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-md focus:ring-1 focus:ring-rose-500 focus:outline-none uppercase"
                      />
                    </div>
                  </div>

                  {typedOrImpact && typedOrImpact.rowCount > 0 ? (
                    <div className="p-4 bg-rose-50/80 border border-rose-200 rounded-xl space-y-3">
                      <div className="flex items-center justify-between border-b border-rose-200 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs bg-rose-100 text-rose-800 px-2 py-0.5 rounded border border-rose-300">
                            {typedOrImpact.orNumber}
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            Style: {typedOrImpact.style || '-'}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-rose-700 bg-white px-2.5 py-0.5 rounded-full border border-rose-200">
                          {typedOrImpact.rowCount} Baris Terdampak
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        <div className="bg-white p-2 rounded border border-rose-100">
                          <span className="text-slate-400 text-[10px] block">Jumlah Baris</span>
                          <span className="font-bold text-slate-800 font-mono">{typedOrImpact.rowCount} baris</span>
                        </div>
                        <div className="bg-white p-2 rounded border border-rose-100">
                          <span className="text-slate-400 text-[10px] block">Tanggal Update</span>
                          <span className="font-bold text-slate-800 font-mono text-[11px]">
                            {typedOrImpact.updateDates.join(', ') || '-'}
                          </span>
                        </div>
                        <div className="bg-white p-2 rounded border border-rose-100 col-span-2 sm:col-span-1">
                          <span className="text-slate-400 text-[10px] block">Total Kebutuhan</span>
                          <span className="font-bold text-slate-800 font-mono">
                            {typedOrImpact.totalRequiredQty.toLocaleString('id-ID')} unit
                          </span>
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={deleteOrIncludeHistory}
                          onChange={(e) => setDeleteOrIncludeHistory(e.target.checked)}
                          className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                        />
                        <span>Hapus juga riwayat upload dan registrasi untuk No. OR ini</span>
                      </label>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleRequestDeleteByOr}
                          className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Lanjutkan ke Konfirmasi Hapus OR ({typedOrImpact.rowCount} Baris)
                        </button>
                      </div>
                    </div>
                  ) : deleteOrInput.trim() ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
                      Tidak ditemukan data transaksi material untuk No. OR: <strong>{deleteOrInput}</strong>.
                    </div>
                  ) : null}
                </div>
              )}

              {/* METHOD 2: HAPUS RIWAYAT OR */}
              {deleteMethodTab === 'OR_HISTORY' && (
                <div className="space-y-4">
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-amber-900">
                      <History className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      Metode Hapus Riwayat OR (Per Tanggal Update):
                    </p>
                    <p className="text-[11px] text-amber-800">
                      Ketik Nomor OR untuk melihat snapshot tanggal update yang tersimpan. Anda dapat menghapus salah satu tanggal update saja atau seluruh riwayat upload.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700">
                      Ketik Nomor OR:
                    </label>
                    <input
                      type="text"
                      value={deleteHistoryOrInput}
                      onChange={(e) => setDeleteHistoryOrInput(e.target.value.toUpperCase())}
                      placeholder="Contoh: OR-2026-001..."
                      className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-md focus:ring-1 focus:ring-amber-500 focus:outline-none uppercase"
                    />
                  </div>

                  {typedOrHistoryDetails && typedOrHistoryDetails.totalRows > 0 ? (
                    <div className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-3">
                      <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                        <span className="font-mono font-bold text-xs text-amber-900">
                          {typedOrHistoryDetails.orNumber} ({typedOrHistoryDetails.style})
                        </span>
                        <span className="text-xs font-semibold text-amber-800">
                          {typedOrHistoryDetails.dates.length} Tanggal Update Terdata
                        </span>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-700">
                          Pilih Tanggal Riwayat yang Ingin Dihapus:
                        </label>
                        <select
                          value={selectedHistoryDate}
                          onChange={(e) => setSelectedHistoryDate(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-amber-500"
                        >
                          <option value="ALL">
                            Semua Riwayat Tanggal ({typedOrHistoryDetails.totalRows} baris transaksi)
                          </option>
                          {typedOrHistoryDetails.dates.map((d) => (
                            <option key={d.updateDate} value={d.updateDate}>
                              Hanya Tanggal {d.updateDate} ({d.rowCount} baris material)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleRequestDeleteOrHistory}
                          className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Lanjutkan ke Konfirmasi Hapus Riwayat
                        </button>
                      </div>
                    </div>
                  ) : deleteHistoryOrInput.trim() ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
                      Tidak ditemukan riwayat upload untuk No. OR: <strong>{deleteHistoryOrInput}</strong>.
                    </div>
                  ) : null}
                </div>
              )}

              {/* METHOD 3: HAPUS BERDASARKAN STYLE */}
              {deleteMethodTab === 'BY_STYLE' && (
                <div className="space-y-4">
                  <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-lg text-xs text-purple-950 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-purple-900">
                      <Tag className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                      Metode Hapus Berdasarkan Style:
                    </p>
                    <p className="text-[11px] text-purple-800">
                      Ketik nama Style secara manual. Sistem akan memindai seluruh transaksi material dengan Style tersebut.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700">
                      Ketik Nama Style yang Akan Dihapus:
                    </label>
                    <input
                      type="text"
                      value={deleteStyleInput}
                      onChange={(e) => setDeleteStyleInput(e.target.value)}
                      placeholder="Contoh: Bomber Jacket Navy..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  {typedStyleImpact && typedStyleImpact.rowCount > 0 ? (
                    <div className="p-4 bg-purple-50/70 border border-purple-200 rounded-xl space-y-3">
                      <div className="flex items-center justify-between border-b border-purple-200 pb-2">
                        <span className="font-bold text-xs text-purple-950">
                          Style: "{typedStyleImpact.style}"
                        </span>
                        <span className="text-xs font-bold text-purple-700 bg-white px-2.5 py-0.5 rounded-full border border-purple-200">
                          {typedStyleImpact.rowCount} Baris Material
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 space-y-1">
                        <div>
                          <strong>OR Terdampak:</strong> {typedStyleImpact.affectedOrs.join(', ') || '-'}
                        </div>
                        <div>
                          <strong>Total Baris:</strong> {typedStyleImpact.rowCount} baris transaksi material
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleRequestDeleteByStyle}
                          className="px-4 py-2 text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Lanjutkan ke Konfirmasi Hapus Style ({typedStyleImpact.rowCount} Baris)
                        </button>
                      </div>
                    </div>
                  ) : deleteStyleInput.trim() ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
                      Tidak ditemukan transaksi material untuk Style: <strong>{deleteStyleInput}</strong>.
                    </div>
                  ) : null}
                </div>
              )}

              {/* METHOD 4: HAPUS BERDASARKAN TANGGAL UPDATE */}
              {deleteMethodTab === 'BY_DATE' && (
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg text-xs text-blue-950 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-blue-900">
                      <Calendar className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      Metode Hapus Berdasarkan Tanggal Update:
                    </p>
                    <p className="text-[11px] text-blue-800">
                      Pilih atau ketik Tanggal Update. Penghapusan hanya mencakup transaksi pada tanggal tersebut tanpa mengganggu snapshot pada tanggal lainnya.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700">
                      Tanggal Update yang Akan Dihapus:
                    </label>
                    <input
                      type="date"
                      value={deleteDateInput}
                      onChange={(e) => setDeleteDateInput(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  {typedDateImpact && typedDateImpact.rowCount > 0 ? (
                    <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3">
                      <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                        <span className="font-mono font-bold text-xs text-blue-950">
                          Tanggal: {typedDateImpact.updateDate}
                        </span>
                        <span className="text-xs font-bold text-blue-700 bg-white px-2.5 py-0.5 rounded-full border border-blue-200">
                          {typedDateImpact.rowCount} Baris Material
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 space-y-1">
                        <div>
                          <strong>OR Terdampak:</strong> {typedDateImpact.affectedOrs.map((o) => o.orNumber).join(', ') || '-'}
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleRequestDeleteByDate}
                          className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Lanjutkan ke Konfirmasi Hapus Tanggal ({typedDateImpact.rowCount} Baris)
                        </button>
                      </div>
                    </div>
                  ) : deleteDateInput.trim() ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
                      Tidak ada transaksi material pada tanggal: <strong>{deleteDateInput}</strong>.
                    </div>
                  ) : null}
                </div>
              )}

              {/* METHOD 5: HAPUS PILIHAN (BATCH VIA CHECKBOX) */}
              {deleteMethodTab === 'BATCH_SELECTED' && (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-slate-900">
                      <CheckSquare className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      Metode Hapus Data Pilihan (Checkbox Terpilih):
                    </p>
                    <p className="text-[11px] text-slate-600">
                      Menghapus baris-baris material yang telah dicentang melalui kotak checkbox di kolom paling kiri tabel Master Data.
                    </p>
                  </div>

                  {selectedRowsImpact && selectedRowsImpact.rowCount > 0 ? (
                    <div className="p-4 bg-rose-50/70 border border-rose-200 rounded-xl space-y-3">
                      <div className="flex items-center justify-between border-b border-rose-200 pb-2">
                        <span className="font-bold text-xs text-rose-950">
                          {selectedRowsImpact.rowCount} Baris Material Dicentang
                        </span>
                        <button
                          onClick={clearSelection}
                          className="text-xs text-rose-600 hover:text-rose-800 underline cursor-pointer"
                        >
                          Reset Pilihan
                        </button>
                      </div>

                      <div className="text-xs text-slate-700 space-y-1">
                        <div>
                          <strong>Nomor OR Terdampak:</strong> {selectedRowsImpact.affectedOrs.join(', ') || '-'}
                        </div>
                        <div>
                          <strong>Tanggal Update Terdampak:</strong> {selectedRowsImpact.affectedDates.join(', ') || '-'}
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteModalOpen(false);
                            handleRequestDeleteSelectedBatch();
                          }}
                          className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Lanjutkan ke Konfirmasi Hapus Data Terpilih
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center space-y-2">
                      <p>Belum ada baris material yang dicentang pada tabel Master Data.</p>
                      <p className="text-[11px] text-slate-400">
                        Kembali ke tabel dan centang baris yang ingin dihapus, atau gunakan metode penghapusan lainnya di tab atas.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 6: AUDIT LOG RIWAYAT PENGHAPUSAN */}
              {deleteMethodTab === 'AUDIT_LOG' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">
                      Log Audit Riwayat Penghapusan Transaksi Master Material
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Total: {deletionHistory.length} kali penghapusan
                    </span>
                  </div>

                  {deletionHistory.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
                      Belum ada riwayat penghapusan data. Semua transaksi material masih utuh tersimpan.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-100 text-slate-700 text-[11px] border-b border-slate-200">
                          <tr>
                            <th className="p-2.5 text-left font-bold">Waktu (WIB)</th>
                            <th className="p-2.5 text-left font-bold">Metode</th>
                            <th className="p-2.5 text-left font-bold">Target / Kriteria</th>
                            <th className="p-2.5 text-center font-bold">Baris Dihapus</th>
                            <th className="p-2.5 text-left font-bold">OR Terdampak</th>
                            <th className="p-2.5 text-left font-bold">Pengguna</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {deletionHistory.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                              <td className="p-2.5 font-mono text-[11px] text-slate-600">{item.timestamp}</td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  item.method === 'BY_OR'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                  {item.methodLabel}
                                </span>
                              </td>
                              <td className="p-2.5 font-mono font-bold text-slate-800">
                                {item.targetValue}
                                {item.targetDetails && (
                                  <span className="block font-sans font-normal text-[10px] text-slate-500">
                                    {item.targetDetails}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 text-center font-mono font-bold text-rose-600">
                                -{item.deletedRowCount} baris
                              </td>
                              <td className="p-2.5 font-mono text-[11px] text-slate-700">
                                {item.affectedOrs.join(', ') || '-'}
                              </td>
                              <td className="p-2.5 text-[11px] text-slate-500">{item.user}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>* Seluruh proses penghapusan dilindungi dialog konfirmasi keamanan 2 tahap.</span>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-md cursor-pointer transition-colors"
              >
                Tutup Panel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNIVERSAL TWO-STEP CONFIRMATION MODAL: BATAL VS YA, HAPUS DATA */}
      {confirmationState && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-xl shadow-2xl border-2 border-rose-500 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-rose-600 text-white flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-white shrink-0" />
              <div>
                <h3 className="text-sm font-bold">Konfirmasi Penghapusan Data Permanen</h3>
                <p className="text-[11px] text-rose-100">
                  Tindakan ini tidak dapat dibatalkan. Periksa kembali ringkasan berikut sebelum melanjutkan.
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <div className="p-3.5 bg-rose-50 rounded-lg border border-rose-200 text-xs text-rose-950 space-y-2">
                <div className="flex items-center justify-between border-b border-rose-200 pb-2">
                  <span className="font-semibold text-rose-900">Jenis Penghapusan:</span>
                  <span className="font-bold text-slate-900">{confirmationState.title}</span>
                </div>
                <div className="flex items-center justify-between border-b border-rose-200 pb-2">
                  <span className="font-semibold text-rose-900">{confirmationState.criteriaLabel}:</span>
                  <span className="font-mono font-bold text-rose-800 text-sm">
                    {confirmationState.criteriaValue}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-rose-200 pb-2">
                  <span className="font-semibold text-rose-900">Keterangan:</span>
                  <span className="font-medium text-slate-800 text-right max-w-xs truncate">
                    {confirmationState.summaryDescription}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 text-sm">
                  <span className="font-bold text-rose-900">Jumlah Baris Terdampak:</span>
                  <span className="font-mono font-black text-rose-700">
                    {confirmationState.rowCount} Baris Material
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1">
                <p className="font-bold text-slate-800">Aturan Keamanan Sistem:</p>
                <p>• Baris material yang memenuhi kriteria di atas akan dihapus permanen.</p>
                <p>• Data di luar kriteria terpilih dipastikan tetap aman dan utuh.</p>
                <p>• Master data material umum yang digunakan OR lain tidak akan terpengaruh.</p>
              </div>

              <div className="p-2.5 bg-red-100 border border-red-300 rounded text-center text-xs font-bold text-red-900">
                Peringatan: Tindakan ini permanen dan TIDAK DAPAT DIBATALKAN.
              </div>
            </div>

            {/* Two Action Buttons: Batal vs Ya, Hapus Data */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmationState(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-md cursor-pointer transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const fn = confirmationState.onConfirm;
                  setConfirmationState(null);
                  fn();
                }}
                className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Ya, Hapus Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
