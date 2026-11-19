import React, { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { usePpic } from '../../context/PpicContext';
import { ProductionSchedule, WorksheetPdfItem, WorksheetMaterialItem } from '../../types/ppic';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  AlertTriangle,
  Info,
  Layers,
  Edit2,
  Trash2,
  X,
  CheckCircle,
  Eye,
  ShieldAlert,
  Search,
  Hash,
  Upload,
  FileSpreadsheet,
  Paperclip,
  Loader2,
  CheckCircle2,
  FileWarning,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { getIndonesianHolidayInfo, DayHolidayInfo } from '../../utils/indonesianHolidays';
import {
  buildWorksheetSnapshot,
  findLatestUploadForOr,
  matchMaterialsWithMasterData,
  refreshScheduleWorksheetsSnapshot,
  WorksheetMaterialMatched,
} from '../../utils/pdfWorksheetParser';
import {
  ExtractedScheduleExcel,
  parseScheduleExcelFile,
} from '../../utils/scheduleExcelParser';
import { formatPpicNumber } from '../../utils/excelMaterialParser';
import {
  fetchLatestUploadMaterialsForOrs,
  getSupabaseCredentials,
} from '../../lib/supabase';
import { generateUuid } from '../../utils/uuid';
import {
  computeScrollLeftForDay,
  computeZoomPreservedScrollLeft,
  DEFAULT_GANTT_ZOOM,
  DEFAULT_PRODUCTION_LINES,
  GANTT_LANE_GAP_PX,
  GANTT_LANE_HEIGHT_PX,
  GANTT_ROW_PADDING_Y_PX,
  GANTT_STICKY_LINE_COL_WIDTH_PX,
  GANTT_ZOOM_LEVELS,
  GanttBarDisplayMeta,
  GanttZoomLevel,
  getDisplayProductionLineLabel,
  getGanttBoardWidthPx,
  getGanttDayColumnWidthPx,
  getNextGanttZoomLevel,
  groupSchedulesForGanttBoard,
  isFinishBeforeStart,
  normalizeAssignedProductionLine,
  resolveGanttBarDisplayMeta,
  resolveGanttEscAction,
} from '../../utils/ganttScheduleUtils';
import {
  LineConflictSummary,
  resolveScheduleOrForConflict,
  summarizeLineConflicts,
} from '../../utils/ppicCalculations';

interface FormExcelMaterial {
  id: string;
  materialCode: string;
  materialName: string;
  unit: string;
  total: number | null;
  rawTotal?: string;
  receivedQty?: number | null;
  status?: 'READY' | 'BELUM READY' | null;
  isFoundInMasterData?: boolean;
  matchedUploadId?: string | null;
  matchedUploadDate?: string | null;
  matchedUploadTime?: string | null;
  matchedUploadCreatedAt?: string | null;
  matchedAt?: string | null;
}

interface FormExcelScheduleItem {
  id: string;
  file?: File;
  fileName: string;
  status: 'parsing' | 'success' | 'error';
  error?: string;
  orNumber?: string;
  rawSource?: string;
  productionNumber?: string; // Nomor Produksi dari kolom Reference
  style?: string;
  target?: number | null;
  rawTarget?: string;
  productionLine?: string; // Opsional input manual (kosong -> 'Belum Ditentukan')
  productionDate: string; // Input manual per jadwal
  finishDate: string; // Input manual per jadwal
  needsReview?: boolean;
  reviewConfirmed?: boolean;
  reviewReasons?: string[];
  materials?: FormExcelMaterial[];
  matchedUploadId?: string | null;
  matchedUploadDate?: string | null;
  matchedUploadTime?: string | null;
  matchedUploadCreatedAt?: string | null;
  lastSyncedAt?: string | null;
}

export const ProductionScheduleView: React.FC = () => {
  const {
    productionSchedules,
    scheduleConflicts,
    addProductionSchedule,
    updateProductionSchedule,
    deleteProductionSchedule,
    getStyleForOr,
    saveOrStyleRelation,
    setActiveMenu,
    registeredOrNumbers,
    materialRequirements,
    uploadHistory,
    pendingScheduleSyncs,
    retryingScheduleSyncOr,
    retryPendingScheduleSync,
    dismissPendingScheduleSync,
  } = usePpic();

  const [uploadedExcels, setUploadedExcels] = useState<FormExcelScheduleItem[]>([]);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [isProcessingExcels, setIsProcessingExcels] = useState<boolean>(false);
  const [replacingItemId, setReplacingItemId] = useState<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);

  const [detailSelectedWsId, setDetailSelectedWsId] = useState<string | null>(null);
  const [isRefreshingSnapshot, setIsRefreshingSnapshot] = useState<boolean>(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
  } | null>(null);
  const [isRefreshingFormPreview, setIsRefreshingFormPreview] = useState<boolean>(false);

  // Calendar Month Navigation: Default to November 2026
  const [currentYear, setCurrentYear] = useState<number>(2026);
  const [currentMonth, setCurrentMonth] = useState<number>(10); // 0-indexed: 10 = November
  const [orSearchInput, setOrSearchInput] = useState<string>('');
  const [ganttZoom, setGanttZoom] = useState<GanttZoomLevel>(DEFAULT_GANTT_ZOOM);
  const [isGanttFullscreen, setIsGanttFullscreen] = useState<boolean>(false);
  const ganttScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttFullscreenRef = useRef<HTMLDivElement | null>(null);
  const pendingZoomScrollRef = useRef<number | null>(null);
  const pendingScrollToDayRef = useRef<number | null>(null);
  const pendingFullscreenScrollRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null);
  const lastKnownGanttScrollRef = useRef<{ scrollLeft: number; scrollTop: number }>({
    scrollLeft: 0,
    scrollTop: 0,
  });
  const lastEscClosedModalAtRef = useRef<number>(0);
  const [hoveredBarTooltip, setHoveredBarTooltip] = useState<{
    meta: GanttBarDisplayMeta;
    lineLabel: string;
    productionDate: string;
    finishDate: string;
    hasConflict: boolean;
    anchorRect: { left: number; top: number; bottom: number; width: number };
  } | null>(null);

  const dayColWidthPx = getGanttDayColumnWidthPx(ganttZoom);
  const ganttBoardWidthPx = getGanttBoardWidthPx(ganttZoom);
  const ganttGridTemplateColumns = `${GANTT_STICKY_LINE_COL_WIDTH_PX}px repeat(31, ${dayColWidthPx}px)`;

  const handleSetGanttZoom = (nextZoom: GanttZoomLevel) => {
    if (nextZoom === ganttZoom) return;
    const scroller = ganttScrollRef.current;
    if (scroller) {
      pendingZoomScrollRef.current = computeZoomPreservedScrollLeft({
        currentScrollLeft: scroller.scrollLeft,
        clientWidth: scroller.clientWidth,
        prevZoom: ganttZoom,
        nextZoom,
      });
    }
    setGanttZoom(nextZoom);
  };

  const enterGanttFullscreen = () => {
    if (isGanttFullscreen) return;
    const scroller = ganttScrollRef.current;
    if (scroller) {
      const pos = { scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop };
      lastKnownGanttScrollRef.current = pos;
      pendingFullscreenScrollRef.current = pos;
    }
    setIsGanttFullscreen(true);
    const el = ganttFullscreenRef.current;
    if (el && typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
      Promise.resolve(el.requestFullscreen()).catch(() => {
        // Fallback viewport fullscreen remains active via isGanttFullscreen
      });
    }
  };

  const exitGanttFullscreen = () => {
    if (!isGanttFullscreen && !document.fullscreenElement) return;
    const scroller = ganttScrollRef.current;
    const pos = scroller
      ? { scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop }
      : lastKnownGanttScrollRef.current;
    lastKnownGanttScrollRef.current = pos;
    pendingFullscreenScrollRef.current = pos;
    setIsGanttFullscreen(false);
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      Promise.resolve(document.exitFullscreen()).catch(() => {});
    }
  };

  const toggleGanttFullscreen = () => {
    if (isGanttFullscreen) {
      exitGanttFullscreen();
    } else {
      enterGanttFullscreen();
    }
  };

  const handleGoToToday = () => {
    const now = new Date();
    const targetYear = now.getFullYear();
    const targetMonth = now.getMonth();
    const targetDay = now.getDate();
    pendingScrollToDayRef.current = targetDay;
    if (currentYear === targetYear && currentMonth === targetMonth) {
      const scroller = ganttScrollRef.current;
      if (scroller) {
        scroller.scrollLeft = computeScrollLeftForDay({
          day: targetDay,
          clientWidth: scroller.clientWidth,
          zoomPercent: ganttZoom,
        });
        pendingScrollToDayRef.current = null;
      }
    } else {
      setCurrentYear(targetYear);
      setCurrentMonth(targetMonth);
    }
  };

  useLayoutEffect(() => {
    const scroller = ganttScrollRef.current;
    if (!scroller) return;
    if (pendingZoomScrollRef.current !== null) {
      scroller.scrollLeft = pendingZoomScrollRef.current;
      pendingZoomScrollRef.current = null;
      return;
    }
    if (pendingScrollToDayRef.current !== null) {
      scroller.scrollLeft = computeScrollLeftForDay({
        day: pendingScrollToDayRef.current,
        clientWidth: scroller.clientWidth,
        zoomPercent: ganttZoom,
      });
      pendingScrollToDayRef.current = null;
      return;
    }
    if (pendingFullscreenScrollRef.current !== null) {
      scroller.scrollLeft = pendingFullscreenScrollRef.current.scrollLeft;
      scroller.scrollTop = pendingFullscreenScrollRef.current.scrollTop;
      pendingFullscreenScrollRef.current = null;
    }
  }, [ganttZoom, currentYear, currentMonth, isGanttFullscreen]);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingOriginalLine, setEditingOriginalLine] = useState<string>('');
  const [activeDetailSchedule, setActiveDetailSchedule] = useState<ProductionSchedule | null>(null);
  const [activeLineConflictAudit, setActiveLineConflictAudit] = useState<{
    lineLabel: string;
    schedules: ProductionSchedule[];
    summary: LineConflictSummary;
  } | null>(null);

  // Manual Form State (used when creating/editing manually without uploaded Excel files)
  const [formData, setFormData] = useState<{
    orNumber: string;
    productionNumber: string;
    productionLine: string;
    productionDate: string;
    finishDate: string;
    style: string;
    target: number;
    status: ProductionSchedule['status'];
  }>({
    orNumber: '',
    productionNumber: '',
    productionLine: '',
    productionDate: '2026-11-05',
    finishDate: '2026-11-09',
    style: '',
    target: 2500,
    status: 'Terjadwal',
  });

  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [createDraftId, setCreateDraftId] = useState<string>(() => generateUuid());
  const [isSubmittingForm, setIsSubmittingForm] = useState<boolean>(false);
  const [isDeletingSchedule, setIsDeletingSchedule] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [crudFeedback, setCrudFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Sync browser native Fullscreen API exit (e.g. Esc key when supported)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeActive =
        Boolean(document.fullscreenElement) &&
        document.fullscreenElement === ganttFullscreenRef.current;
      if (!isNativeActive && isGanttFullscreen) {
        if (Date.now() - lastEscClosedModalAtRef.current < 300) {
          return;
        }
        pendingFullscreenScrollRef.current = { ...lastKnownGanttScrollRef.current };
        setIsGanttFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isGanttFullscreen]);

  // Prevent background page scroll while Gantt Full Screen is active
  useEffect(() => {
    if (!isGanttFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isGanttFullscreen]);

  // Escape key closes open modals first, and only exits Full Screen when no modal is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const action = resolveGanttEscAction({
        isGanttFullscreen,
        hasConfirmDelete: Boolean(confirmDeleteId),
        hasEditModal: isModalOpen,
        hasDetailModal: Boolean(activeDetailSchedule),
        hasConflictModal: Boolean(activeLineConflictAudit),
      });
      if (action === 'noop') return;

      e.preventDefault();
      if (action === 'close_confirm_delete') {
        if (!isDeletingSchedule) {
          lastEscClosedModalAtRef.current = Date.now();
          setConfirmDeleteId(null);
        }
        return;
      }
      if (action === 'close_edit_modal') {
        if (!isSubmittingForm) {
          lastEscClosedModalAtRef.current = Date.now();
          setIsModalOpen(false);
        }
        return;
      }
      if (action === 'close_detail_modal') {
        if (!isDeletingSchedule) {
          lastEscClosedModalAtRef.current = Date.now();
          setActiveDetailSchedule(null);
        }
        return;
      }
      if (action === 'close_conflict_modal') {
        lastEscClosedModalAtRef.current = Date.now();
        setActiveLineConflictAudit(null);
        return;
      }
      if (action === 'exit_fullscreen') {
        exitGanttFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    isGanttFullscreen,
    confirmDeleteId,
    isModalOpen,
    activeDetailSchedule,
    activeLineConflictAudit,
    isDeletingSchedule,
    isSubmittingForm,
  ]);

  const availableOrList = registeredOrNumbers;

  // Fixed 5 Production Lines + any additional assigned Line names from saved schedules (for optional datalist suggestions)
  const existingProductionLines = useMemo(() => {
    const unique = new Map<string, string>();
    for (const fixedLine of DEFAULT_PRODUCTION_LINES) {
      unique.set(fixedLine.toLowerCase(), fixedLine);
    }
    for (const s of productionSchedules) {
      const assigned = normalizeAssignedProductionLine(s.productionLine);
      if (assigned && !unique.has(assigned.toLowerCase())) {
        unique.set(assigned.toLowerCase(), assigned);
      }
    }
    return Array.from(unique.values()).sort((a, b) =>
      a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' })
    );
  }, [productionSchedules]);

  const getDefaultDateRange = () => {
    const padM = String(currentMonth + 1).padStart(2, '0');
    return {
      start: `${currentYear}-${padM}-05`,
      end: `${currentYear}-${padM}-09`,
    };
  };

  // Month switching
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];

  const daysInMonth = useMemo(() => {
    return new Date(currentYear, currentMonth + 1, 0).getDate();
  }, [currentYear, currentMonth]);

  const todayDateParts = useMemo(() => {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month0: now.getMonth(),
      day: now.getDate(),
    };
  }, []);

  const daysArray = useMemo(() => {
    const days: Array<{
      day: number;
      dateStr: string;
      dayName: string;
      isSunday: boolean;
      isSaturday: boolean;
      isWeekend: boolean;
      holidayInfo: DayHolidayInfo;
    }> = [];
    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(currentYear, currentMonth, d);
      const dayOfWeek = dateObj.getDay();
      const padM = String(currentMonth + 1).padStart(2, '0');
      const padD = String(d).padStart(2, '0');
      const dateStr = `${currentYear}-${padM}-${padD}`;
      const holidayInfo = getIndonesianHolidayInfo(dateStr);
      days.push({
        day: d,
        dateStr,
        dayName: dayNames[dayOfWeek],
        isSunday: dayOfWeek === 0,
        isSaturday: dayOfWeek === 6,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        holidayInfo,
      });
    }
    return days;
  }, [currentYear, currentMonth, daysInMonth]);

  const holidayStats = useMemo(() => {
    let sundays = 0;
    let nationalHolidays = 0;
    let cutiBersama = 0;
    for (const d of daysArray) {
      if (d.holidayInfo.isHoliday) {
        if (d.holidayInfo.type === 'SUNDAY') sundays++;
        else if (d.holidayInfo.type === 'NATIONAL_HOLIDAY') nationalHolidays++;
        else if (d.holidayInfo.type === 'CUTI_BERSAMA') cutiBersama++;
      }
    }
    return {
      sundays,
      nationalHolidays,
      cutiBersama,
      totalHolidays: sundays + nationalHolidays + cutiBersama,
      workingDays: daysInMonth - (sundays + nationalHolidays + cutiBersama),
    };
  }, [daysArray, daysInMonth]);

  // Form: Auto-fill Style when manual OR changes
  const handleOrChange = (orNum: string) => {
    const clean = orNum.trim().toUpperCase();
    const matchedStyle = getStyleForOr(clean);
    setFormData((prev) => ({
      ...prev,
      orNumber: clean,
      style: matchedStyle ? matchedStyle : prev.style,
    }));
  };

  // Open Create Modal
  const openCreateModal = () => {
    const defaults = getDefaultDateRange();
    setModalMode('create');
    setEditingScheduleId(null);
    setEditingOriginalLine('');
    setCreateDraftId(generateUuid());
    setIsSubmittingForm(false);
    setUploadedExcels([]);
    setSelectedPreviewId(null);
    setFormData({
      orNumber: availableOrList[0] || '',
      productionNumber: '',
      productionLine: '',
      productionDate: defaults.start,
      finishDate: defaults.end,
      style: availableOrList[0] ? getStyleForOr(availableOrList[0]) || '' : '',
      target: 0,
      status: 'Terjadwal',
    });
    setFormValidationError(null);
    setCrudFeedback(null);
    setIsModalOpen(true);
  };

  // Open Edit Modal (mempertahankan snapshot tersimpan tanpa auto-rematch)
  const openEditModal = (sch: ProductionSchedule) => {
    const assignedLine = normalizeAssignedProductionLine(sch.productionLine);
    setModalMode('edit');
    setEditingScheduleId(sch.id);
    setEditingOriginalLine(assignedLine);
    setIsSubmittingForm(false);
    if (sch.worksheets && sch.worksheets.length > 0) {
      const existing: FormExcelScheduleItem[] = sch.worksheets.map((ws) => ({
        id: ws.id,
        fileName: ws.fileName,
        status: 'success' as const,
        orNumber: ws.orNumber,
        rawSource: ws.rawOrNumber,
        productionNumber: ws.worksheetNo || '',
        style: ws.style,
        target: ws.target,
        productionLine: assignedLine,
        productionDate: sch.productionDate,
        finishDate: sch.finishDate,
        materials: (ws.materials || []).map((m, idx) => ({
          id: m.id || `wsm-${idx + 1}`,
          materialCode: m.materialCode,
          materialName: m.materialName,
          unit: m.unit,
          total: m.total,
          receivedQty: m.receivedQty ?? null,
          status: m.status ?? null,
          isFoundInMasterData: m.isFoundInMasterData,
          matchedUploadId: m.matchedUploadId ?? ws.matchedUploadId ?? null,
          matchedUploadDate: m.matchedUploadDate ?? ws.matchedUploadDate ?? null,
          matchedUploadTime: m.matchedUploadTime ?? ws.matchedUploadTime ?? null,
          matchedUploadCreatedAt: m.matchedUploadCreatedAt ?? ws.matchedUploadCreatedAt ?? null,
          matchedAt: m.matchedAt ?? ws.lastSyncedAt ?? null,
        })),
        matchedUploadId: ws.matchedUploadId ?? null,
        matchedUploadDate: ws.matchedUploadDate ?? null,
        matchedUploadTime: ws.matchedUploadTime ?? null,
        matchedUploadCreatedAt: ws.matchedUploadCreatedAt ?? null,
        lastSyncedAt: ws.lastSyncedAt ?? ws.uploadedAt ?? null,
      }));
      setUploadedExcels(existing);
      setSelectedPreviewId(existing[0]?.id || null);
    } else {
      setUploadedExcels([]);
      setSelectedPreviewId(null);
    }
    setFormData({
      orNumber: sch.orNumber,
      productionNumber: sch.worksheets?.[0]?.worksheetNo || '',
      productionLine: assignedLine,
      productionDate: sch.productionDate,
      finishDate: sch.finishDate,
      style: sch.style,
      target: sch.target,
      status: sch.status || 'Terjadwal',
    });
    setFormValidationError(null);
    setDetailActionError(null);
    setConfirmDeleteId(null);
    setActiveDetailSchedule(null);
    setRefreshFeedback(null);
    setCrudFeedback(null);
    setIsModalOpen(true);
  };

  const revalidateExcelItem = (item: FormExcelScheduleItem): FormExcelScheduleItem => {
    if (item.status !== 'success') return item;
    const reasons: string[] = [];

    if (!item.orNumber?.trim()) {
      reasons.push('Nomor OR (dari kolom Source) masih kosong.');
    }
    if (!item.productionNumber?.trim()) {
      reasons.push('Nomor Produksi (dari kolom Reference) masih kosong.');
    }
    if (!item.style?.trim()) {
      reasons.push('Style (dari kolom Style List/Display Name) masih kosong.');
    }
    if (item.target === null || item.target === undefined || !Number.isFinite(item.target) || item.target <= 0) {
      reasons.push('Target Produksi (Quantity To Produce) harus lebih dari 0.');
    }
    if (!item.productionDate || !item.finishDate) {
      reasons.push('Tanggal Mulai Produksi dan Tanggal Selesai Produksi wajib diisi.');
    } else if (isFinishBeforeStart(item.productionDate, item.finishDate)) {
      reasons.push('Tanggal Selesai Produksi tidak boleh lebih awal dari Tanggal Mulai Produksi.');
    }
    if (!item.materials || item.materials.length === 0) {
      reasons.push('Daftar Raw Materials kosong.');
    } else {
      item.materials.forEach((m, idx) => {
        if (!m.materialCode?.trim()) {
          reasons.push(`Baris material ke-${idx + 1}: Kode Material kosong.`);
        }
        if (!m.materialName?.trim()) {
          reasons.push(`Baris material ke-${idx + 1}: Nama Material kosong.`);
        }
        if (!m.unit?.trim()) {
          reasons.push(`Baris material ke-${idx + 1} (${m.materialCode || '-'}): Satuan kosong.`);
        }
        if (m.total === null || m.total === undefined || !Number.isFinite(m.total) || m.total < 0) {
          reasons.push(`Baris material ke-${idx + 1} (${m.materialCode || '-'}): Kebutuhan tidak valid.`);
        }
      });
    }

    const deduped = Array.from(new Set(reasons));
    return {
      ...item,
      needsReview: deduped.length > 0,
      reviewReasons: deduped,
    };
  };

  const handleUpdateExcelField = (
    itemId: string,
    patch: Partial<
      Pick<
        FormExcelScheduleItem,
        | 'orNumber'
        | 'productionNumber'
        | 'style'
        | 'target'
        | 'productionLine'
        | 'productionDate'
        | 'finishDate'
        | 'reviewConfirmed'
      >
    >
  ) => {
    setUploadedExcels((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const next: FormExcelScheduleItem = {
          ...item,
          ...patch,
          reviewConfirmed: patch.reviewConfirmed !== undefined ? patch.reviewConfirmed : false,
        };
        return revalidateExcelItem(next);
      })
    );
  };

  const handleUpdateExcelMaterialRow = (
    itemId: string,
    rowIndex: number,
    patch: Partial<FormExcelMaterial>
  ) => {
    setUploadedExcels((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !item.materials) return item;
        const nextMaterials = item.materials.map((m, idx) =>
          idx === rowIndex ? { ...m, ...patch } : m
        );
        return revalidateExcelItem({
          ...item,
          materials: nextMaterials,
          reviewConfirmed: false,
        });
      })
    );
  };

  /**
   * Matches extracted Excel schedule materials strictly against ONLY the latest Master Data upload
   * for the item's Nomor OR (Nomor OR + Kode Material).
   * If Supabase is configured and the query succeeds (`connected: true`), uses the exact Supabase
   * latest upload set (even if empty -> Diterima & Status become '-').
   */
  const applyExtractedExcelToItem = async (
    targetItem: FormExcelScheduleItem,
    extracted: ExtractedScheduleExcel
  ) => {
    const extractedOr = (extracted.orNumber || '').trim();

    let reqSource = materialRequirements;
    let histSource = uploadHistory;
    if (getSupabaseCredentials().isConfigured && extractedOr) {
      const remoteLatest = await fetchLatestUploadMaterialsForOrs([extractedOr]);
      if (remoteLatest?.connected) {
        histSource = remoteLatest.uploadHistory;
        reqSource = remoteLatest.materialRequirements;
      }
    }

    const syncTimestamp = new Date().toISOString();
    const latestResolution = extractedOr
      ? findLatestUploadForOr(extractedOr, reqSource, histSource)
      : { orNumber: '', latestUpload: null, rows: [] };

    const matchedMaterialsRaw = extractedOr
      ? matchMaterialsWithMasterData(
          extracted.materials || [],
          extractedOr,
          reqSource,
          histSource,
          syncTimestamp
        )
      : (extracted.materials || []).map((m, idx) => ({
          id: m.id || `wsm-${idx + 1}`,
          materialCode: m.materialCode,
          materialName: m.materialName,
          unit: m.unit,
          total: m.total,
          receivedQty: null,
          status: null,
          isFoundInMasterData: false,
        }));

    const mergedMaterials: FormExcelMaterial[] = matchedMaterialsRaw.map((m, idx) => {
      const src = extracted.materials?.[idx];
      return {
        ...m,
        id: src?.id || m.id || `wsm-${idx + 1}`,
        materialCode: src?.materialCode ?? m.materialCode,
        materialName: src?.materialName ?? m.materialName,
        unit: src?.unit ?? m.unit,
        total: src?.total ?? m.total ?? null,
        rawTotal: src?.rawTotal,
      };
    });

    const updatedItem = revalidateExcelItem({
      ...targetItem,
      fileName: extracted.fileName,
      status: 'success',
      error: undefined,
      orNumber: extractedOr,
      rawSource: extracted.rawSource,
      productionNumber: extracted.productionNumber,
      style: extracted.style,
      target: extracted.target,
      rawTarget: extracted.rawTarget,
      materials: mergedMaterials,
      reviewConfirmed: false,
      matchedUploadId: latestResolution.latestUpload?.id || null,
      matchedUploadDate: latestResolution.latestUpload?.updateDate || null,
      matchedUploadTime: latestResolution.latestUpload?.uploadTime || null,
      matchedUploadCreatedAt: latestResolution.latestUpload?.createdAt || null,
      lastSyncedAt: syncTimestamp,
    });

    setUploadedExcels((prev) =>
      prev.map((p) => (p.id === targetItem.id ? updatedItem : p))
    );
  };

  const isSupportedExcelFile = (file: File): boolean => {
    const lower = file.name.toLowerCase();
    return lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.csv');
  };

  // Multi-file Excel upload (independent per file, preview before save)
  const handleExcelFilesUpload = async (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    const excelFiles = rawFiles.filter(isSupportedExcelFile);
    if (excelFiles.length === 0) {
      setFormValidationError('Hanya file Excel (.xls, .xlsx, .csv) yang didukung untuk Production Schedule.');
      return;
    }

    setIsProcessingExcels(true);
    setFormValidationError(null);
    const defaults = getDefaultDateRange();

    const newItems: FormExcelScheduleItem[] = excelFiles.map((f) => ({
      id: `sch-xls-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file: f,
      fileName: f.name,
      status: 'parsing',
      productionLine: modalMode === 'edit' ? editingOriginalLine : '',
      productionDate: defaults.start,
      finishDate: defaults.end,
    }));

    setUploadedExcels((prev) => [...prev, ...newItems]);
    setSelectedPreviewId((prevSelected) => prevSelected || newItems[0]?.id || null);

    for (const item of newItems) {
      try {
        if (!item.file) {
          throw new Error(`File "${item.fileName}" tidak dapat dibaca.`);
        }
        const extracted = await parseScheduleExcelFile(item.file);
        await applyExtractedExcelToItem(item, extracted);
      } catch (err: any) {
        setUploadedExcels((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  status: 'error',
                  error: err?.message || `Gagal membaca file Excel "${item.fileName}".`,
                }
              : p
          )
        );
      }
    }

    setIsProcessingExcels(false);
  };

  // Replace a single Excel file in preview without disturbing other files
  const handleReplaceExcelFile = async (itemId: string, file: File) => {
    if (!isSupportedExcelFile(file)) {
      setFormValidationError('File pengganti harus berformat .xls, .xlsx, atau .csv.');
      return;
    }
    const existing = uploadedExcels.find((p) => p.id === itemId);
    if (!existing) return;

    setIsProcessingExcels(true);
    setFormValidationError(null);

    const pendingItem: FormExcelScheduleItem = {
      ...existing,
      file,
      fileName: file.name,
      status: 'parsing',
      error: undefined,
    };
    setUploadedExcels((prev) => prev.map((p) => (p.id === itemId ? pendingItem : p)));

    try {
      const extracted = await parseScheduleExcelFile(file);
      await applyExtractedExcelToItem(pendingItem, extracted);
      setSelectedPreviewId(itemId);
    } catch (err: any) {
      setUploadedExcels((prev) =>
        prev.map((p) =>
          p.id === itemId
            ? {
                ...p,
                status: 'error',
                error: err?.message || `Gagal membaca file Excel "${file.name}".`,
              }
            : p
        )
      );
    } finally {
      setIsProcessingExcels(false);
    }
  };

  const handleRemoveExcel = (itemId: string) => {
    setUploadedExcels((prev) => {
      const next = prev.filter((p) => p.id !== itemId);
      if (selectedPreviewId === itemId) {
        setSelectedPreviewId(next[0]?.id || null);
      }
      return next;
    });
  };

  // Re-check Master Data availability on Preview (only updates Diterima & Status; aborts on Supabase error)
  const handleRefreshFormExcelSnapshots = async () => {
    const successItems = uploadedExcels.filter(
      (p) => p.status === 'success' && p.materials && p.materials.length > 0
    );
    if (successItems.length === 0) return;

    setIsRefreshingFormPreview(true);
    setFormValidationError(null);
    try {
      let reqSource = materialRequirements;
      let histSource = uploadHistory;
      if (getSupabaseCredentials().isConfigured) {
        const ors = successItems.map((p) => p.orNumber || '').filter(Boolean);
        const remoteLatest = await fetchLatestUploadMaterialsForOrs(ors);
        if (!remoteLatest || !remoteLatest.connected) {
          setFormValidationError(
            'Gagal mengambil data Master Data terbaru dari Supabase. Snapshot preview lama tetap dipertahankan.'
          );
          return;
        }
        histSource = remoteLatest.uploadHistory;
        reqSource = remoteLatest.materialRequirements;
      }

      const nowIso = new Date().toISOString();
      setUploadedExcels((prev) =>
        prev.map((p) => {
          if (p.status !== 'success' || !p.materials) return p;
          const targetOr = (p.orNumber || '').trim();
          const latestRes = targetOr
            ? findLatestUploadForOr(targetOr, reqSource, histSource)
            : { orNumber: '', latestUpload: null, rows: [] };
          const matchedRows = targetOr
            ? matchMaterialsWithMasterData(
                p.materials.map((m) => ({
                  materialCode: m.materialCode,
                  materialName: m.materialName,
                  unit: m.unit,
                  total: m.total,
                })),
                targetOr,
                reqSource,
                histSource,
                nowIso
              )
            : p.materials;

          return {
            ...p,
            materials: p.materials.map((orig, idx) => ({
              ...orig,
              receivedQty: matchedRows[idx]?.receivedQty ?? null,
              status: matchedRows[idx]?.status ?? null,
              isFoundInMasterData: matchedRows[idx]?.isFoundInMasterData ?? false,
              matchedUploadId: matchedRows[idx]?.matchedUploadId ?? latestRes.latestUpload?.id ?? null,
              matchedUploadDate: matchedRows[idx]?.matchedUploadDate ?? latestRes.latestUpload?.updateDate ?? null,
              matchedUploadTime: matchedRows[idx]?.matchedUploadTime ?? latestRes.latestUpload?.uploadTime ?? null,
              matchedUploadCreatedAt:
                matchedRows[idx]?.matchedUploadCreatedAt ?? latestRes.latestUpload?.createdAt ?? null,
              matchedAt: nowIso,
            })),
            matchedUploadId: latestRes.latestUpload?.id || null,
            matchedUploadDate: latestRes.latestUpload?.updateDate || null,
            matchedUploadTime: latestRes.latestUpload?.uploadTime || null,
            matchedUploadCreatedAt: latestRes.latestUpload?.createdAt || null,
            lastSyncedAt: nowIso,
          };
        })
      );
    } finally {
      setIsRefreshingFormPreview(false);
    }
  };

  /**
   * Manual Refresh for saved schedule detail snapshot.
   * Rules:
   * - Updates ONLY Diterima & Status Kesiapan from latest Master Data upload per OR.
   * - Preserves OR, Nomor Produksi, Style, Target, Dates, Material Code/Name/Unit/Kebutuhan verbatim.
   * - If Supabase query/network fails, aborts Refresh and preserves the existing snapshot unchanged.
   */
  const handleRefreshScheduleSnapshot = async () => {
    if (!activeDetailSchedule || !activeDetailSchedule.worksheets || activeDetailSchedule.worksheets.length === 0) {
      return;
    }

    setIsRefreshingSnapshot(true);
    setRefreshFeedback(null);
    try {
      let reqSource = materialRequirements;
      let histSource = uploadHistory;

      if (getSupabaseCredentials().isConfigured) {
        const orList = activeDetailSchedule.worksheets.map((ws) => ws.orNumber).filter(Boolean);
        const remoteLatest = await fetchLatestUploadMaterialsForOrs(orList);
        if (!remoteLatest || !remoteLatest.connected) {
          setRefreshFeedback({
            type: 'error',
            message:
              'Gagal mengambil Master Data terbaru dari Supabase. Refresh dibatalkan dan snapshot lama tetap dipertahankan.',
          });
          return;
        }
        histSource = remoteLatest.uploadHistory;
        reqSource = remoteLatest.materialRequirements;
      }

      const refreshedWorksheets = refreshScheduleWorksheetsSnapshot(
        activeDetailSchedule.worksheets,
        reqSource,
        histSource
      );

      const updateResult = await updateProductionSchedule(activeDetailSchedule.id, {
        worksheets: refreshedWorksheets,
      });

      if (!updateResult.success) {
        setRefreshFeedback({
          type: 'error',
          message: updateResult.error || 'Gagal menyimpan hasil refresh snapshot ke database. Snapshot lama dipertahankan.',
        });
        return;
      }

      setActiveDetailSchedule((prev) =>
        prev ? { ...(updateResult.schedule || prev), worksheets: refreshedWorksheets } : null
      );

      const matchedOrsCount = refreshedWorksheets.filter((w) => Boolean(w.matchedUploadId || w.matchedUploadDate)).length;
      setRefreshFeedback({
        type: 'success',
        message:
          matchedOrsCount > 0
            ? `Ketersediaan material berhasil disinkronkan dari upload Master Data terbaru (${matchedOrsCount}/${refreshedWorksheets.length} jadwal).`
            : 'Sinkronisasi selesai: belum ada upload Master Data aktif untuk Nomor OR ini (Diterima dan Status Kesiapan disetel ke "-").',
      });
    } catch (err: any) {
      setRefreshFeedback({
        type: 'error',
        message: err?.message || 'Gagal menyegarkan snapshot ketersediaan material. Snapshot lama dipertahankan.',
      });
    } finally {
      setIsRefreshingSnapshot(false);
    }
  };

  const buildFrozenWorksheetFromExcelItem = (
    p: FormExcelScheduleItem,
    saveTimestamp: string
  ): WorksheetPdfItem => {
    const normalizedMaterials: WorksheetMaterialItem[] = (p.materials || []).map((m, idx) => ({
      id: m.id || `wsm-${idx + 1}`,
      materialCode: m.materialCode.trim(),
      materialName: m.materialName.trim(),
      unit: m.unit.trim(),
      total: Number(m.total ?? 0),
      receivedQty: m.receivedQty ?? null,
      status: m.status ?? null,
      isFoundInMasterData: m.isFoundInMasterData,
      matchedUploadId: m.matchedUploadId ?? p.matchedUploadId ?? null,
      matchedUploadDate: m.matchedUploadDate ?? p.matchedUploadDate ?? null,
      matchedUploadTime: m.matchedUploadTime ?? p.matchedUploadTime ?? null,
      matchedUploadCreatedAt: m.matchedUploadCreatedAt ?? p.matchedUploadCreatedAt ?? null,
      matchedAt: m.matchedAt ?? p.lastSyncedAt ?? saveTimestamp,
    }));

    const hasExistingSnapshot = Boolean(
      p.lastSyncedAt ||
        normalizedMaterials.some((m) => m.isFoundInMasterData !== undefined || m.matchedAt)
    );

    if (hasExistingSnapshot) {
      return {
        id: p.id,
        fileName: p.fileName,
        orNumber: (p.orNumber || '').trim(),
        rawOrNumber: p.rawSource,
        worksheetNo: (p.productionNumber || '').trim(),
        style: (p.style || '').trim(),
        target: Number(p.target || 0),
        materials: normalizedMaterials,
        uploadedAt: p.lastSyncedAt || saveTimestamp,
        matchedUploadId: p.matchedUploadId ?? null,
        matchedUploadDate: p.matchedUploadDate ?? null,
        matchedUploadTime: p.matchedUploadTime ?? null,
        matchedUploadCreatedAt: p.matchedUploadCreatedAt ?? null,
        lastSyncedAt: p.lastSyncedAt || saveTimestamp,
      };
    }

    return buildWorksheetSnapshot(
      {
        id: p.id,
        fileName: p.fileName,
        orNumber: (p.orNumber || '').trim(),
        rawOrNumber: p.rawSource,
        worksheetNo: (p.productionNumber || '').trim(),
        style: (p.style || '').trim(),
        target: Number(p.target || 0),
        materials: normalizedMaterials,
        uploadedAt: saveTimestamp,
      },
      materialRequirements,
      uploadHistory,
      saveTimestamp
    );
  };

  // Submit Form: 1 Excel file = 1 independent ProductionSchedule on create
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingForm || isProcessingExcels) return;
    setFormValidationError(null);

    const hasExcelItems = uploadedExcels.length > 0;

    if (hasExcelItems) {
      const failedExcels = uploadedExcels.filter((p) => p.status === 'error');
      if (failedExcels.length > 0) {
        setFormValidationError(
          `Tidak dapat menyimpan karena terdapat file Excel yang gagal dibaca (${failedExcels
            .map((p) => p.fileName)
            .join(', ')}). Klik "Ganti File" atau hapus file tersebut.`
        );
        return;
      }

      for (const p of uploadedExcels) {
        if (p.status !== 'success') continue;
        if (!p.orNumber?.trim()) {
          setFormValidationError(`Nomor OR pada "${p.fileName}" masih kosong.`);
          setSelectedPreviewId(p.id);
          return;
        }
        if (!p.productionNumber?.trim()) {
          setFormValidationError(`Nomor Produksi (Reference) pada "${p.fileName}" masih kosong.`);
          setSelectedPreviewId(p.id);
          return;
        }
        if (!p.style?.trim()) {
          setFormValidationError(`Style pada "${p.fileName}" masih kosong.`);
          setSelectedPreviewId(p.id);
          return;
        }
        if (p.target === null || p.target === undefined || !Number.isFinite(p.target) || p.target <= 0) {
          setFormValidationError(`Target Produksi pada "${p.fileName}" harus lebih dari 0.`);
          setSelectedPreviewId(p.id);
          return;
        }
        if (!p.productionDate || !p.finishDate) {
          setFormValidationError(
            `Tanggal Mulai dan Tanggal Selesai Produksi pada "${p.fileName}" wajib diisi secara manual.`
          );
          setSelectedPreviewId(p.id);
          return;
        }
        if (isFinishBeforeStart(p.productionDate, p.finishDate)) {
          setFormValidationError(
            `Tanggal Selesai Produksi pada "${p.fileName}" tidak boleh lebih awal dari Tanggal Mulai Produksi.`
          );
          setSelectedPreviewId(p.id);
          return;
        }
        if (!p.materials || p.materials.length === 0) {
          setFormValidationError(`Daftar material pada "${p.fileName}" kosong.`);
          setSelectedPreviewId(p.id);
          return;
        }
        const badRowIdx = p.materials.findIndex(
          (m) =>
            !m.materialCode?.trim() ||
            !m.materialName?.trim() ||
            !m.unit?.trim() ||
            m.total === null ||
            m.total === undefined ||
            !Number.isFinite(m.total) ||
            m.total < 0
        );
        if (badRowIdx !== -1) {
          const badRow = p.materials[badRowIdx];
          setFormValidationError(
            `Baris material ke-${badRowIdx + 1} (${badRow.materialCode || '-'}) pada "${p.fileName}" memiliki kolom kosong atau nilai Kebutuhan tidak valid.`
          );
          setSelectedPreviewId(p.id);
          return;
        }
      }
    } else {
      if (!formData.orNumber.trim()) {
        setFormValidationError('Nomor OR wajib diisi atau unggah file Excel Production Schedule.');
        return;
      }
      if (!formData.style.trim()) {
        setFormValidationError('Style wajib diisi.');
        return;
      }
      if (!formData.productionDate || !formData.finishDate) {
        setFormValidationError('Tanggal Mulai Produksi dan Tanggal Selesai Produksi wajib diisi.');
        return;
      }
      if (isFinishBeforeStart(formData.productionDate, formData.finishDate)) {
        setFormValidationError('Tanggal Selesai Produksi tidak boleh lebih awal daripada Tanggal Mulai Produksi.');
        return;
      }
      if (!Number.isFinite(formData.target) || formData.target <= 0) {
        setFormValidationError('Target Produksi harus lebih besar dari 0.');
        return;
      }
    }

    setIsSubmittingForm(true);
    const saveTimestamp = new Date().toISOString();

    try {
      if (hasExcelItems) {
        const validItems = uploadedExcels.filter((p) => p.status === 'success');

        if (modalMode === 'create') {
          const savedOrs: string[] = [];
          for (let idx = 0; idx < validItems.length; idx++) {
            const p = validItems[idx];
            const frozenWs = buildFrozenWorksheetFromExcelItem(p, saveTimestamp);
            const scheduleId = idx === 0 ? createDraftId : generateUuid();
            const cleanOr = (p.orNumber || '').trim().toUpperCase();
            const cleanStyle = (p.style || '').trim();

            const result = await addProductionSchedule({
              id: scheduleId,
              orNumber: cleanOr,
              productionDate: p.productionDate,
              finishDate: p.finishDate,
              productionLine: normalizeAssignedProductionLine(p.productionLine),
              style: cleanStyle,
              target: Number(p.target || 0),
              status: 'Terjadwal',
              worksheets: [frozenWs],
            });

            if (!result.success) {
              setFormValidationError(
                result.error || `Gagal menyimpan jadwal untuk file "${p.fileName}".`
              );
              return;
            }
            saveOrStyleRelation(cleanOr, cleanStyle);
            savedOrs.push(cleanOr);
          }

          // Jump calendar view to the first newly saved schedule's month so the Gantt bar is immediately visible
          const firstDateParts = validItems[0]?.productionDate?.split('-');
          if (firstDateParts && firstDateParts.length === 3) {
            const y = Number(firstDateParts[0]);
            const m = Number(firstDateParts[1]) - 1;
            if (Number.isFinite(y) && Number.isFinite(m) && m >= 0 && m <= 11) {
              setCurrentYear(y);
              setCurrentMonth(m);
            }
          }

          setCrudFeedback({
            type: 'success',
            message:
              savedOrs.length > 1
                ? `${savedOrs.length} jadwal produksi berhasil disimpan (${savedOrs.join(', ')}).`
                : `Jadwal produksi OR ${savedOrs[0]} berhasil disimpan.`,
          });
          setIsModalOpen(false);
          return;
        }

        // Edit mode with Excel items attached
        if (!editingScheduleId) {
          setFormValidationError('ID jadwal yang akan diperbarui tidak ditemukan.');
          return;
        }
        const primary = validItems[0];
        const frozenList = validItems.map((p) => buildFrozenWorksheetFromExcelItem(p, saveTimestamp));
        const cleanOr = (primary.orNumber || '').trim().toUpperCase();
        const cleanStyle = (primary.style || '').trim();
        const totalTarget =
          validItems.length === 1
            ? Number(primary.target || 0)
            : validItems.reduce((acc, p) => acc + Number(p.target || 0), 0);

        const result = await updateProductionSchedule(editingScheduleId, {
          orNumber: cleanOr,
          productionDate: primary.productionDate,
          finishDate: primary.finishDate,
          productionLine: normalizeAssignedProductionLine(
            primary.productionLine !== undefined ? primary.productionLine : editingOriginalLine
          ),
          style: cleanStyle,
          target: totalTarget,
          status: formData.status,
          worksheets: frozenList,
        });

        if (!result.success) {
          setFormValidationError(result.error || 'Gagal menyimpan perubahan jadwal produksi.');
          return;
        }

        frozenList.forEach((ws) => {
          if (ws.orNumber && ws.style) {
            saveOrStyleRelation(ws.orNumber.trim().toUpperCase(), ws.style.trim());
          }
        });

        setCrudFeedback({
          type: 'success',
          message: `Perubahan jadwal produksi ${cleanOr} berhasil disimpan.`,
        });
        setIsModalOpen(false);
        return;
      }

      // Manual schedule without uploaded Excel
      const cleanOr = formData.orNumber.trim().toUpperCase();
      const cleanStyle = formData.style.trim();
      const manualPayload = {
        orNumber: cleanOr,
        productionDate: formData.productionDate,
        finishDate: formData.finishDate,
        productionLine: normalizeAssignedProductionLine(formData.productionLine),
        style: cleanStyle,
        target: Number(formData.target),
        status: formData.status,
      };

      const result =
        modalMode === 'create'
          ? await addProductionSchedule({ id: createDraftId, ...manualPayload })
          : editingScheduleId
            ? await updateProductionSchedule(editingScheduleId, manualPayload)
            : { success: false, error: 'ID jadwal yang akan diperbarui tidak ditemukan.' };

      if (!result.success) {
        setFormValidationError(result.error || 'Gagal menyimpan jadwal produksi.');
        return;
      }

      saveOrStyleRelation(cleanOr, cleanStyle);

      if (modalMode === 'create') {
        const parts = manualPayload.productionDate.split('-');
        if (parts.length === 3) {
          const y = Number(parts[0]);
          const m = Number(parts[1]) - 1;
          if (Number.isFinite(y) && Number.isFinite(m) && m >= 0 && m <= 11) {
            setCurrentYear(y);
            setCurrentMonth(m);
          }
        }
      }

      setCrudFeedback({
        type: 'success',
        message:
          modalMode === 'create'
            ? `Jadwal produksi ${cleanOr} berhasil disimpan.`
            : `Perubahan jadwal produksi ${cleanOr} berhasil disimpan.`,
      });
      setIsModalOpen(false);
    } catch (err: any) {
      setFormValidationError(err?.message || 'Terjadi kesalahan saat menyimpan jadwal produksi.');
    } finally {
      setIsSubmittingForm(false);
    }
  };

  // Delete Schedule (inline confirmation + await persistence result)
  const confirmDeleteSchedule = async (id: string) => {
    if (isDeletingSchedule) return;
    setIsDeletingSchedule(true);
    setDetailActionError(null);
    try {
      const res = await deleteProductionSchedule(id);
      if (!res.success) {
        setConfirmDeleteId(null);
        setDetailActionError(res.error || 'Gagal menghapus jadwal produksi.');
        return;
      }
      setConfirmDeleteId(null);
      setActiveDetailSchedule(null);
      setCrudFeedback({
        type: 'success',
        message: 'Jadwal produksi berhasil dihapus.',
      });
    } catch (err: any) {
      setConfirmDeleteId(null);
      setDetailActionError(err?.message || 'Terjadi kesalahan saat menghapus jadwal produksi.');
    } finally {
      setIsDeletingSchedule(false);
    }
  };

  // Visible schedules matching search filter across the board
  const filteredSchedules = useMemo(() => {
    return productionSchedules.filter((s) => {
      if (orSearchInput.trim()) {
        const q = orSearchInput.trim().toUpperCase();
        const matchOr = s.orNumber.toUpperCase().includes(q);
        const matchStyle = (s.style || '').toUpperCase().includes(q);
        const matchProdNo = (s.worksheets?.[0]?.worksheetNo || '').toUpperCase().includes(q);
        if (!matchOr && !matchStyle && !matchProdNo) return false;
      }
      return true;
    });
  }, [productionSchedules, orSearchInput]);

  // Group schedules by Line Produksi and pack bars horizontally onto non-overlapping lanes per Line
  const ganttLineGroups = useMemo(() => {
    return groupSchedulesForGanttBoard(filteredSchedules, {
      year: currentYear,
      month0: currentMonth,
      daysInMonth,
    });
  }, [filteredSchedules, currentYear, currentMonth, daysInMonth]);

  const getBlockColor = (sch: ProductionSchedule) => {
    const colors = [
      { bg: 'bg-blue-600 hover:bg-blue-700', border: 'border-blue-700', text: 'text-white', badge: 'bg-blue-800 text-blue-100' },
      { bg: 'bg-teal-600 hover:bg-teal-700', border: 'border-teal-700', text: 'text-white', badge: 'bg-teal-800 text-teal-100' },
      { bg: 'bg-indigo-600 hover:bg-indigo-700', border: 'border-indigo-700', text: 'text-white', badge: 'bg-indigo-800 text-indigo-100' },
      { bg: 'bg-emerald-600 hover:bg-emerald-700', border: 'border-emerald-700', text: 'text-white', badge: 'bg-emerald-800 text-emerald-100' },
      { bg: 'bg-cyan-700 hover:bg-cyan-800', border: 'border-cyan-800', text: 'text-white', badge: 'bg-cyan-950 text-cyan-100' },
    ];
    const hash = (sch.orNumber || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  return (
    <div className="space-y-6">
      {/* Hidden input for per-card Replace Excel File */}
      <input
        ref={replaceFileInputRef}
        type="file"
        accept=".xls,.xlsx,.csv"
        className="hidden"
        onChange={(e) => {
          const targetId = replacingItemId;
          const file = e.target.files?.[0];
          e.target.value = '';
          setReplacingItemId(null);
          if (targetId && file) {
            handleReplaceExcelFile(targetId, file);
          }
        }}
      />

      {/* Header bar */}
      <div className="p-5 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base md:text-lg font-bold text-slate-900">
              Production Planning Board (Gantt Calendar)
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold">
              Gantt View
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Unggah file Excel Production Schedule (`.xls` / `.xlsx`) dan atur rentang tanggal produksi. Klik blok jadwal untuk melihat detail, edit, atau hapus.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={openCreateModal}
            className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tambah Jadwal Produksi
          </button>
        </div>
      </div>

      {/* Pending Schedule Snapshot Sync Recovery Banner (No Master Data Re-upload Required) */}
      {pendingScheduleSyncs.length > 0 && (
        <div
          role="alert"
          data-testid="pending-schedule-sync-banner"
          className="p-3.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 text-xs space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Terdapat jadwal produksi yang belum tersinkronkan dengan upload Master Data terbaru:
            </span>
          </div>
          <div className="space-y-1.5">
            {pendingScheduleSyncs.map((rec) => {
              const isRetrying = retryingScheduleSyncOr === rec.targetOr;
              return (
                <div
                  key={rec.targetOr}
                  className="p-2.5 bg-white border border-amber-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      OR {rec.targetOr} ({rec.syncedCount}/{rec.totalTargetSchedules} jadwal tersinkronkan, {rec.failedDetails.length || 'sebagian'} gagal)
                    </div>
                    <div className="text-[11px] text-rose-700">{rec.lastError}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isRetrying}
                      onClick={async () => {
                        const retryRes = await retryPendingScheduleSync(rec.targetOr);
                        if (retryRes.status === 'success' || retryRes.status === 'no_schedules') {
                          setCrudFeedback({
                            type: 'success',
                            message: `Pemulihan sinkronisasi selesai: ${retryRes.syncedScheduleIds.length} jadwal OR ${rec.targetOr} diperbarui dengan Master Data terbaru.`,
                          });
                        } else {
                          setCrudFeedback({
                            type: 'error',
                            message:
                              retryRes.error ||
                              `Sinkronisasi ulang jadwal OR ${rec.targetOr} belum berhasil.`,
                          });
                        }
                      }}
                      className="px-3 py-1.5 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                      {isRetrying ? 'Menyinkronkan...' : 'Sinkronkan Ulang (Tanpa Upload Ulang)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissPendingScheduleSync(rec.targetOr)}
                      className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                      aria-label={`Abaikan pemulihan ${rec.targetOr}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CRUD Feedback Banner */}
      {crudFeedback && (
        <div
          role="status"
          className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
            crudFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {crudFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{crudFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setCrudFeedback(null)}
            className="text-slate-500 hover:text-slate-700 p-0.5"
            aria-label="Tutup notifikasi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Toolbar: Month Navigation & OR/Style Search */}
      <div className="p-3.5 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Month Selector */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-700 transition-colors"
            title="Bulan Sebelumnya"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-md">
            <Calendar className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-bold text-slate-900 min-w-36 text-center">
              {monthNames[currentMonth]} {currentYear}
            </span>
          </div>

          <button
            onClick={handleNextMonth}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-700 transition-colors"
            title="Bulan Berikutnya"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleGoToToday}
            data-testid="gantt-today-button"
            className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 ml-1 cursor-pointer transition-colors"
            title="Kembali ke tanggal hari ini"
          >
            Today
          </button>

          <button
            type="button"
            onClick={() => {
              setCurrentYear(2026);
              setCurrentMonth(10);
            }}
            className="text-[11px] font-medium text-blue-600 hover:text-blue-800 ml-1 cursor-pointer"
            title="Reset ke Nov 2026"
          >
            Reset
          </button>
        </div>

        {/* Holiday stats in toolbar */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-900">
          <span className="w-2 h-2 rounded-full bg-rose-500"></span>
          <span>
            Bulan ini: <strong>{holidayStats.totalHolidays} Hari Libur Produksi</strong> ({holidayStats.sundays} Minggu
            {holidayStats.nationalHolidays > 0 ? `, ${holidayStats.nationalHolidays} Libur Nasional` : ''}
            {holidayStats.cutiBersama > 0 ? `, ${holidayStats.cutiBersama} Cuti Bersama` : ''}) · <strong>{holidayStats.workingDays} Hari Kerja</strong>
          </span>
        </div>

        {/* OR / Nomor Produksi / Style Searchbar */}
        <div className="flex items-center gap-1.5 min-w-[260px] max-w-sm">
          <span className="text-xs font-semibold text-slate-600 whitespace-nowrap flex items-center gap-1">
            <Hash className="w-3.5 h-3.5 text-blue-600" />
            Cari Jadwal:
          </span>
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={orSearchInput}
              onChange={(e) => setOrSearchInput(e.target.value)}
              placeholder="Ketik Nomor OR / Style / No. Produksi..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md font-mono font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
            />
            {orSearchInput && (
              <button
                type="button"
                onClick={() => setOrSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                title="Hapus pencarian"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Message: Data tidak ditemukan when search query has no match */}
      {orSearchInput.trim() && filteredSchedules.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">Data tidak ditemukan:</span> Tidak ada jadwal produksi yang cocok dengan kata kunci &ldquo;{orSearchInput}&rdquo;.
            </div>
          </div>
          <button
            onClick={() => setOrSearchInput('')}
            className="text-xs text-blue-700 hover:text-blue-900 font-semibold underline cursor-pointer shrink-0 ml-3"
          >
            Tampilkan Seluruh Data
          </button>
        </div>
      )}

      {/* Production Planning Board + Gantt Modals inside Full Screen container */}
      <div
        ref={ganttFullscreenRef}
        data-gantt-fullscreen={isGanttFullscreen ? 'true' : 'false'}
        className={isGanttFullscreen ? 'bg-white' : ''}
      >
        <div
          data-testid="gantt-board-container"
          className={
            isGanttFullscreen
              ? 'fixed inset-0 z-[70] bg-white flex flex-col w-screen h-screen overflow-hidden'
              : 'bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden'
          }
        >
          {/* Gantt Top Header Bar with Month/Today Controls (in Full Screen) & Zoom + Full Screen Controls at Top Right */}
          <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="text-[11px] font-medium text-slate-600 flex items-center gap-2">
                <span className="font-semibold text-slate-800">Timeline Jadwal Produksi</span>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-slate-500">{dayColWidthPx}px/hari</span>
              </div>

              {isGanttFullscreen && (
                <div className="flex items-center gap-1.5 pl-2.5 border-l border-slate-300">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    aria-label="Bulan Sebelumnya"
                    title="Bulan Sebelumnya"
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center gap-1.5 px-2.5 h-7 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 min-w-32 justify-center">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    <span>
                      {monthNames[currentMonth]} {currentYear}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    aria-label="Bulan Berikutnya"
                    title="Bulan Berikutnya"
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleGoToToday}
                    data-testid="gantt-fullscreen-today-button"
                    className="px-2.5 h-7 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-semibold text-blue-700 transition-colors cursor-pointer"
                    title="Kembali ke tanggal hari ini"
                  >
                    Today
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div
                className="flex items-center gap-1.5"
                role="group"
                aria-label="Kontrol Zoom Gantt Chart"
              >
                <button
                  type="button"
                  onClick={() => handleSetGanttZoom(getNextGanttZoomLevel(ganttZoom, 'out'))}
                  disabled={ganttZoom === GANTT_ZOOM_LEVELS[0]}
                  aria-label="Zoom Out"
                  title="Zoom Out (-)"
                  className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>

                <span
                  data-testid="gantt-zoom-level"
                  className="min-w-12 px-2 py-1 text-center text-xs font-mono font-bold text-slate-800 bg-white border border-slate-300 rounded select-none"
                  title="Persentase Zoom Saat Ini"
                >
                  {ganttZoom}%
                </span>

                <button
                  type="button"
                  onClick={() => handleSetGanttZoom(getNextGanttZoomLevel(ganttZoom, 'in'))}
                  disabled={ganttZoom === GANTT_ZOOM_LEVELS[GANTT_ZOOM_LEVELS.length - 1]}
                  aria-label="Zoom In"
                  title="Zoom In (+)"
                  className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => handleSetGanttZoom(DEFAULT_GANTT_ZOOM)}
                  aria-label="Reset Zoom"
                  title="Reset zoom ke 100%"
                  className="inline-flex items-center gap-1 px-2.5 h-7 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer ml-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>

              <button
                type="button"
                onClick={toggleGanttFullscreen}
                data-testid="gantt-fullscreen-toggle"
                aria-label={isGanttFullscreen ? 'Keluar Full Screen' : 'Full Screen Gantt Chart'}
                aria-pressed={isGanttFullscreen}
                title={isGanttFullscreen ? 'Keluar Full Screen (Esc)' : 'Full Screen Gantt Chart'}
                className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded border text-xs font-semibold transition-colors cursor-pointer ${
                  isGanttFullscreen
                    ? 'border-slate-700 bg-slate-900 text-white hover:bg-slate-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isGanttFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Keluar Full Screen</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Full Screen</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div
            ref={ganttScrollRef}
            onScroll={(e) => {
              lastKnownGanttScrollRef.current = {
                scrollLeft: e.currentTarget.scrollLeft,
                scrollTop: e.currentTarget.scrollTop,
              };
              if (hoveredBarTooltip) {
                setHoveredBarTooltip(null);
              }
            }}
            className={isGanttFullscreen ? 'flex-1 min-h-0 overflow-auto relative' : 'overflow-x-auto relative'}
            data-gantt-scroll-container
          >
            <div style={{ width: `${ganttBoardWidthPx}px` }} data-gantt-board-canvas>
              {/* Header: Dates Row */}
              <div
                style={{ gridTemplateColumns: ganttGridTemplateColumns }}
                data-gantt-date-header
                className="grid bg-slate-900 text-white text-xs border-b border-slate-700 font-semibold sticky top-0 z-30"
              >
                {/* Sticky Line Produksi Header Column */}
                <div
                  data-gantt-sticky-corner
                  className="sticky left-0 z-40 bg-slate-900 p-3 border-r border-slate-700 flex items-center justify-between shadow-[3px_0_6px_-1px_rgba(0,0,0,0.5)]"
                >
                  <span className="font-bold text-white tracking-wide">Line Produksi</span>
                  <span className="text-[10px] text-slate-400 font-mono">Tgl</span>
                </div>
                {daysArray.map((d) => {
                  const isNational = d.holidayInfo.type === 'NATIONAL_HOLIDAY';
                  const isCuti = d.holidayInfo.type === 'CUTI_BERSAMA';
                  const isSunday = d.holidayInfo.type === 'SUNDAY';
                  const isToday =
                    currentYear === todayDateParts.year &&
                    currentMonth === todayDateParts.month0 &&
                    d.day === todayDateParts.day;

                  let headerBg = 'text-slate-200 hover:bg-slate-800/60';
                  let dateColor = 'text-slate-200';

                  if (isNational) {
                    headerBg = 'bg-rose-950/90 text-rose-300 border-rose-800/80 font-bold';
                    dateColor = 'text-rose-400 font-black';
                  } else if (isCuti) {
                    headerBg = 'bg-amber-950/90 text-amber-200 border-amber-800/80 font-bold';
                    dateColor = 'text-amber-300 font-black';
                  } else if (isSunday) {
                    headerBg = 'bg-slate-800 text-rose-400 font-bold';
                    dateColor = 'text-rose-400 font-bold';
                  } else if (d.isSaturday) {
                    headerBg = 'bg-slate-800/50 text-slate-300';
                  }

                  if (isToday) {
                    headerBg = `${headerBg} ring-2 ring-inset ring-blue-400 bg-blue-950/80`;
                    dateColor = 'text-blue-300 font-black';
                  }

                  const isCompactZoom = ganttZoom <= 50;

                  return (
                    <div
                      key={d.day}
                      data-gantt-day={d.day}
                      data-gantt-today={isToday ? 'true' : undefined}
                      className={`${isCompactZoom ? 'px-0.5 py-1' : 'p-1'} text-center border-r border-slate-800/80 flex flex-col justify-center items-center transition-colors relative group select-none overflow-hidden ${headerBg}`}
                      title={
                        isToday
                          ? `Hari Ini (${d.dateStr})${d.holidayInfo.isHoliday ? ` - ${d.holidayInfo.name}` : ''}`
                          : d.holidayInfo.isHoliday
                            ? `${d.dateStr}: ${d.holidayInfo.name}`
                            : `${d.dayName}, ${d.dateStr}`
                      }
                    >
                      <span className={`${isCompactZoom ? 'text-[9px]' : 'text-[10px]'} font-mono opacity-80 leading-tight`}>
                        {d.dayName}
                      </span>
                      <span className={`${isCompactZoom ? 'text-[11px]' : 'text-xs'} font-mono leading-tight ${dateColor}`}>
                        {d.day}
                      </span>
                      {isToday && (
                        <span className={`${isCompactZoom ? 'text-[6px] px-0.5' : 'text-[8px] px-1'} font-extrabold uppercase py-0.2 bg-blue-500 text-white rounded-xs leading-none mt-0.5`}>
                          Hari Ini
                        </span>
                      )}
                      {isNational && (
                        <span className={`${isCompactZoom ? 'text-[6px] px-0.5' : 'text-[8px] px-1'} font-extrabold uppercase py-0.2 bg-rose-600 text-white rounded-xs leading-none mt-0.5`}>
                          Libur
                        </span>
                      )}
                      {isCuti && (
                        <span className={`${isCompactZoom ? 'text-[6px] px-0.5' : 'text-[8px] px-1'} font-extrabold uppercase py-0.2 bg-amber-600 text-white rounded-xs leading-none mt-0.5`}>
                          Cuti
                        </span>
                      )}
                    </div>
                  );
                })}
              {Array.from({ length: 31 - daysInMonth }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-slate-900/60 border-r border-slate-800" />
              ))}
            </div>

            {/* Per-Line Produksi Gantt Board Rows with Sticky Line Name & Date-Overlap Lane Packing */}
            <div className="divide-y divide-slate-200">
              {ganttLineGroups.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400">
                  Belum ada jadwal produksi tersimpan untuk bulan {monthNames[currentMonth]} {currentYear}.
                </div>
              ) : (
                ganttLineGroups.map((group) => {
                  const lineVisibleSchedules = group.layout.items.map((item) => item.schedule);
                  const lineConflictSummary = group.isUnassigned
                    ? {
                        hasConflict: false,
                        conflictingScheduleCount: 0,
                        conflictingScheduleIds: new Set<string>(),
                        conflictPairs: [],
                      }
                    : summarizeLineConflicts(lineVisibleSchedules, scheduleConflicts);
                  const hasRealLineConflict = lineConflictSummary.hasConflict;

                  return (
                    <div
                      key={group.lineKey}
                      data-board-row={group.lineLabel}
                      data-line-key={group.lineKey}
                      data-lane-count={group.layout.laneCount}
                      data-has-conflict={hasRealLineConflict ? 'true' : 'false'}
                      data-conflict-count={lineConflictSummary.conflictingScheduleCount}
                      style={{
                        minHeight: `${Math.max(group.layout.rowHeightPx, 64)}px`,
                        gridTemplateColumns: ganttGridTemplateColumns,
                      }}
                      className="grid relative hover:bg-slate-50/30 transition-colors"
                    >
                      {/* Fixed Sticky Left Line Produksi Column */}
                      <div
                        data-gantt-sticky-line={group.lineLabel}
                        className="sticky left-0 z-20 p-3 border-r border-slate-200 bg-white/95 backdrop-blur-xs flex flex-col justify-center shadow-[3px_0_6px_-1px_rgba(0,0,0,0.06)]"
                      >
                        <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                          <Layers
                            className={`w-3.5 h-3.5 shrink-0 ${
                              group.isUnassigned ? 'text-slate-400' : 'text-blue-600'
                            }`}
                          />
                          <span className={`truncate ${group.isUnassigned ? 'text-slate-600 italic' : 'text-slate-900'}`}>
                            {group.lineLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 truncate">
                          {group.layout.items.length > 0
                            ? `${group.layout.items.length} Jadwal · ${group.layout.laneCount} Baris`
                            : `0 Jadwal di ${monthNames[currentMonth].slice(0, 3)} ${currentYear}`}
                        </div>
                        {hasRealLineConflict && (
                          <button
                            type="button"
                            onClick={() =>
                              setActiveLineConflictAudit({
                                lineLabel: group.lineLabel,
                                schedules: lineVisibleSchedules,
                                summary: lineConflictSummary,
                              })
                            }
                            title={`Klik untuk melihat rincian ${lineConflictSummary.conflictingScheduleCount} jadwal bentrok pada ${group.lineLabel}`}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded w-fit cursor-pointer transition-colors"
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0 text-amber-600" />
                            <span>Bentrok Jadwal ({lineConflictSummary.conflictingScheduleCount})</span>
                          </button>
                        )}
                      </div>

                      {/* Day Grid Cells for this Line */}
                      <div className="col-span-31 grid grid-cols-31 relative">
                        {daysArray.map((d) => {
                          const isNational = d.holidayInfo.type === 'NATIONAL_HOLIDAY';
                          const isCuti = d.holidayInfo.type === 'CUTI_BERSAMA';
                          const isSunday = d.holidayInfo.type === 'SUNDAY';

                          let cellBg = 'border-slate-100 hover:bg-slate-50/50';
                          let holidayTag = null;
                          const tagSizeClass = ganttZoom <= 50 ? 'text-[6px]' : 'text-[8px]';

                          if (isNational) {
                            cellBg = 'bg-rose-100/75 border-rose-200/90';
                            holidayTag = (
                              <span className={`${tagSizeClass} font-bold text-rose-700/80 uppercase font-mono tracking-tighter select-none leading-none`}>
                                LIBUR
                              </span>
                            );
                          } else if (isCuti) {
                            cellBg = 'bg-amber-100/70 border-amber-200/90';
                            holidayTag = (
                              <span className={`${tagSizeClass} font-bold text-amber-800/80 uppercase font-mono tracking-tighter select-none leading-none`}>
                                CUTI
                              </span>
                            );
                          } else if (isSunday) {
                            cellBg = 'bg-rose-50/70 border-rose-100/80';
                            holidayTag = (
                              <span className={`${tagSizeClass} font-bold text-rose-500/70 uppercase font-mono tracking-tighter select-none leading-none`}>
                                MIN
                              </span>
                            );
                          } else if (d.isSaturday) {
                            cellBg = 'bg-slate-50/40 border-slate-100';
                          }

                          return (
                            <div
                              key={d.day}
                              className={`border-r h-full relative flex flex-col justify-between items-center py-1 transition-colors overflow-hidden ${cellBg}`}
                              title={d.holidayInfo.isHoliday ? `${d.dateStr} - ${d.holidayInfo.name} (Hari Libur Produksi)` : undefined}
                            >
                              {holidayTag}
                              <span />
                            </div>
                          );
                        })}
                        {Array.from({ length: 31 - daysInMonth }).map((_, i) => (
                          <div key={`blank-${i}`} className="bg-slate-100/40 border-r border-slate-100" />
                        ))}

                        {/* Horizontal Gantt Schedule Blocks packed into non-overlapping lanes within this Line */}
                        <div className="absolute inset-0 pointer-events-none">
                          {group.layout.items.map(({ schedule: sch, barSpan, laneIndex }) => {
                            const { startDay, endDay, durationDays, leftPct, widthPct } = barSpan;
                            const topPx =
                              GANTT_ROW_PADDING_Y_PX +
                              laneIndex * (GANTT_LANE_HEIGHT_PX + GANTT_LANE_GAP_PX);
                            const colors = getBlockColor(sch);
                            const conflictInfo = scheduleConflicts.get(sch.id);
                            const barMeta = resolveGanttBarDisplayMeta({
                              schedule: sch,
                              durationDays,
                              dayColWidthPx,
                              lineLabel: group.lineLabel,
                              hasConflict: Boolean(conflictInfo),
                            });

                            const paddingClass =
                              barMeta.density === 'wide'
                                ? 'px-2 py-[3px]'
                                : barMeta.density === 'standard'
                                  ? 'px-1.5 py-[3px]'
                                  : 'px-1 py-[2px]';
                            const orTextClass =
                              barMeta.density === 'wide'
                                ? 'text-[11px]'
                                : barMeta.density === 'standard'
                                  ? 'text-[10px]'
                                  : 'text-[9px]';
                            const targetBadgeClass =
                              barMeta.density === 'wide'
                                ? 'text-[10px] px-1.5 py-[1px]'
                                : barMeta.density === 'standard'
                                  ? 'text-[9px] px-1 py-[1px]'
                                  : 'text-[8px] px-0.5 py-0';
                            const whTextClass =
                              barMeta.density === 'wide'
                                ? 'text-[9.5px] px-1 py-[1px] bg-black/20 rounded-[2px]'
                                : barMeta.density === 'standard'
                                  ? 'text-[9px]'
                                  : 'text-[8px]';
                            const styleTextClass =
                              barMeta.density === 'wide'
                                ? 'text-[10px]'
                                : barMeta.density === 'standard'
                                  ? 'text-[9px]'
                                  : 'text-[8px]';

                            const showTooltipForElement = (el: HTMLElement) => {
                              const r = el.getBoundingClientRect();
                              setHoveredBarTooltip({
                                meta: barMeta,
                                lineLabel: group.lineLabel,
                                productionDate: sch.productionDate,
                                finishDate: sch.finishDate,
                                hasConflict: Boolean(conflictInfo),
                                anchorRect: {
                                  left: r.left,
                                  top: r.top,
                                  bottom: r.bottom,
                                  width: r.width,
                                },
                              });
                            };

                            return (
                              <button
                                type="button"
                                key={sch.id}
                                data-or-number={sch.orNumber}
                                data-wh-number={barMeta.whNumber}
                                data-target-display={barMeta.targetDisplay}
                                data-bar-density={barMeta.density}
                                data-line-label={group.lineLabel}
                                data-start-day={startDay}
                                data-end-day={endDay}
                                data-lane-index={laneIndex}
                                data-production-date={sch.productionDate}
                                data-finish-date={sch.finishDate}
                                data-has-conflict={conflictInfo ? 'true' : 'false'}
                                aria-label={`Detail jadwal ${barMeta.orDisplay}, ${barMeta.whNumber}, ${barMeta.style}, Target ${barMeta.targetDisplay}`}
                                onMouseEnter={(e) => showTooltipForElement(e.currentTarget)}
                                onMouseLeave={() => setHoveredBarTooltip(null)}
                                onFocus={(e) => showTooltipForElement(e.currentTarget)}
                                onBlur={() => setHoveredBarTooltip(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHoveredBarTooltip(null);
                                  setDetailSelectedWsId(null);
                                  setRefreshFeedback(null);
                                  setDetailActionError(null);
                                  setConfirmDeleteId(null);
                                  setActiveDetailSchedule(sch);
                                }}
                                style={{
                                  top: `${topPx}px`,
                                  left: `${leftPct}%`,
                                  width: `${widthPct}%`,
                                  height: `${GANTT_LANE_HEIGHT_PX}px`,
                                }}
                                className={`absolute pointer-events-auto rounded-md shadow-xs ${paddingClass} cursor-pointer transition-colors duration-150 flex flex-col justify-between text-left overflow-hidden group ${colors.bg} ${colors.border} ${colors.text} ${
                                  conflictInfo ? 'ring-2 ring-amber-400/90' : ''
                                }`}
                                title={barMeta.tooltipText}
                              >
                                {/* Baris 1: No. OR (kiri) & Target Produksi + satuan (kanan) */}
                                <div className="flex items-center justify-between gap-1 w-full min-w-0 leading-none">
                                  <span
                                    data-bar-field="or"
                                    className={`${orTextClass} font-mono font-bold truncate min-w-0 leading-none`}
                                  >
                                    {barMeta.orDisplay}
                                  </span>

                                  <div className="flex items-center gap-1 shrink-0 min-w-0 max-w-[65%]">
                                    {barMeta.density === 'wide' && sch.worksheets && sch.worksheets.length > 0 && (
                                      <span
                                        className="text-[9px] bg-white/25 px-1 py-[1px] rounded flex items-center gap-0.5 font-bold shrink-0 leading-none"
                                        title={`${sch.worksheets.length} file Excel terlampir`}
                                      >
                                        <Paperclip className="w-2.5 h-2.5" />
                                        <span>{sch.worksheets.length}</span>
                                      </span>
                                    )}
                                    <span
                                      data-bar-field="target"
                                      className={`${targetBadgeClass} font-mono rounded font-bold whitespace-nowrap truncate leading-none ${colors.badge}`}
                                    >
                                      {barMeta.targetDisplay}
                                    </span>
                                  </div>
                                </div>

                                {/* Baris 2: No. WH & Style lengkap */}
                                <div className="flex items-center gap-1 w-full min-w-0 leading-none">
                                  <span
                                    data-bar-field="wh"
                                    className={`${whTextClass} font-mono font-semibold shrink-0 whitespace-nowrap truncate max-w-[56%] leading-none opacity-95`}
                                  >
                                    {barMeta.whNumber}
                                  </span>
                                  <span className="text-[9px] opacity-60 shrink-0 leading-none">·</span>
                                  <span
                                    data-bar-field="style"
                                    className={`${styleTextClass} font-medium opacity-95 truncate min-w-0 flex-1 leading-none`}
                                  >
                                    {barMeta.style}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Board Legend */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 shrink-0">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-600" />
              Legenda Kalender:
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-rose-100 border border-rose-300 inline-block shadow-2xs" />
              <span className="font-medium text-rose-950">Hari Libur Nasional (Tanggal Merah)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-amber-100 border border-amber-300 inline-block shadow-2xs" />
              <span className="font-medium text-amber-950">Cuti Bersama</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-rose-50 border border-rose-200 inline-block shadow-2xs" />
              <span className="font-medium text-slate-700">Hari Minggu (Libur Rutin)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-blue-600 inline-block" />
              <span>Jadwal Produksi</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-500">
            * Kolom informasi jadwal tetap terkunci di sisi kiri saat kalender digeser secara horizontal.
          </div>
        </div>
        </div>

      {/* Floating Unclipped Hover Tooltip for Gantt Schedule Bars */}
      {hoveredBarTooltip && (
        <div
          role="tooltip"
          data-testid="gantt-bar-hover-tooltip"
          style={{
            left: `${Math.min(
              Math.max(12, hoveredBarTooltip.anchorRect.left),
              typeof window !== 'undefined' ? Math.max(12, window.innerWidth - 332) : 600
            )}px`,
            top:
              hoveredBarTooltip.anchorRect.bottom + 140 <=
              (typeof window !== 'undefined' ? window.innerHeight : 800)
                ? `${hoveredBarTooltip.anchorRect.bottom + 6}px`
                : `${Math.max(8, hoveredBarTooltip.anchorRect.top - 122)}px`,
          }}
          className="fixed z-[90] w-80 max-w-[calc(100vw-24px)] pointer-events-none bg-slate-900/95 text-white border border-slate-700 rounded-lg shadow-xl p-2.5 text-[11px] space-y-1"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-700/80 pb-1">
            <span className="font-mono font-bold text-blue-300">
              {hoveredBarTooltip.meta.orDisplay}
            </span>
            <span className="font-mono font-bold bg-blue-600/30 border border-blue-400/40 text-blue-100 px-1.5 py-0.5 rounded text-[10px]">
              {hoveredBarTooltip.meta.targetDisplay}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-slate-400 shrink-0">No. WH:</span>
            <span className="font-mono font-semibold text-slate-100">
              {hoveredBarTooltip.meta.whNumber}
            </span>
          </div>
          <div className="text-[11px] leading-snug">
            <span className="text-slate-400 mr-1">Style:</span>
            <span className="font-medium text-white break-words">
              {hoveredBarTooltip.meta.style}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800 text-[10px] text-slate-300">
            <span>{hoveredBarTooltip.lineLabel}</span>
            <span className="font-mono">
              {hoveredBarTooltip.productionDate} s/d {hoveredBarTooltip.finishDate}
            </span>
          </div>
          {hoveredBarTooltip.hasConflict && (
            <div className="text-[10px] text-amber-300 font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>Bentrok jadwal pada Line yang sama</span>
            </div>
          )}
        </div>
      )}

      {/* Line Conflict Diagnostic Modal */}
      {activeLineConflictAudit && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold">
                  Rincian Bentrok Jadwal — {activeLineConflictAudit.lineLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveLineConflictAudit(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
                aria-label="Tutup rincian bentrok"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
                Ditemukan <strong>{activeLineConflictAudit.summary.conflictingScheduleCount} jadwal</strong> yang benar-benar bentrok ({activeLineConflictAudit.summary.conflictPairs.length} pasangan dengan No. OR berbeda dan tanggal tumpang tindih pada {activeLineConflictAudit.lineLabel}). Jadwal dengan No. OR yang sama tidak ditandai sebagai bentrok.
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-slate-800">Pasangan Jadwal yang Bertabrakan</h4>
                <div className="space-y-2">
                  {activeLineConflictAudit.summary.conflictPairs.map((pair) => (
                    <div
                      key={pair.key}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1"
                    >
                      <div className="font-semibold text-slate-900">
                        OR {pair.scheduleA.orNumber}
                        {pair.scheduleA.worksheetNo ? ` [${pair.scheduleA.worksheetNo}]` : ''} ({pair.scheduleA.productionDate} s/d {pair.scheduleA.finishDate}) ↔ OR {pair.scheduleB.orNumber}
                        {pair.scheduleB.worksheetNo ? ` [${pair.scheduleB.worksheetNo}]` : ''} ({pair.scheduleB.productionDate} s/d {pair.scheduleB.finishDate})
                      </div>
                      <div className="text-[11px] text-slate-600">{pair.reason}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-slate-800">
                  Seluruh Jadwal pada {activeLineConflictAudit.lineLabel} ({activeLineConflictAudit.schedules.length} Jadwal)
                </h4>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-2.5">ID Jadwal</th>
                        <th className="py-2 px-2.5">No. OR</th>
                        <th className="py-2 px-2.5">No. Produksi</th>
                        <th className="py-2 px-2.5">Style</th>
                        <th className="py-2 px-2.5">Tanggal</th>
                        <th className="py-2 px-2.5">Status Konflik</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeLineConflictAudit.schedules.map((sch) => {
                        const isConf = activeLineConflictAudit.summary.conflictingScheduleIds.has(sch.id);
                        return (
                          <tr key={sch.id} className={isConf ? 'bg-amber-50/50' : ''}>
                            <td className="py-1.5 px-2.5 font-mono text-[10px] text-slate-500">{sch.id}</td>
                            <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">
                              {sch.orNumber}
                              <span className="ml-1 text-[10px] font-normal text-slate-400">
                                ({resolveScheduleOrForConflict(sch) || '-'})
                              </span>
                            </td>
                            <td className="py-1.5 px-2.5 font-mono text-slate-700">
                              {sch.worksheets?.[0]?.worksheetNo || '-'}
                            </td>
                            <td className="py-1.5 px-2.5 text-slate-700">{sch.style}</td>
                            <td className="py-1.5 px-2.5 font-mono text-slate-700 whitespace-nowrap">
                              {sch.productionDate} s/d {sch.finishDate}
                            </td>
                            <td className="py-1.5 px-2.5">
                              {isConf ? (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                                  Bentrok
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">
                                  Aman
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Detail Modal */}
      {activeDetailSchedule && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div
            className={`bg-white rounded-xl shadow-2xl border border-slate-200 w-full ${
              activeDetailSchedule.worksheets && activeDetailSchedule.worksheets.length > 0
                ? 'max-w-4xl max-h-[92vh] overflow-y-auto'
                : 'max-w-lg'
            } overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
          >
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-20">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold">Detail Jadwal Produksi</h3>
              </div>
              <button
                onClick={() => setActiveDetailSchedule(null)}
                className="text-slate-400 hover:text-white"
                aria-label="Tutup detail jadwal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* Primary Schedule Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Nomor OR</span>
                  <span className="text-sm font-bold font-mono text-slate-900">
                    {activeDetailSchedule.orNumber}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Nomor Produksi</span>
                  <span className="text-sm font-bold font-mono text-blue-700">
                    {activeDetailSchedule.worksheets?.[0]?.worksheetNo || '-'}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Line Produksi</span>
                  <span className="text-sm font-bold text-slate-900">
                    {getDisplayProductionLineLabel(activeDetailSchedule.productionLine)}
                  </span>
                </div>
              </div>

              {(() => {
                const detailConflict = scheduleConflicts.get(activeDetailSchedule.id);
                if (!detailConflict) return null;
                return (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Bentrok Jadwal pada {detailConflict.line}:</span>{' '}
                      Tanggal pelaksanaan bertabrakan dengan{' '}
                      {detailConflict.conflictingWith
                        .map(
                          (c) =>
                            `OR ${c.orNumber}${c.worksheetNo ? ` [${c.worksheetNo}]` : ''} - ${c.style} (${c.productionDate} s/d ${c.finishDate})`
                        )
                        .join(', ')}.
                    </div>
                  </div>
                );
              })()}

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs">
                <span className="text-slate-500 block mb-0.5">Style</span>
                <span className="text-xs font-semibold text-slate-800">
                  {activeDetailSchedule.style}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Target Produksi</span>
                  <span className="text-sm font-bold font-mono text-slate-900">
                    {formatPpicNumber(activeDetailSchedule.target)}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Tanggal Mulai Produksi</span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {activeDetailSchedule.productionDate}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Tanggal Selesai Produksi</span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {activeDetailSchedule.finishDate}
                  </span>
                </div>
              </div>

              {/* Attached Excel Schedule Section (Saved Frozen Snapshot) */}
              {activeDetailSchedule.worksheets && activeDetailSchedule.worksheets.length > 0 && (() => {
                const wsList = activeDetailSchedule.worksheets;
                const activeWs = wsList.find((w) => w.id === detailSelectedWsId) || wsList[0];
                const snapshotRows: WorksheetMaterialMatched[] = (activeWs.materials || []).map((m, idx) => ({
                  id: m.id || `wsm-${idx + 1}`,
                  materialCode: m.materialCode,
                  materialName: m.materialName,
                  unit: m.unit,
                  total: m.total,
                  receivedQty: m.receivedQty !== undefined ? m.receivedQty : null,
                  status: m.status !== undefined ? m.status : null,
                  isFoundInMasterData: Boolean(
                    m.isFoundInMasterData ?? (m.receivedQty !== null && m.receivedQty !== undefined)
                  ),
                  matchedUploadId: m.matchedUploadId ?? activeWs.matchedUploadId ?? null,
                  matchedUploadDate: m.matchedUploadDate ?? activeWs.matchedUploadDate ?? null,
                  matchedUploadTime: m.matchedUploadTime ?? activeWs.matchedUploadTime ?? null,
                  matchedUploadCreatedAt: m.matchedUploadCreatedAt ?? activeWs.matchedUploadCreatedAt ?? null,
                  matchedAt: m.matchedAt ?? activeWs.lastSyncedAt ?? null,
                }));
                const readyCount = snapshotRows.filter((m) => m.status === 'READY').length;
                const notReadyCount = snapshotRows.filter((m) => m.status === 'BELUM READY').length;
                const notFoundCount = snapshotRows.filter((m) => !m.isFoundInMasterData).length;
                const uploadSourceLabel = activeWs.matchedUploadDate
                  ? `${activeWs.matchedUploadDate}${activeWs.matchedUploadTime ? ` · ${activeWs.matchedUploadTime}` : ''}`
                  : activeWs.matchedUploadId
                    ? `Upload ID ${activeWs.matchedUploadId.slice(0, 8)}`
                    : 'Belum ada upload Master Data untuk OR ini saat snapshot';
                const syncedTimeLabel = activeWs.lastSyncedAt
                  ? new Intl.DateTimeFormat('id-ID', {
                      timeZone: 'Asia/Jakarta',
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(activeWs.lastSyncedAt)) + ' WIB'
                  : null;

                return (
                  <div className="pt-3 border-t border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                        <h4 className="text-xs font-bold text-slate-900">
                          Data Excel Production Schedule ({snapshotRows.length} Material)
                        </h4>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                          Snapshot Tersimpan
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleRefreshScheduleSnapshot}
                        disabled={isRefreshingSnapshot}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-md shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Perbarui Diterima & Status Kesiapan dari upload Master Data terbaru untuk Nomor OR ini"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSnapshot ? 'animate-spin' : ''}`} />
                        <span>{isRefreshingSnapshot ? 'Menyegarkan...' : 'Refresh Ketersediaan Material'}</span>
                      </button>
                    </div>

                    {refreshFeedback && (
                      <div
                        className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                          refreshFeedback.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : refreshFeedback.type === 'error'
                              ? 'bg-rose-50 border-rose-200 text-rose-800'
                              : 'bg-blue-50 border-blue-200 text-blue-800'
                        }`}
                      >
                        {refreshFeedback.type === 'error' ? (
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{refreshFeedback.message}</span>
                      </div>
                    )}

                    {wsList.length > 1 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        {wsList.map((ws, idx) => {
                          const isSelected = activeWs.id === ws.id;
                          return (
                            <button
                              key={ws.id || idx}
                              type="button"
                              onClick={() => setDetailSelectedWsId(ws.id)}
                              className={`px-2.5 py-1 text-xs rounded-md font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                                isSelected
                                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                              <span>{ws.fileName}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded ${
                                  isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-200 text-slate-600'
                                }`}
                              >
                                OR {ws.orNumber}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-800">{activeWs.fileName}</span>
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                            OR: {activeWs.orNumber}
                          </span>
                          {activeWs.worksheetNo && (
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold">
                              No. Prod: {activeWs.worksheetNo}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-slate-600">
                            Style: <strong>{activeWs.style}</strong>
                          </span>
                          <span className="text-slate-600">
                            Target Produksi: <strong className="font-mono text-slate-900">{formatPpicNumber(activeWs.target)}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-200/60">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-500 font-medium">Material ({snapshotRows.length} baris):</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                            READY: {readyCount}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                            BELUM READY: {notReadyCount}
                          </span>
                          {notFoundCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              Tidak Ditemukan: {notFoundCount}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          <span>
                            Sumber Upload: <strong className="text-slate-700 font-mono">{uploadSourceLabel}</strong>
                          </span>
                          {syncedTimeLabel && (
                            <span>
                              · Disinkronkan: <strong className="text-slate-700">{syncedTimeLabel}</strong>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Exact 6-Column Material Table */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="max-h-60 overflow-y-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-slate-100 text-slate-700 font-semibold text-[11px] uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                            <tr>
                              <th className="py-2 px-3">Kode Material</th>
                              <th className="py-2 px-3">Nama Material</th>
                              <th className="py-2 px-2 text-center">Satuan</th>
                              <th className="py-2 px-3 text-right">Kebutuhan</th>
                              <th className="py-2 px-3 text-right">Diterima</th>
                              <th className="py-2 px-3 text-center">Status Kesiapan</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {snapshotRows.map((item, idx) => (
                              <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors">
                                <td className="py-2 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                                  {item.materialCode}
                                </td>
                                <td className="py-2 px-3 text-slate-800">{item.materialName}</td>
                                <td className="py-2 px-2 text-center text-slate-600 font-mono text-[11px]">
                                  {item.unit}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">
                                  {item.total !== null && item.total !== undefined
                                    ? formatPpicNumber(item.total)
                                    : '-'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-slate-900">
                                  {item.receivedQty !== null && item.receivedQty !== undefined ? (
                                    <span className="font-bold">{formatPpicNumber(item.receivedQty)}</span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-center whitespace-nowrap">
                                  {item.status === 'READY' ? (
                                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      READY
                                    </span>
                                  ) : item.status === 'BELUM READY' ? (
                                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                                      BELUM READY
                                    </span>
                                  ) : (
                                    <span
                                      className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-300"
                                      title="Tidak ditemukan di upload Master Data terbaru untuk Nomor OR ini"
                                    >
                                      -
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Detail Action Error Banner */}
              {detailActionError && (
                <div
                  role="alert"
                  className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{detailActionError}</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMenu('Material Risk Analysis');
                    setActiveDetailSchedule(null);
                  }}
                  disabled={isDeletingSchedule}
                  className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded flex items-center gap-1.5"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Cek Risiko Material OR Ini
                </button>

                <div className="flex items-center gap-2">
                  {confirmDeleteId === activeDetailSchedule.id ? (
                    <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded">
                      <span className="text-[11px] font-semibold text-rose-800">Yakin hapus?</span>
                      <button
                        type="button"
                        onClick={() => confirmDeleteSchedule(activeDetailSchedule.id)}
                        disabled={isDeletingSchedule}
                        className="px-2 py-1 text-[11px] font-bold bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded flex items-center gap-1"
                      >
                        {isDeletingSchedule && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>{isDeletingSchedule ? 'Menghapus...' : 'Ya, Hapus'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={isDeletingSchedule}
                        className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 rounded"
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailActionError(null);
                        setConfirmDeleteId(activeDetailSchedule.id);
                      }}
                      disabled={isDeletingSchedule}
                      className="px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 rounded flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Hapus
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEditModal(activeDetailSchedule)}
                    disabled={isDeletingSchedule}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded flex items-center gap-1"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Edit Jadwal
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Schedule Form Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div
            className={`bg-white rounded-xl shadow-2xl border border-slate-200 w-full ${
              uploadedExcels.length > 0 ? 'max-w-5xl' : 'max-w-xl'
            } max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150`}
          >
            {/* Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-20">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold">
                  {modalMode === 'create'
                    ? 'Tambah Jadwal Produksi (Upload Excel Production Schedule)'
                    : 'Perbarui Jadwal Produksi'}
                </h3>
              </div>
              <button
                type="button"
                disabled={isSubmittingForm}
                onClick={() => setIsModalOpen(false)}
                aria-label="Tutup modal jadwal"
                className="text-slate-400 hover:text-white disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitForm} className="p-5 space-y-4">
              {formValidationError && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{formValidationError}</span>
                </div>
              )}

              {/* SECTION: Upload Excel Production Schedule (Multi-File, Preview Before Save) */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        Upload Excel Production Schedule (Multi-File)
                        <span className="text-[10px] px-1.5 py-0.2 rounded font-normal bg-blue-50 text-blue-700 border border-blue-200">
                          1 File = 1 Jadwal Produksi
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Membaca Nomor OR (dari Source), Nomor Produksi (Reference), Style, Target Produksi, dan Raw Materials dari file Excel (.xls / .xlsx / .csv). Data dipreview terlebih dahulu dan baru disimpan setelah konfirmasi.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Dropzone / Add File Button */}
                <div>
                  <label
                    htmlFor="schedule-excel-input"
                    className={`border-2 border-dashed rounded-lg p-3.5 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                      isProcessingExcels
                        ? 'border-blue-400 bg-blue-50/50'
                        : 'border-slate-300 hover:border-blue-500 hover:bg-white bg-slate-50/60'
                    }`}
                  >
                    <input
                      id="schedule-excel-input"
                      type="file"
                      accept=".xls,.xlsx,.csv"
                      multiple={modalMode === 'create'}
                      disabled={isProcessingExcels}
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleExcelFilesUpload(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                    {isProcessingExcels ? (
                      <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Membaca file Excel & mencocokkan dengan Master Data terbaru...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center text-center gap-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          <Upload className="w-4 h-4 text-blue-600" />
                          <span>
                            {uploadedExcels.length > 0
                              ? 'Klik untuk menambah file Excel Production Schedule lainnya'
                              : 'Klik untuk memilih satu atau beberapa file Excel Production Schedule (.xls / .xlsx)'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Setiap file diproses secara independen dan dapat ditambah, diganti, atau dihapus sebelum disimpan.
                        </span>
                      </div>
                    )}
                  </label>
                </div>

                {/* Uploaded Excel Queue */}
                {uploadedExcels.length > 0 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">
                        Daftar File dalam Preview ({uploadedExcels.length} File Excel):
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Klik kartu file untuk memeriksa preview & mengisi tanggal mulai/selesai produksi
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {uploadedExcels.map((excelItem) => {
                        const isSelected = selectedPreviewId === excelItem.id;
                        return (
                          <div
                            key={excelItem.id}
                            onClick={() => setSelectedPreviewId(excelItem.id)}
                            className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex items-start justify-between gap-2 ${
                              isSelected
                                ? 'bg-white border-blue-500 shadow-xs ring-1 ring-blue-500'
                                : 'bg-white hover:bg-slate-100/60 border-slate-200'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <FileSpreadsheet
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isSelected ? 'text-blue-600' : 'text-emerald-600'
                                  }`}
                                />
                                <span className="font-bold text-slate-800 truncate" title={excelItem.fileName}>
                                  {excelItem.fileName}
                                </span>
                              </div>

                              {excelItem.status === 'parsing' && (
                                <div className="flex items-center gap-1.5 text-[11px] text-blue-700 mt-1.5">
                                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                  <span>Memproses Excel & mencocokkan Master Data...</span>
                                </div>
                              )}

                              {excelItem.status === 'error' && (
                                <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mt-1.5">
                                  <div className="flex items-start gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600" />
                                    <span className="leading-snug">{excelItem.error}</span>
                                  </div>
                                </div>
                              )}

                              {excelItem.status === 'success' && (
                                <div className="space-y-1 mt-1 text-[11px]">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="px-1.5 py-0.2 rounded font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                      OR: {excelItem.orNumber || '-'}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                      No. Prod: {excelItem.productionNumber || '-'}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                                      Target:{' '}
                                      {excelItem.target !== null && excelItem.target !== undefined
                                        ? formatPpicNumber(excelItem.target)
                                        : '-'}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      {excelItem.materials?.length || 0} Material
                                    </span>
                                  </div>
                                  <p className="text-slate-600 truncate text-[10px]">
                                    Style: {excelItem.style || '-'} · Tanggal: {excelItem.productionDate} s/d{' '}
                                    {excelItem.finishDate}
                                  </p>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReplacingItemId(excelItem.id);
                                  replaceFileInputRef.current?.click();
                                }}
                                disabled={isProcessingExcels}
                                className="px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors cursor-pointer"
                                title="Ganti file Excel ini"
                              >
                                Ganti File
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveExcel(excelItem.id);
                                }}
                                className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors cursor-pointer"
                                title="Hapus file ini"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Preview, Validation, Manual Dates & 6-Column Raw Material Table */}
                    {(() => {
                      const activeExcel =
                        uploadedExcels.find((p) => p.id === selectedPreviewId) ||
                        uploadedExcels.find((p) => p.status === 'success');
                      if (!activeExcel || activeExcel.status !== 'success') {
                        return null;
                      }

                      const previewRows: FormExcelMaterial[] = activeExcel.materials || [];
                      const readyCount = previewRows.filter((m) => m.status === 'READY').length;
                      const notReadyCount = previewRows.filter((m) => m.status === 'BELUM READY').length;
                      const notFoundCount = previewRows.filter((m) => !m.isFoundInMasterData).length;
                      const uploadBadgeLabel = activeExcel.matchedUploadDate
                        ? `Upload Terbaru: ${activeExcel.matchedUploadDate}${activeExcel.matchedUploadTime ? ` ${activeExcel.matchedUploadTime}` : ''}`
                        : 'Belum ada upload Master Data untuk OR ini';

                      return (
                        <div className="mt-2 bg-white border border-slate-200 rounded-lg p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <Eye className="w-3.5 h-3.5 text-blue-600" />
                              <span className="font-bold text-slate-800">
                                Preview Jadwal & Material: {activeExcel.fileName}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                                READY: {readyCount}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                                BELUM READY: {notReadyCount}
                              </span>
                              {notFoundCount > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                  Tidak Ditemukan: {notFoundCount}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={handleRefreshFormExcelSnapshots}
                                disabled={isRefreshingFormPreview}
                                className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded flex items-center gap-1 cursor-pointer"
                                title="Periksa ulang kecocokan terhadap upload Master Data terbaru per OR"
                              >
                                <RefreshCw className={`w-3 h-3 ${isRefreshingFormPreview ? 'animate-spin' : ''}`} />
                                <span>Refresh Ketersediaan</span>
                              </button>
                            </div>
                          </div>

                          {activeExcel.needsReview && activeExcel.reviewReasons && activeExcel.reviewReasons.length > 0 && (
                            <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 space-y-1">
                              <div className="flex items-center gap-1.5 font-bold">
                                <FileWarning className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>Periksa Data Berikut Sebelum Menyimpan</span>
                              </div>
                              <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                                {activeExcel.reviewReasons.map((reason, rIdx) => (
                                  <li key={rIdx}>{reason}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Extracted Info + Optional Line Produksi & Manual Production Start/Finish Dates */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px]">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Nomor OR *{activeExcel.rawSource ? ` (Source: ${activeExcel.rawSource})` : ''}
                              </label>
                              <input
                                type="text"
                                value={activeExcel.orNumber || ''}
                                onChange={(e) =>
                                  handleUpdateExcelField(activeExcel.id, { orNumber: e.target.value })
                                }
                                placeholder="Contoh: 1036"
                                className={`w-full px-2 py-1 text-xs font-mono font-bold rounded border bg-white ${
                                  !activeExcel.orNumber?.trim()
                                    ? 'border-rose-400 bg-rose-50'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Nomor Produksi (Reference) *
                              </label>
                              <input
                                type="text"
                                value={activeExcel.productionNumber || ''}
                                onChange={(e) =>
                                  handleUpdateExcelField(activeExcel.id, { productionNumber: e.target.value })
                                }
                                placeholder="Contoh: WH/MO/22743"
                                className={`w-full px-2 py-1 text-xs font-mono rounded border bg-white ${
                                  !activeExcel.productionNumber?.trim()
                                    ? 'border-rose-400 bg-rose-50'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Style *
                              </label>
                              <input
                                type="text"
                                value={activeExcel.style || ''}
                                onChange={(e) =>
                                  handleUpdateExcelField(activeExcel.id, { style: e.target.value })
                                }
                                placeholder="Style List/Display Name"
                                className={`w-full px-2 py-1 text-xs rounded border bg-white ${
                                  !activeExcel.style?.trim()
                                    ? 'border-rose-400 bg-rose-50'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Target Produksi *
                              </label>
                              <input
                                type="number"
                                min="0.0001"
                                step="any"
                                value={activeExcel.target ?? ''}
                                onChange={(e) =>
                                  handleUpdateExcelField(activeExcel.id, {
                                    target: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                placeholder="Quantity To Produce"
                                className={`w-full px-2 py-1 text-xs font-mono font-bold rounded border bg-white ${
                                  activeExcel.target === null ||
                                  activeExcel.target === undefined ||
                                  activeExcel.target <= 0
                                    ? 'border-rose-400 bg-rose-50'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Tanggal Mulai Produksi (Manual) *
                              </label>
                              <input
                                type="date"
                                required
                                value={activeExcel.productionDate}
                                onChange={(e) =>
                                  handleUpdateExcelField(activeExcel.id, { productionDate: e.target.value })
                                }
                                className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-300 bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Tanggal Selesai Produksi (Manual) *
                              </label>
                              <input
                                type="date"
                                required
                                min={activeExcel.productionDate}
                                value={activeExcel.finishDate}
                                onChange={(e) =>
                                  handleUpdateExcelField(activeExcel.id, { finishDate: e.target.value })
                                }
                                className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-300 bg-white"
                              />
                            </div>
                            <div className="sm:col-span-2 lg:col-span-3">
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Line Produksi (Opsional)
                              </label>
                              <input
                                type="text"
                                list="ppic-existing-lines"
                                value={activeExcel.productionLine || ''}
                                onChange={(e) =>
                                  handleUpdateExcelField(activeExcel.id, { productionLine: e.target.value })
                                }
                                placeholder="Kosongkan jika belum ditentukan, atau pilih/ketik nama Line (misal: Line 1)"
                                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white"
                              />
                            </div>
                          </div>

                          <div className="text-[10px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
                            <span>
                              Sumber Pencocokan Master Data:{' '}
                              <strong className="font-mono text-slate-700">{uploadBadgeLabel}</strong>
                            </span>
                            <span className="text-slate-400">
                              Satuan dan nilai desimal Kebutuhan dipertahankan persis seperti pada file Excel
                            </span>
                          </div>

                          {/* Exact 6-Column Material Preview Table */}
                          <div className="border border-slate-200 rounded-md overflow-hidden">
                            <div className="max-h-60 overflow-y-auto">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead className="bg-slate-100 text-slate-700 font-semibold text-[11px] uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                                  <tr>
                                    <th className="py-2 px-2.5">Kode Material</th>
                                    <th className="py-2 px-2.5">Nama Material</th>
                                    <th className="py-2 px-2 text-center">Satuan</th>
                                    <th className="py-2 px-2.5 text-right">Kebutuhan</th>
                                    <th className="py-2 px-2.5 text-right">Diterima</th>
                                    <th className="py-2 px-2.5 text-center">Status Kesiapan</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {previewRows.map((item, idx) => {
                                    const isMissingTotal = item.total === null || item.total === undefined;
                                    return (
                                      <tr
                                        key={item.id || idx}
                                        className={`transition-colors ${
                                          isMissingTotal ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50'
                                        }`}
                                      >
                                        <td className="py-1.5 px-2.5 font-mono font-medium text-slate-900 whitespace-nowrap">
                                          <input
                                            type="text"
                                            value={item.materialCode}
                                            onChange={(e) =>
                                              handleUpdateExcelMaterialRow(activeExcel.id, idx, {
                                                materialCode: e.target.value,
                                              })
                                            }
                                            className="w-28 px-1.5 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white focus:border-blue-500 focus:outline-hidden"
                                          />
                                        </td>
                                        <td className="py-1.5 px-2.5 text-slate-800">
                                          <input
                                            type="text"
                                            value={item.materialName}
                                            onChange={(e) =>
                                              handleUpdateExcelMaterialRow(activeExcel.id, idx, {
                                                materialName: e.target.value,
                                              })
                                            }
                                            className="w-full min-w-[180px] px-1.5 py-0.5 text-[11px] border border-slate-200 rounded bg-white focus:border-blue-500 focus:outline-hidden"
                                          />
                                        </td>
                                        <td className="py-1.5 px-2 text-center text-slate-600 font-mono text-[11px]">
                                          <input
                                            type="text"
                                            value={item.unit}
                                            onChange={(e) =>
                                              handleUpdateExcelMaterialRow(activeExcel.id, idx, {
                                                unit: e.target.value,
                                              })
                                            }
                                            className="w-16 text-center px-1 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white focus:border-blue-500 focus:outline-hidden"
                                          />
                                        </td>
                                        <td className="py-1.5 px-2.5 text-right font-mono font-semibold text-slate-900">
                                          <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={item.total ?? ''}
                                            onChange={(e) =>
                                              handleUpdateExcelMaterialRow(activeExcel.id, idx, {
                                                total: e.target.value === '' ? null : Number(e.target.value),
                                              })
                                            }
                                            className="w-28 text-right px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded border border-slate-200 bg-white focus:border-blue-500 focus:outline-hidden"
                                          />
                                        </td>
                                        <td className="py-1.5 px-2.5 text-right font-mono text-slate-900">
                                          {item.receivedQty !== null && item.receivedQty !== undefined ? (
                                            <span className="font-bold">{formatPpicNumber(item.receivedQty)}</span>
                                          ) : (
                                            <span className="text-slate-400">-</span>
                                          )}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-center whitespace-nowrap">
                                          {item.status === 'READY' ? (
                                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                              READY
                                            </span>
                                          ) : item.status === 'BELUM READY' ? (
                                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                                              BELUM READY
                                            </span>
                                          ) : (
                                            <span
                                              className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-300"
                                              title="Tidak ditemukan di upload Master Data terbaru untuk Nomor OR ini"
                                            >
                                              -
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-400 italic">
                            * Pencocokan menggunakan Nomor OR ({activeExcel.orNumber || '-'}) + Kode Material pada upload Master Data terbaru. Nilai snapshot akan dibekukan saat jadwal disimpan.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Manual Form Fields shown only when no Excel file is uploaded */}
              {uploadedExcels.length === 0 && (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Atau Isi Jadwal Produksi Secara Manual
                  </span>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700">1. Nomor OR *</label>
                      <span className="text-[10px] text-blue-600 font-medium">
                        Terdaftar di Master Data ({registeredOrNumbers.length} OR)
                      </span>
                    </div>
                    <input
                      type="text"
                      required
                      value={formData.orNumber}
                      onChange={(e) => handleOrChange(e.target.value)}
                      placeholder="Contoh: 1036"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono uppercase focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                    {registeredOrNumbers.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1.5">
                        <span className="text-[10px] text-slate-400">Pilih cepat:</span>
                        {registeredOrNumbers.slice(0, 5).map((or) => (
                          <button
                            key={or}
                            type="button"
                            onClick={() => handleOrChange(or)}
                            className={`text-[10px] px-2 py-0.5 rounded font-mono border transition-colors ${
                              formData.orNumber === or
                                ? 'bg-blue-600 text-white border-blue-600 font-bold'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {or}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">2. Style *</label>
                    <input
                      type="text"
                      required
                      value={formData.style}
                      onChange={(e) => setFormData({ ...formData, style: e.target.value })}
                      placeholder="Contoh: Casual Cotton Shirt Men Navy"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        3. Tanggal Mulai Produksi *
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.productionDate}
                        onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        4. Tanggal Selesai Produksi *
                      </label>
                      <input
                        type="date"
                        required
                        min={formData.productionDate}
                        value={formData.finishDate}
                        onChange={(e) => setFormData({ ...formData, finishDate: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      5. Line Produksi (Opsional)
                    </label>
                    <input
                      type="text"
                      list="ppic-existing-lines"
                      value={formData.productionLine}
                      onChange={(e) => setFormData({ ...formData, productionLine: e.target.value })}
                      placeholder="Kosongkan jika belum ditentukan, atau pilih/ketik nama Line"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">6. Target Produksi *</label>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={formData.target || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, target: parseFloat(e.target.value) || 0 })
                      }
                      placeholder="Jumlah target produksi"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              <datalist id="ppic-existing-lines">
                {existingProductionLines.map((line) => (
                  <option key={line} value={line} />
                ))}
              </datalist>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmittingForm}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 rounded-md"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isProcessingExcels || isSubmittingForm}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmittingForm ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  <span>
                    {isSubmittingForm
                      ? 'Menyimpan...'
                      : modalMode === 'create'
                        ? uploadedExcels.filter((p) => p.status === 'success').length > 1
                          ? `Simpan ${uploadedExcels.filter((p) => p.status === 'success').length} Jadwal`
                          : 'Simpan Jadwal'
                        : 'Simpan Perubahan'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
