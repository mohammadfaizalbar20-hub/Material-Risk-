import React, { useState, useMemo } from 'react';
import { usePpic } from '../../context/PpicContext';
import { ProductionSchedule, ScheduleConflict, WorksheetPdfItem, WorksheetMaterialItem } from '../../types/ppic';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  AlertTriangle,
  Info,
  Clock,
  Layers,
  Edit2,
  Trash2,
  X,
  Filter,
  CheckCircle,
  Eye,
  ArrowRight,
  ShieldAlert,
  Search,
  Hash,
  Upload,
  FileText,
  Paperclip,
  Loader2,
  CheckCircle2,
  FileCheck,
  FileWarning,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { getIndonesianHolidayInfo, DayHolidayInfo } from '../../utils/indonesianHolidays';
import {
  buildWorksheetSnapshot,
  findLatestUploadForOr,
  matchMaterialsWithMasterData,
  parseExtractWorksheetHttpResponse,
  refreshScheduleWorksheetsSnapshot,
  validateExtractedWorksheet,
  WorksheetFieldWarning,
  WorksheetMaterialMatched,
} from '../../utils/pdfWorksheetParser';
import {
  fetchLatestUploadMaterialsForOrs,
  getSupabaseCredentials,
} from '../../lib/supabase';
import { generateUuid } from '../../utils/uuid';

export const ProductionScheduleView: React.FC = () => {
  const {
    productionSchedules,
    addProductionSchedule,
    updateProductionSchedule,
    deleteProductionSchedule,
    scheduleConflicts,
    orStyleRelations,
    getStyleForOr,
    saveOrStyleRelation,
    setActiveMenu,
    selectedScheduleId,
    setSelectedScheduleId,
    registeredOrNumbers,
    getOrSummary,
    materialRequirements,
    uploadHistory,
  } = usePpic();

  // Multi-PDF Worksheet state for Schedule Form
  interface FormWorksheetMaterial {
    id?: string;
    materialCode: string;
    materialName: string;
    unit: string;
    total: number | null;
    rawTotal?: string;
    isTotalAmbiguous?: boolean;
    needsReview?: boolean;
    reviewNote?: string;
    receivedQty?: number | null;
    status?: 'READY' | 'BELUM READY' | null;
    isFoundInMasterData?: boolean;
    matchedUploadId?: string | null;
    matchedUploadDate?: string | null;
    matchedUploadTime?: string | null;
    matchedUploadCreatedAt?: string | null;
    matchedAt?: string | null;
  }

  interface FormPdfItem {
    id: string;
    file?: File;
    fileName: string;
    status: 'parsing' | 'success' | 'error';
    error?: string;
    orNumber?: string;
    rawOrNumber?: string;
    worksheetNo?: string;
    style?: string;
    target?: number | null;
    rawTarget?: string;
    isTargetAmbiguous?: boolean;
    extractionMethod?: 'coordinates' | 'text' | 'gemini' | 'hybrid';
    needsReview?: boolean;
    reviewConfirmed?: boolean;
    reviewReasons?: string[];
    fieldWarnings?: WorksheetFieldWarning[];
    materials?: FormWorksheetMaterial[];
    matchedUploadId?: string | null;
    matchedUploadDate?: string | null;
    matchedUploadTime?: string | null;
    matchedUploadCreatedAt?: string | null;
    lastSyncedAt?: string | null;
  }

  const [uploadedPdfs, setUploadedPdfs] = useState<FormPdfItem[]>([]);
  const [selectedPreviewPdfId, setSelectedPreviewPdfId] = useState<string | null>(null);
  const [isProcessingPdfs, setIsProcessingPdfs] = useState<boolean>(false);
  const [detailSelectedWsId, setDetailSelectedWsId] = useState<string | null>(null);
  const [isRefreshingSnapshot, setIsRefreshingSnapshot] = useState<boolean>(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);
  const [isRefreshingFormPreview, setIsRefreshingFormPreview] = useState<boolean>(false);

  // Calendar Month Navigation: Default to November 2026 (matching demo dataset) or current date
  const [currentYear, setCurrentYear] = useState<number>(2026);
  const [currentMonth, setCurrentMonth] = useState<number>(10); // 0-indexed: 10 = November
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('ALL');
  const [orSearchInput, setOrSearchInput] = useState<string>('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [activeDetailSchedule, setActiveDetailSchedule] = useState<ProductionSchedule | null>(null);

  // Form State (6 mandatory fields)
  const [formData, setFormData] = useState<{
    orNumber: string;
    productionDate: string;
    finishDate: string;
    productionLine: string;
    style: string;
    target: number;
    status: ProductionSchedule['status'];
  }>({
    orNumber: '',
    productionDate: '2026-11-05',
    finishDate: '2026-11-09',
    productionLine: 'Line 1',
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
  const [crudFeedback, setCrudFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Predefined Lines per user request: Line 1, 3, 4, 5, 6, 7
  const defaultLines = useMemo(() => {
    const predefined = ['Line 1', 'Line 3', 'Line 4', 'Line 5', 'Line 6', 'Line 7'];
    const linesFromSchedules = productionSchedules.map((s) => s.productionLine).filter(Boolean);
    const combined = Array.from(new Set([...predefined, ...linesFromSchedules])).filter((ln) => ln !== 'Line 2');
    return combined.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  }, [productionSchedules]);

  // Single source of truth for OR list from Upload Excel
  const availableOrList = registeredOrNumbers;

  // Handle month switching
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
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  // Days in selected month
  const daysInMonth = useMemo(() => {
    const date = new Date(currentYear, currentMonth + 1, 0);
    return date.getDate();
  }, [currentYear, currentMonth]);

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

  // Statistics of holidays in the currently viewed month
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

  // Check if a schedule has conflict
  const getConflictForSchedule = (scheduleId: string): ScheduleConflict | undefined => {
    return scheduleConflicts.get(scheduleId);
  };

  const conflictsList = useMemo(() => {
    return Array.from(scheduleConflicts.values());
  }, [scheduleConflicts]);

  // Form: Auto-fill Style when OR changes
  const handleOrChange = (orNum: string) => {
    const clean = orNum.trim().toUpperCase();
    const matchedStyle = getStyleForOr(clean);
    setFormData((prev) => ({
      ...prev,
      orNumber: clean,
      style: matchedStyle ? matchedStyle : prev.style,
    }));
  };

  // Check form conflict in real-time
  const formConflictPreview = useMemo(() => {
    if (!formData.productionLine || !formData.productionDate || !formData.finishDate) return null;
    const prodDate = new Date(formData.productionDate);
    const finDate = new Date(formData.finishDate);
    if (finDate < prodDate) return null;

    const clashes = productionSchedules.filter((s) => {
      if (editingScheduleId && s.id === editingScheduleId) return false;
      if (s.productionLine !== formData.productionLine) return false;
      const sStart = new Date(s.productionDate);
      const sEnd = new Date(s.finishDate);
      return prodDate <= sEnd && finDate >= sStart;
    });

    if (clashes.length > 0) {
      return clashes.map((c) => ({
        orNumber: c.orNumber,
        style: c.style,
        dates: `${c.productionDate} s/d ${c.finishDate}`,
      }));
    }
    return null;
  }, [formData, productionSchedules, editingScheduleId]);

  // Open Create Modal
  const openCreateModal = () => {
    setModalMode('create');
    setEditingScheduleId(null);
    setCreateDraftId(generateUuid());
    setIsSubmittingForm(false);
    setUploadedPdfs([]);
    setSelectedPreviewPdfId(null);
    setFormData({
      orNumber: availableOrList[0] || 'OR-2026-001',
      productionDate: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-05`,
      finishDate: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-09`,
      productionLine: selectedLineFilter !== 'ALL' ? selectedLineFilter : 'Line 1',
      style: getStyleForOr(availableOrList[0] || 'OR-2026-001') || 'Casual Cotton Shirt Men Navy',
      target: 2500,
      status: 'Terjadwal',
    });
    setFormValidationError(null);
    setCrudFeedback(null);
    setIsModalOpen(true);
  };

  // Open Edit Modal (mempertahankan snapshot tersimpan tanpa auto-rematch)
  const openEditModal = (sch: ProductionSchedule) => {
    setModalMode('edit');
    setEditingScheduleId(sch.id);
    setIsSubmittingForm(false);
    if (sch.worksheets && sch.worksheets.length > 0) {
      const existing: FormPdfItem[] = sch.worksheets.map((ws) => ({
        id: ws.id,
        fileName: ws.fileName,
        status: 'success' as const,
        orNumber: ws.orNumber,
        style: ws.style,
        target: ws.target,
        materials: ws.materials,
        matchedUploadId: ws.matchedUploadId ?? null,
        matchedUploadDate: ws.matchedUploadDate ?? null,
        matchedUploadTime: ws.matchedUploadTime ?? null,
        matchedUploadCreatedAt: ws.matchedUploadCreatedAt ?? null,
        lastSyncedAt: ws.lastSyncedAt ?? ws.uploadedAt ?? null,
      }));
      setUploadedPdfs(existing);
      setSelectedPreviewPdfId(existing[0]?.id || null);
    } else {
      setUploadedPdfs([]);
      setSelectedPreviewPdfId(null);
    }
    setFormData({
      orNumber: sch.orNumber,
      productionDate: sch.productionDate,
      finishDate: sch.finishDate,
      productionLine: sch.productionLine,
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

  const revalidateFormPdfItem = (pdf: FormPdfItem): FormPdfItem => {
    if (pdf.status !== 'success') return pdf;
    const check = validateExtractedWorksheet({
      id: pdf.id,
      fileName: pdf.fileName,
      orNumber: pdf.orNumber || '',
      rawOrNumber: pdf.rawOrNumber,
      worksheetNo: pdf.worksheetNo,
      style: pdf.style || '',
      target: pdf.target ?? null,
      rawTarget: pdf.rawTarget,
      isTargetAmbiguous: pdf.isTargetAmbiguous,
      materials: (pdf.materials || []).map((m) => ({
        materialCode: m.materialCode,
        materialName: m.materialName,
        unit: m.unit,
        total: m.total,
        rawTotal: m.rawTotal,
        isTotalAmbiguous: m.isTotalAmbiguous,
        needsReview: m.needsReview,
        reviewNote: m.reviewNote,
      })),
    });

    const missingTotalWarnings: WorksheetFieldWarning[] = [];
    const missingTotalReasons: string[] = [];
    (pdf.materials || []).forEach((m, idx) => {
      if (m.total === null || m.total === undefined || !Number.isFinite(m.total)) {
        const msg = `Kolom TOTAL material "${m.materialCode || `Baris ${idx + 1}`}" masih kosong dan perlu diisi/diperiksa.`;
        missingTotalWarnings.push({ field: `materials[${idx}].total`, severity: 'warning', message: msg });
        missingTotalReasons.push(msg);
      }
    });

    const combinedWarnings = [...check.fieldWarnings, ...missingTotalWarnings];
    const combinedReasons = Array.from(new Set([...check.reviewReasons, ...missingTotalReasons]));
    return {
      ...pdf,
      needsReview: combinedWarnings.length > 0,
      reviewReasons: combinedReasons,
      fieldWarnings: combinedWarnings,
    };
  };

  const handleUpdatePdfField = (
    pdfId: string,
    patch: Partial<Pick<FormPdfItem, 'orNumber' | 'worksheetNo' | 'style' | 'target' | 'reviewConfirmed'>>
  ) => {
    setUploadedPdfs((prev) =>
      prev.map((p) => {
        if (p.id !== pdfId) return p;
        const next: FormPdfItem = {
          ...p,
          ...patch,
          isTargetAmbiguous: patch.target !== undefined ? false : p.isTargetAmbiguous,
          reviewConfirmed: patch.reviewConfirmed !== undefined ? patch.reviewConfirmed : false,
        };
        return revalidateFormPdfItem(next);
      })
    );
  };

  const handleUpdatePdfMaterialRow = (
    pdfId: string,
    rowIndex: number,
    patch: Partial<FormWorksheetMaterial>
  ) => {
    setUploadedPdfs((prev) =>
      prev.map((p) => {
        if (p.id !== pdfId || !p.materials) return p;
        const nextMaterials = p.materials.map((m, idx) =>
          idx === rowIndex
            ? {
                ...m,
                ...patch,
                isTotalAmbiguous: patch.total !== undefined ? false : m.isTotalAmbiguous,
                needsReview: patch.total !== undefined ? false : m.needsReview,
              }
            : m
        );
        return revalidateFormPdfItem({
          ...p,
          materials: nextMaterials,
          reviewConfirmed: false,
        });
      })
    );
  };

  // Handler for uploading one or multiple PDF Worksheets
  const handlePdfFilesUpload = async (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    const pdfFiles = rawFiles.filter(
      (f) => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
    );
    if (pdfFiles.length === 0) {
      setFormValidationError('Hanya file berformat PDF yang didukung untuk Worksheet.');
      return;
    }

    setIsProcessingPdfs(true);
    setFormValidationError(null);

    const newItems: FormPdfItem[] = pdfFiles.map((f) => ({
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file: f,
      fileName: f.name,
      status: 'parsing',
    }));

    setUploadedPdfs((prev) => [...prev, ...newItems]);
    if (!selectedPreviewPdfId && newItems.length > 0) {
      setSelectedPreviewPdfId(newItems[0].id);
    }

    for (const item of newItems) {
      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            const b64 = res.includes(',') ? res.split(',')[1] : res;
            resolve(b64);
          };
          reader.onerror = () => reject(new Error(`Gagal membaca file "${item.fileName}" di browser.`));
          reader.readAsDataURL(item.file!);
        });

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 35000);
        let res: Response;
        let rawResponseBody = '';
        try {
          res = await fetch('/api/pdf/extract-worksheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pdfBase64: base64Data,
              fileName: item.fileName,
            }),
            signal: controller.signal,
          });
          rawResponseBody = await res.text();
        } catch (fetchErr: any) {
          if (fetchErr?.name === 'AbortError') {
            throw new Error(
              `Proses ekstraksi PDF "${item.fileName}" melebihi batas waktu (35 detik). Coba unggah ulang.`
            );
          }
          throw new Error(
            'Gagal terhubung ke server ekstraksi PDF (/api/pdf/extract-worksheet). Periksa koneksi atau status server.'
          );
        } finally {
          window.clearTimeout(timeoutId);
        }

        const parsedResponse = parseExtractWorksheetHttpResponse(
          res.status,
          res.headers.get('content-type'),
          rawResponseBody
        );

        if (!parsedResponse.success || !parsedResponse.data) {
          throw new Error(
            parsedResponse.error || `Gagal mengekstrak PDF "${item.fileName}" (HTTP ${res.status}).`
          );
        }

        const extracted = parsedResponse.data;
        const extractedOr = (extracted.orNumber || '').trim();

        // Ambil data upload Excel paling terbaru khusus No. OR PDF ini (Supabase -> fallback state lokal)
        let reqSource = materialRequirements;
        let histSource = uploadHistory;
        if (getSupabaseCredentials().isConfigured && extractedOr) {
          const remoteLatest = await fetchLatestUploadMaterialsForOrs([extractedOr]);
          if (remoteLatest?.connected && remoteLatest.uploadHistory.length > 0) {
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
              id: `wsm-${idx + 1}`,
              materialCode: m.materialCode,
              materialName: m.materialName,
              unit: m.unit,
              total: m.total,
              receivedQty: null,
              status: null,
              isFoundInMasterData: false,
            }));

        const mergedMaterials: FormWorksheetMaterial[] = matchedMaterialsRaw.map((m, idx) => {
          const src = extracted.materials?.[idx];
          return {
            ...m,
            total: src?.total ?? m.total ?? null,
            rawTotal: src?.rawTotal,
            isTotalAmbiguous: src?.isTotalAmbiguous,
            needsReview: src?.needsReview,
            reviewNote: src?.reviewNote,
          };
        });

        const updatedPdfItem = revalidateFormPdfItem({
          id: item.id,
          file: item.file,
          fileName: item.fileName,
          status: 'success',
          orNumber: extractedOr,
          rawOrNumber: extracted.rawOrNumber,
          worksheetNo: extracted.worksheetNo,
          style: extracted.style || '',
          target: extracted.target ?? null,
          rawTarget: extracted.rawTarget,
          isTargetAmbiguous: extracted.isTargetAmbiguous,
          extractionMethod: extracted.extractionMethod,
          fieldWarnings: extracted.fieldWarnings,
          reviewReasons: extracted.reviewReasons,
          reviewConfirmed: false,
          materials: mergedMaterials,
          matchedUploadId: latestResolution.latestUpload?.id || null,
          matchedUploadDate: latestResolution.latestUpload?.updateDate || null,
          matchedUploadTime: latestResolution.latestUpload?.uploadTime || null,
          matchedUploadCreatedAt: latestResolution.latestUpload?.createdAt || null,
          lastSyncedAt: syncTimestamp,
        });

        setUploadedPdfs((prev) => {
          const updated = prev.map((p) => (p.id === item.id ? updatedPdfItem : p));

          // Auto-fill form values from cleanly extracted PDF fields when still at initial create defaults
          const validItems = updated.filter((p) => p.status === 'success');
          if (validItems.length > 0) {
            setFormData((prevForm) => {
              const totalTarget = validItems.reduce((acc, p) => acc + (p.target || 0), 0);
              const firstValid = validItems[0];
              const initialDefaultOr = availableOrList[0] || 'OR-2026-001';
              const initialDefaultStyle = getStyleForOr(initialDefaultOr) || 'Casual Cotton Shirt Men Navy';
              const shouldUpdateOr =
                !prevForm.orNumber ||
                prevForm.orNumber === 'OR-2026-001' ||
                (modalMode === 'create' && prevForm.orNumber === initialDefaultOr);
              const shouldUpdateStyle =
                !prevForm.style ||
                prevForm.style === 'Casual Cotton Shirt Men Navy' ||
                (modalMode === 'create' &&
                  (prevForm.style === initialDefaultStyle || shouldUpdateOr));
              return {
                ...prevForm,
                orNumber: shouldUpdateOr ? firstValid.orNumber || prevForm.orNumber : prevForm.orNumber,
                style: shouldUpdateStyle ? firstValid.style || prevForm.style : prevForm.style,
                target: totalTarget > 0 ? totalTarget : prevForm.target,
              };
            });
          }

          return updated;
        });
      } catch (err: any) {
        setUploadedPdfs((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  status: 'error' as const,
                  error: err?.message || 'Gagal mengekstrak worksheet PDF.',
                }
              : p
          )
        );
      }
    }

    setIsProcessingPdfs(false);
  };

  // Manual Refresh untuk preview PDF pada modal Form (hanya dijalankan atas aksi user)
  const handleRefreshFormPdfSnapshots = async () => {
    const successPdfs = uploadedPdfs.filter((p) => p.status === 'success' && p.materials && p.materials.length > 0);
    if (successPdfs.length === 0) return;

    setIsRefreshingFormPreview(true);
    try {
      let reqSource = materialRequirements;
      let histSource = uploadHistory;
      if (getSupabaseCredentials().isConfigured) {
        const ors = successPdfs.map((p) => p.orNumber || formData.orNumber).filter(Boolean);
        const remoteLatest = await fetchLatestUploadMaterialsForOrs(ors);
        if (remoteLatest?.connected && remoteLatest.uploadHistory.length > 0) {
          histSource = remoteLatest.uploadHistory;
          reqSource = remoteLatest.materialRequirements;
        }
      }

      const nowIso = new Date().toISOString();
      setUploadedPdfs((prev) =>
        prev.map((p) => {
          if (p.status !== 'success' || !p.materials) return p;
          const targetOr = p.orNumber || formData.orNumber;
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

  // Manual Refresh eksplisit untuk Detail Jadwal Produksi tersimpan (hanya saat user klik tombol)
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
        if (remoteLatest?.connected && remoteLatest.uploadHistory.length > 0) {
          histSource = remoteLatest.uploadHistory;
          reqSource = remoteLatest.materialRequirements;
        }
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
          message: updateResult.error || 'Gagal menyimpan hasil refresh snapshot ke database.',
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
            ? `Snapshot berhasil disinkronkan ulang terhadap upload Excel terbaru (${matchedOrsCount}/${refreshedWorksheets.length} worksheet memiliki upload aktif).`
            : 'Sinkronisasi selesai: belum ditemukan transaksi upload Excel aktif di Master Data untuk No. OR pada jadwal ini (Diterima/Status disetel ke "-").',
      });
    } catch (err: any) {
      setRefreshFeedback({
        type: 'error',
        message: err?.message || 'Gagal menyegarkan snapshot ketersediaan material.',
      });
    } finally {
      setIsRefreshingSnapshot(false);
    }
  };

  // Remove a PDF from upload queue
  const handleRemovePdf = (pdfId: string) => {
    setUploadedPdfs((prev) => {
      const next = prev.filter((p) => p.id !== pdfId);
      if (selectedPreviewPdfId === pdfId) {
        setSelectedPreviewPdfId(next[0]?.id || null);
      }
      return next;
    });
  };

  // Manually re-sync total targets from PDFs to Form
  const handleSyncPdfDataToForm = () => {
    const valid = uploadedPdfs.filter((p) => p.status === 'success');
    if (valid.length === 0) return;
    const totalTarget = valid.reduce((acc, p) => acc + (p.target || 0), 0);
    const firstValid = valid[0];
    setFormData((prev) => ({
      ...prev,
      target: totalTarget > 0 ? totalTarget : prev.target,
      orNumber: firstValid.orNumber || prev.orNumber,
      style: firstValid.style || prev.style,
    }));
  };

  // Submit Form (Validation: finish >= start, target > 0, no failed/unvalidated PDFs)
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingForm || isProcessingPdfs) return;
    setFormValidationError(null);

    if (!formData.orNumber.trim()) {
      setFormValidationError('Nomor OR wajib diisi.');
      return;
    }
    if (!formData.style.trim()) {
      setFormValidationError('Style wajib diisi.');
      return;
    }
    if (!formData.productionLine) {
      setFormValidationError('Line Produksi wajib dipilih.');
      return;
    }
    if (new Date(formData.finishDate) < new Date(formData.productionDate)) {
      setFormValidationError('Tanggal selesai tidak boleh lebih awal daripada tanggal produksi.');
      return;
    }
    if (formData.target <= 0) {
      setFormValidationError('Target harus berupa angka positif lebih besar dari 0.');
      return;
    }

    // Block saving if any uploaded PDF failed or still has unresolved validation errors
    const failedPdfs = uploadedPdfs.filter((p) => p.status === 'error');
    if (failedPdfs.length > 0) {
      setFormValidationError(
        `Tidak dapat menyimpan karena terdapat PDF Worksheet yang gagal dibaca (${failedPdfs
          .map((p) => p.fileName)
          .join(', ')}). Hapus atau unggah ulang PDF tersebut.`
      );
      return;
    }

    for (const p of uploadedPdfs) {
      if (p.status !== 'success') continue;
      if (!p.orNumber?.trim()) {
        setFormValidationError(`No. OR pada PDF "${p.fileName}" masih kosong. Lengkapi di Preview Worksheet.`);
        setSelectedPreviewPdfId(p.id);
        return;
      }
      if (!p.style?.trim()) {
        setFormValidationError(`Style pada PDF "${p.fileName}" masih kosong. Lengkapi di Preview Worksheet.`);
        setSelectedPreviewPdfId(p.id);
        return;
      }
      if (p.target === null || p.target === undefined || p.target <= 0) {
        setFormValidationError(
          `Target (Total Qty) pada PDF "${p.fileName}" harus lebih dari 0. Periksa di Preview Worksheet.`
        );
        setSelectedPreviewPdfId(p.id);
        return;
      }
      if (!p.materials || p.materials.length === 0) {
        setFormValidationError(
          `Daftar material pada PDF "${p.fileName}" kosong sehingga tidak dapat disimpan sebagai worksheet valid.`
        );
        setSelectedPreviewPdfId(p.id);
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
          `Baris material ke-${badRowIdx + 1} (${badRow.materialCode || '-'}) pada "${p.fileName}" memiliki kolom kosong/tidak valid (termasuk TOTAL yang kosong). Lengkapi terlebih dahulu di Preview Worksheet.`
        );
        setSelectedPreviewPdfId(p.id);
        return;
      }
      if (p.needsReview && !p.reviewConfirmed) {
        setFormValidationError(
          `PDF "${p.fileName}" memiliki nilai yang perlu diperiksa/konfirmasi (${p.reviewReasons?.[0] || 'periksa angka/identitas'}). Konfirmasi pada Preview Worksheet sebelum menyimpan.`
        );
        setSelectedPreviewPdfId(p.id);
        return;
      }
    }

    // Simpan snapshot permanen untuk setiap worksheet & materialnya
    const saveTimestamp = new Date().toISOString();
    const validWorksheets: WorksheetPdfItem[] = uploadedPdfs
      .filter((p) => p.status === 'success' && p.materials && p.materials.length > 0)
      .map((p) => {
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
            orNumber: (p.orNumber || formData.orNumber).trim(),
            style: (p.style || formData.style).trim(),
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
            orNumber: (p.orNumber || formData.orNumber).trim(),
            style: (p.style || formData.style).trim(),
            target: Number(p.target || 0),
            materials: normalizedMaterials,
            uploadedAt: saveTimestamp,
          },
          materialRequirements,
          uploadHistory,
          saveTimestamp
        );
      });

    setIsSubmittingForm(true);
    try {
      const payload = {
        orNumber: formData.orNumber.trim().toUpperCase(),
        productionDate: formData.productionDate,
        finishDate: formData.finishDate,
        productionLine: formData.productionLine,
        style: formData.style.trim(),
        target: Number(formData.target),
        status: formData.status,
        worksheets: validWorksheets.length > 0 ? validWorksheets : undefined,
      };

      const result =
        modalMode === 'create'
          ? await addProductionSchedule({ id: createDraftId, ...payload })
          : editingScheduleId
            ? await updateProductionSchedule(editingScheduleId, payload)
            : { success: false, error: 'ID jadwal yang akan diperbarui tidak ditemukan.' };

      if (!result.success) {
        setFormValidationError(result.error || 'Gagal menyimpan jadwal produksi.');
        return;
      }

      // Save relation for main schedule OR and each worksheet's OR
      saveOrStyleRelation(payload.orNumber, payload.style);
      validWorksheets.forEach((ws) => {
        if (ws.orNumber && ws.style) {
          saveOrStyleRelation(ws.orNumber.trim().toUpperCase(), ws.style.trim());
        }
      });

      setCrudFeedback({
        type: 'success',
        message:
          modalMode === 'create'
            ? `Jadwal produksi ${payload.orNumber} berhasil disimpan.`
            : `Perubahan jadwal produksi ${payload.orNumber} berhasil disimpan.`,
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

  // Filter lines to display
  const displayLines = useMemo(() => {
    if (selectedLineFilter === 'ALL') return defaultLines;
    return defaultLines.filter((l) => l === selectedLineFilter);
  }, [defaultLines, selectedLineFilter]);

  // Total matching schedules based on line and typed OR / Style search
  const totalVisibleSchedulesAcrossBoard = useMemo(() => {
    return productionSchedules.filter((s) => {
      if (selectedLineFilter !== 'ALL' && s.productionLine !== selectedLineFilter) return false;
      if (orSearchInput.trim()) {
        const q = orSearchInput.trim().toUpperCase();
        const matchOr = s.orNumber.toUpperCase().includes(q);
        const matchStyle = (s.style || '').toUpperCase().includes(q);
        if (!matchOr && !matchStyle) return false;
      }
      return true;
    });
  }, [productionSchedules, selectedLineFilter, orSearchInput]);

  // Color generator for schedule blocks
  const getBlockColor = (sch: ProductionSchedule, hasConflict: boolean) => {
    if (hasConflict) {
      return {
        bg: 'bg-amber-500 hover:bg-amber-600',
        border: 'border-amber-600 ring-2 ring-amber-300',
        text: 'text-white',
        badge: 'bg-amber-800 text-amber-100',
      };
    }
    // Color variants based on line / OR
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
      {/* Header bar */}
      <div className="p-5 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base md:text-lg font-bold text-slate-900">
              Production Planning Board (Gantt Calendar)
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
              Gantt View
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Jadwal produksi horizontal per Line Produksi. Klik blok jadwal untuk melihat detail, edit, atau hapus.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={openCreateModal}
            className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Tambah Jadwal Produksi
          </button>
        </div>
      </div>

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

      {/* Global Collision Notification Banner if any conflicts exist */}
      {conflictsList.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg shadow-2xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <div className="text-xs font-bold text-amber-900 flex items-center gap-2">
                Peringatan: Terdeteksi {conflictsList.length} Jadwal Produksi yang Bertabrakan (Collision)
              </div>
              <p className="text-xs text-amber-800">
                Sesuai kebijakan PPIC, jadwal pada lini yang sama tetap diizinkan disimpan. Periksa detail lini berikut untuk antisipasi kapasitas:
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {conflictsList.map((c) => (
                  <button
                    key={c.scheduleId}
                    onClick={() => {
                      const sch = productionSchedules.find((s) => s.id === c.scheduleId);
                      if (sch) {
                        setDetailSelectedWsId(null);
                        setRefreshFeedback(null);
                        setDetailActionError(null);
                        setConfirmDeleteId(null);
                        setActiveDetailSchedule(sch);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-mono bg-white hover:bg-amber-100 px-2 py-0.5 rounded border border-amber-300 text-amber-900 shadow-2xs"
                  >
                    <span>{c.orNumber} ({c.line}):</span>
                    <span className="font-bold underline">bentrok dg {c.conflictingWith.map((cw) => cw.orNumber).join(', ')}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar: Month Navigation & Line Filter */}
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
            onClick={() => {
              setCurrentYear(2026);
              setCurrentMonth(10);
            }}
            className="text-[11px] font-medium text-blue-600 hover:text-blue-800 ml-2"
            title="Reset ke Nov 2026"
          >
            Reset
          </button>
        </div>

        {/* Holiday stats in toolbar */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-900">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
          <span>
            Bulan ini: <strong>{holidayStats.totalHolidays} Hari Libur Produksi</strong> ({holidayStats.sundays} Minggu
            {holidayStats.nationalHolidays > 0 ? `, ${holidayStats.nationalHolidays} Libur Nasional` : ''}
            {holidayStats.cutiBersama > 0 ? `, ${holidayStats.cutiBersama} Cuti Bersama` : ''}) · <strong>{holidayStats.workingDays} Hari Kerja</strong>
          </span>
        </div>

        {/* Line & OR Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Line Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Filter Line:</span>
            <select
              value={selectedLineFilter}
              onChange={(e) => setSelectedLineFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">Semua Line ({defaultLines.length})</option>
              {defaultLines.map((ln) => (
                <option key={ln} value={ln}>
                  {ln}
                </option>
              ))}
            </select>
          </div>

          {/* OR Searchbar (Input Ketik Manual - Single Source of Truth from Upload Excel) */}
          <div className="flex items-center gap-1.5 min-w-[240px] max-w-xs">
            <span className="text-xs font-semibold text-slate-600 whitespace-nowrap flex items-center gap-1">
              <Hash className="w-3.5 h-3.5 text-blue-600" />
              Cari OR:
            </span>
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={orSearchInput}
                onChange={(e) => setOrSearchInput(e.target.value)}
                placeholder={registeredOrNumbers.length === 0 ? "Belum ada Nomor OR" : "Ketik Nomor OR / Style..."}
                disabled={registeredOrNumbers.length === 0}
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
      </div>

      {/* Message: Data tidak ditemukan when search query has no match */}
      {orSearchInput.trim() && totalVisibleSchedulesAcrossBoard.length === 0 && (
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

      {/* Production Planning Board (Horizontal Gantt Calendar with Fixed Sticky Line Column & Holiday Markings) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto relative">
          <div className="min-w-[1200px]">
            {/* Header: Dates Row */}
            <div className="grid grid-cols-[170px_repeat(31,minmax(34px,1fr))] bg-slate-900 text-white text-xs border-b border-slate-700 font-semibold sticky top-0 z-30">
              {/* Sticky Line Header Column */}
              <div className="sticky left-0 z-40 bg-slate-900 p-3 border-r border-slate-700 flex items-center justify-between shadow-[3px_0_6px_-1px_rgba(0,0,0,0.5)]">
                <span className="font-bold text-white tracking-wide">Line Produksi</span>
                <span className="text-[10px] text-slate-400 font-mono">Tgl</span>
              </div>
              {daysArray.map((d) => {
                const isNational = d.holidayInfo.type === 'NATIONAL_HOLIDAY';
                const isCuti = d.holidayInfo.type === 'CUTI_BERSAMA';
                const isSunday = d.holidayInfo.type === 'SUNDAY';

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

                return (
                  <div
                    key={d.day}
                    className={`p-1 text-center border-r border-slate-800/80 flex flex-col justify-center items-center transition-colors relative group select-none ${headerBg}`}
                    title={d.holidayInfo.isHoliday ? `${d.dateStr}: ${d.holidayInfo.name}` : `${d.dayName}, ${d.dateStr}`}
                  >
                    <span className="text-[10px] font-mono opacity-80 leading-tight">{d.dayName}</span>
                    <span className={`text-xs font-mono ${dateColor}`}>{d.day}</span>
                    {isNational && (
                      <span className="text-[8px] font-extrabold uppercase px-1 py-0.2 bg-rose-600 text-white rounded-xs leading-none mt-0.5">
                        Libur
                      </span>
                    )}
                    {isCuti && (
                      <span className="text-[8px] font-extrabold uppercase px-1 py-0.2 bg-amber-600 text-white rounded-xs leading-none mt-0.5">
                        Cuti
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Fill remaining columns if month < 31 days */}
              {Array.from({ length: 31 - daysInMonth }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-slate-900/60 border-r border-slate-800" />
              ))}
            </div>

            {/* Rows: Each Production Line */}
            <div className="divide-y divide-slate-200">
              {displayLines.map((lineName) => {
                // Find all schedules on this line
                const lineSchedules = productionSchedules.filter((s) => s.productionLine === lineName);

                // Filter schedules that touch this active month and match selected OR
                const visibleSchedules = lineSchedules.filter((s) => {
                  if (orSearchInput.trim()) {
                    const q = orSearchInput.trim().toUpperCase();
                    const matchOr = s.orNumber.toUpperCase().includes(q);
                    const matchStyle = (s.style || '').toUpperCase().includes(q);
                    if (!matchOr && !matchStyle) return false;
                  }
                  const sStart = new Date(s.productionDate);
                  const sEnd = new Date(s.finishDate);
                  const mStart = new Date(currentYear, currentMonth, 1);
                  const mEnd = new Date(currentYear, currentMonth, daysInMonth, 23, 59, 59);
                  return sStart <= mEnd && sEnd >= mStart;
                });

                return (
                  <div
                    key={lineName}
                    className="grid grid-cols-[170px_repeat(31,minmax(34px,1fr))] min-h-24 relative hover:bg-slate-50/40 transition-colors"
                  >
                    {/* Fixed Sticky Line Column (Left side remains visible while horizontal scrolling) */}
                    <div className="sticky left-0 z-20 p-3 border-r border-slate-200 bg-white/95 backdrop-blur-xs flex flex-col justify-center shadow-[3px_0_6px_-1px_rgba(0,0,0,0.06)]">
                      <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">{lineName}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 truncate">
                        {visibleSchedules.length} Jadwal di {monthNames[currentMonth].slice(0, 3)}
                      </div>
                    </div>

                    {/* Day Grid Cells (Background Lines with Holiday Markings) */}
                    <div className="col-span-31 grid grid-cols-31 relative">
                      {daysArray.map((d) => {
                        const isNational = d.holidayInfo.type === 'NATIONAL_HOLIDAY';
                        const isCuti = d.holidayInfo.type === 'CUTI_BERSAMA';
                        const isSunday = d.holidayInfo.type === 'SUNDAY';

                        let cellBg = 'border-slate-100 hover:bg-slate-50/50';
                        let holidayTag = null;

                        if (isNational) {
                          cellBg = 'bg-rose-100/75 border-rose-200/90';
                          holidayTag = (
                            <span className="text-[8px] font-bold text-rose-700/80 uppercase font-mono tracking-tighter select-none leading-none">
                              LIBUR
                            </span>
                          );
                        } else if (isCuti) {
                          cellBg = 'bg-amber-100/70 border-amber-200/90';
                          holidayTag = (
                            <span className="text-[8px] font-bold text-amber-800/80 uppercase font-mono tracking-tighter select-none leading-none">
                              CUTI
                            </span>
                          );
                        } else if (isSunday) {
                          cellBg = 'bg-rose-50/70 border-rose-100/80';
                          holidayTag = (
                            <span className="text-[8px] font-bold text-rose-500/70 uppercase font-mono tracking-tighter select-none leading-none">
                              MIN
                            </span>
                          );
                        } else if (d.isSaturday) {
                          cellBg = 'bg-slate-50/40 border-slate-100';
                        }

                        return (
                          <div
                            key={d.day}
                            className={`border-r h-full relative flex flex-col justify-between items-center py-1 transition-colors ${cellBg}`}
                            title={d.holidayInfo.isHoliday ? `${d.dateStr} - ${d.holidayInfo.name} (Hari Libur Produksi)` : undefined}
                          >
                            {holidayTag}
                            <span />
                          </div>
                        );
                      })}
                      {/* Blank pads for months < 31 */}
                      {Array.from({ length: 31 - daysInMonth }).map((_, i) => (
                        <div key={`blank-${i}`} className="bg-slate-100/40 border-r border-slate-100" />
                      ))}

                      {/* Render Horizontal Gantt Schedule Blocks */}
                      <div className="absolute inset-0 p-1.5 flex flex-col gap-1.5 justify-center pointer-events-none">
                        {visibleSchedules.map((sch) => {
                          const conflict = getConflictForSchedule(sch.id);
                          const hasConflict = Boolean(conflict);

                          // Calculate start day and end day clipped to current month
                          const sStart = new Date(sch.productionDate);
                          const sEnd = new Date(sch.finishDate);

                          const startDay =
                            sStart.getFullYear() === currentYear && sStart.getMonth() === currentMonth
                               ? sStart.getDate()
                               : 1;

                          const endDay =
                            sEnd.getFullYear() === currentYear && sEnd.getMonth() === currentMonth
                              ? sEnd.getDate()
                              : daysInMonth;

                          // Left % and Width %
                          const leftPct = ((startDay - 1) / 31) * 100;
                          const widthPct = Math.max(1, (endDay - startDay + 1) / 31) * 100;

                          const colors = getBlockColor(sch, hasConflict);

                          return (
                            <button
                              type="button"
                              key={sch.id}
                              aria-label={`Detail jadwal ${sch.orNumber} ${sch.style}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailSelectedWsId(null);
                                setRefreshFeedback(null);
                                setDetailActionError(null);
                                setConfirmDeleteId(null);
                                setActiveDetailSchedule(sch);
                              }}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                              }}
                              className={`relative pointer-events-auto h-9 rounded-md shadow-xs p-1.5 cursor-pointer transition-all duration-150 flex items-center justify-between text-left text-xs font-semibold overflow-hidden group ${colors.bg} ${colors.border} ${colors.text}`}
                              title={`${sch.orNumber} - ${sch.style} | Target: ${sch.target} | ${sch.productionDate} s/d ${sch.finishDate}${hasConflict ? ' [BENTROK DENGAN ' + conflict?.conflictingWith.map(cw => cw.orNumber).join(', ') + ']' : ''}`}
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                {hasConflict && (
                                  <AlertTriangle className="w-3.5 h-3.5 text-white animate-pulse shrink-0" />
                                )}
                                <span className="font-mono font-bold truncate">
                                  {sch.orNumber}
                                </span>
                                <span className="opacity-80 text-[11px] truncate hidden md:inline">
                                  · {sch.style}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0 ml-1">
                                {sch.worksheets && sch.worksheets.length > 0 && (
                                  <span
                                    className="text-[10px] bg-white/30 backdrop-blur-xs px-1 py-0.2 rounded flex items-center gap-0.5 font-bold"
                                    title={`${sch.worksheets.length} PDF Worksheet terlampir`}
                                  >
                                    <Paperclip className="w-2.5 h-2.5" />
                                    <span>{sch.worksheets.length}</span>
                                  </span>
                                )}
                                <span className={`text-[10px] font-mono px-1 py-0.2 rounded font-bold ${colors.badge}`}>
                                  {sch.target.toLocaleString('id-ID')}
                                </span>
                              </div>

                              {/* Hover Indicator tooltip badge */}
                              {hasConflict && (
                                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-400 animate-ping" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Board Legend with Holiday & Schedule indicators */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-600" />
              Legenda Kalender:
            </span>
            {/* Hari Libur Nasional */}
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-rose-100 border border-rose-300 inline-block shadow-2xs" />
              <span className="font-medium text-rose-950">Hari Libur Nasional (Tanggal Merah)</span>
            </div>
            {/* Cuti Bersama */}
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-amber-100 border border-amber-300 inline-block shadow-2xs" />
              <span className="font-medium text-amber-950">Cuti Bersama</span>
            </div>
            {/* Hari Minggu */}
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-rose-50 border border-rose-200 inline-block shadow-2xs" />
              <span className="font-medium text-slate-700">Hari Minggu (Libur Rutin)</span>
            </div>
            {/* Jadwal Normal */}
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-blue-600 inline-block" />
              <span>Jadwal Normal (Line Terjadwal)</span>
            </div>
            {/* Jadwal Bertabrakan */}
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-xs bg-amber-500 ring-2 ring-amber-300 inline-block" />
              <span className="font-semibold text-amber-900">Jadwal Bertabrakan (Collision)</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-500">
            * Kolom nama line tetap terkunci di sisi kiri saat kalender digeser secara horizontal.
          </div>
        </div>
      </div>


      {/* Schedule Detail Modal */}
      {activeDetailSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className={`bg-white rounded-xl shadow-2xl border border-slate-200 w-full ${activeDetailSchedule.worksheets && activeDetailSchedule.worksheets.length > 0 ? 'max-w-4xl max-h-[92vh] overflow-y-auto' : 'max-w-lg'} overflow-hidden animate-in fade-in zoom-in-95 duration-150`}>
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-20">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold">Detail Jadwal Produksi</h3>
              </div>
              <button
                onClick={() => setActiveDetailSchedule(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* Collision Alert if active schedule has clash */}
              {(() => {
                const conf = getConflictForSchedule(activeDetailSchedule.id);
                if (!conf) return null;
                return (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Peringatan Bentrok Jadwal di {activeDetailSchedule.productionLine}
                    </div>
                    <p className="text-amber-800">
                      Jadwal ini bertabrakan tanggal dengan Nomor OR: <strong>{conf.conflictingWith.map((cw) => cw.orNumber).join(', ')}</strong>.
                    </p>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Nomor OR</span>
                  <span className="text-sm font-bold font-mono text-slate-900">
                    {activeDetailSchedule.orNumber}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Line Produksi</span>
                  <span className="text-sm font-bold text-blue-700">
                    {activeDetailSchedule.productionLine}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs">
                <span className="text-slate-500 block mb-0.5">Style Pakaian / Produk</span>
                <span className="text-xs font-semibold text-slate-800">
                  {activeDetailSchedule.style}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Target Produksi</span>
                  <span className="text-sm font-bold font-mono text-slate-900">
                    {activeDetailSchedule.target.toLocaleString('id-ID')} pcs
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Tanggal Mulai</span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {activeDetailSchedule.productionDate}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Tanggal Selesai</span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {activeDetailSchedule.finishDate}
                  </span>
                </div>
              </div>

              {/* Attached PDF Worksheets Section (Menampilkan Snapshot Tersimpan - Tanpa Auto-Rematch) */}
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
                    : 'Belum ada upload Excel untuk OR ini saat snapshot';
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
                        <Paperclip className="w-4 h-4 text-blue-600" />
                        <h4 className="text-xs font-bold text-slate-900">
                          Worksheet PDF Terlampir ({wsList.length} File)
                        </h4>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                          Snapshot Tersimpan
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">
                          Total Target: {wsList.reduce((acc, w) => acc + (w.target || 0), 0).toLocaleString('id-ID')} pcs
                        </span>
                        <button
                          type="button"
                          onClick={handleRefreshScheduleSnapshot}
                          disabled={isRefreshingSnapshot}
                          className="px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-md shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                          title="Sinkronkan ulang Diterima & Status terhadap upload Excel terbaru per masing-masing No. OR"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSnapshot ? 'animate-spin' : ''}`} />
                          <span>{isRefreshingSnapshot ? 'Menyegarkan...' : 'Refresh Ketersediaan Material'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Inline Feedback after Manual Refresh */}
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
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{refreshFeedback.message}</span>
                      </div>
                    )}

                    {/* Worksheet Tabs if multiple */}
                    {wsList.length > 1 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        {wsList.map((ws, idx) => {
                          const isSelected = (activeWs.id === ws.id);
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
                              <FileText className="w-3.5 h-3.5" />
                              <span>{ws.fileName}</span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-200 text-slate-600'}`}>
                                OR {ws.orNumber}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Active Worksheet Overview Card */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{activeWs.fileName}</span>
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                            No. OR: {activeWs.orNumber}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-slate-600">
                            Style: <strong>{activeWs.style}</strong>
                          </span>
                          <span className="text-slate-600">
                            Target (Total Qty): <strong className="font-mono text-slate-900">{activeWs.target.toLocaleString('id-ID')} pcs</strong>
                          </span>
                        </div>
                      </div>

                      {/* Status Badges & Provenance */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-200/60">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-500 font-medium">Material ({snapshotRows.length} item):</span>
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
                            <span>· Disinkronkan: <strong className="text-slate-700">{syncedTimeLabel}</strong></span>
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
                              <th className="py-2 px-3 text-right">Total</th>
                              <th className="py-2 px-3 text-right">Diterima</th>
                              <th className="py-2 px-3 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {snapshotRows.map((item, idx) => (
                              <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors">
                                <td className="py-2 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                                  {item.materialCode}
                                </td>
                                <td className="py-2 px-3 text-slate-800">
                                  {item.materialName}
                                </td>
                                <td className="py-2 px-2 text-center text-slate-600 font-mono text-[11px]">
                                  {item.unit}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">
                                  {item.total !== null && item.total !== undefined
                                    ? item.total.toLocaleString('id-ID', { maximumFractionDigits: 4 })
                                    : '-'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-slate-900">
                                  {item.receivedQty !== null && item.receivedQty !== undefined ? (
                                    <span className="font-bold">{item.receivedQty.toLocaleString('id-ID')}</span>
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
                                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-300" title="Tidak ditemukan di upload Excel terbaru untuk No. OR ini">
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
                      <span className="text-[11px] font-semibold text-rose-800">
                        Yakin hapus?
                      </span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className={`bg-white rounded-xl shadow-2xl border border-slate-200 w-full ${uploadedPdfs.length > 0 ? 'max-w-4xl' : 'max-w-xl'} max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150`}>
            {/* Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-20">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold">
                  {modalMode === 'create' ? 'Tambah Jadwal Produksi Baru' : 'Perbarui Jadwal Produksi'}
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
              {/* Validation error banner */}
              {formValidationError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{formValidationError}</span>
                </div>
              )}

              {/* Conflict warning preview (Allowed to save!) */}
              {formConflictPreview && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    Peringatan Bentrok Jadwal di {formData.productionLine}
                  </div>
                  <p className="text-amber-800">
                    Jadwal bertabrakan dengan:
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5 text-amber-900">
                    {formConflictPreview.map((c, i) => (
                      <li key={i}>
                        <strong>{c.orNumber}</strong> ({c.style}) rentang {c.dates}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-amber-700 pt-1 font-medium">
                    * Sesuai ketentuan PPIC, Anda tetap dapat menyimpan jadwal ini tanpa diblokir.
                  </p>
                </div>
              )}

              {/* SECTION: Upload PDF Worksheet (Multiple Files Supported) */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        Upload PDF Worksheet (Multi-File)
                        <span className="text-[10px] px-1.5 py-0.2 rounded font-normal bg-blue-50 text-blue-700 border border-blue-200">
                          Opsional / Otomatis
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Ekstraksi otomatis No. OR, Style, Target Produksi (Total Qty), dan Kebutuhan Material dari dokumen PDF Worksheet.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Dropzone Upload Button */}
                <div>
                  <label
                    htmlFor="worksheet-pdf-input"
                    className={`border-2 border-dashed rounded-lg p-3.5 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                      isProcessingPdfs
                        ? 'border-blue-400 bg-blue-50/50'
                        : 'border-slate-300 hover:border-blue-500 hover:bg-white bg-slate-50/60'
                    }`}
                  >
                    <input
                      id="worksheet-pdf-input"
                      type="file"
                      accept=".pdf,application/pdf"
                      multiple
                      disabled={isProcessingPdfs}
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handlePdfFilesUpload(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                    {isProcessingPdfs ? (
                      <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Mengekstrak teks PDF & mencocokkan dengan Master Data...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center text-center gap-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          <Upload className="w-4 h-4 text-blue-600" />
                          <span>Klik untuk memilih atau seret beberapa file PDF Worksheet ke sini</span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Mendukung satu atau banyak file PDF sekaligus (No. OR boleh sama maupun berbeda)
                        </span>
                      </div>
                    )}
                  </label>
                </div>

                {/* Uploaded PDF List */}
                {uploadedPdfs.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">
                        File Terunggah ({uploadedPdfs.length} PDF):
                      </span>
                      {uploadedPdfs.some((p) => p.status === 'success') && (
                        <button
                          type="button"
                          onClick={handleSyncPdfDataToForm}
                          className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Sinkronkan Ulang ke Form
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {uploadedPdfs.map((pdf) => {
                        const isSelected = selectedPreviewPdfId === pdf.id;
                        return (
                          <div
                            key={pdf.id}
                            onClick={() => setSelectedPreviewPdfId(pdf.id)}
                            className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex items-start justify-between gap-2 ${
                              isSelected
                                ? 'bg-white border-blue-500 shadow-xs ring-1 ring-blue-500'
                                : 'bg-white hover:bg-slate-100/60 border-slate-200'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <FileText className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                                <span className="font-bold text-slate-800 truncate" title={pdf.fileName}>
                                  {pdf.fileName}
                                </span>
                              </div>

                              {pdf.status === 'parsing' && (
                                <div className="flex items-center gap-1 text-[11px] text-blue-600 mt-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span>Mengekstrak data...</span>
                                </div>
                              )}

                              {pdf.status === 'error' && (
                                <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-1.5 flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600" />
                                  <span className="leading-snug">{pdf.error}</span>
                                </div>
                              )}

                              {pdf.status === 'success' && (
                                <div className="space-y-1 mt-1 text-[11px]">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="px-1.5 py-0.2 rounded font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                      OR: {pdf.orNumber || '-'}
                                    </span>
                                    {pdf.worksheetNo && (
                                      <span className="px-1.5 py-0.2 rounded font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                        WS: {pdf.worksheetNo}
                                      </span>
                                    )}
                                    <span className="px-1.5 py-0.2 rounded font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                                      Target: {pdf.target !== null && pdf.target !== undefined ? pdf.target.toLocaleString('id-ID') : '-'} pcs
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      {pdf.materials?.length || 0} Material
                                    </span>
                                    {pdf.needsReview && !pdf.reviewConfirmed && (
                                      <span className="px-1.5 py-0.2 rounded font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                                        Perlu Review
                                      </span>
                                    )}
                                    {pdf.reviewConfirmed && (
                                      <span className="px-1.5 py-0.2 rounded font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        Terkonfirmasi
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-slate-600 truncate text-[10px]">
                                    Style: {pdf.style || '-'}
                                  </p>
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemovePdf(pdf.id);
                              }}
                              className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors shrink-0"
                              title="Hapus PDF ini"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Aggregated Target Banner */}
                    {uploadedPdfs.some((p) => p.status === 'success') && (() => {
                      const valid = uploadedPdfs.filter((p) => p.status === 'success');
                      const totalTarget = valid.reduce((acc, p) => acc + (p.target || 0), 0);
                      return (
                        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
                          <div className="flex items-center gap-1.5 font-medium">
                            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span>
                              Total Akumulasi Target ({valid.length} PDF): <strong className="font-mono font-bold">{totalTarget.toLocaleString('id-ID')} pcs</strong>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleSyncPdfDataToForm}
                            className="px-2.5 py-1 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-2xs transition-colors"
                          >
                            Gunakan sebagai Target Jadwal
                          </button>
                        </div>
                      );
                    })()}

                    {/* Preview, Validation & Inline Review/Edit Panel for Selected PDF */}
                    {(() => {
                      const activePdf =
                        uploadedPdfs.find((p) => p.id === selectedPreviewPdfId) ||
                        uploadedPdfs.find((p) => p.status === 'success');
                      if (!activePdf || activePdf.status !== 'success') {
                        return null;
                      }

                      const previewRows: FormWorksheetMaterial[] = activePdf.materials || [];
                      const readyCount = previewRows.filter((m) => m.status === 'READY').length;
                      const notReadyCount = previewRows.filter((m) => m.status === 'BELUM READY').length;
                      const notFoundCount = previewRows.filter((m) => !m.isFoundInMasterData).length;
                      const emptyTotalCount = previewRows.filter(
                        (m) => m.total === null || m.total === undefined
                      ).length;
                      const uploadBadgeLabel = activePdf.matchedUploadDate
                        ? `Upload Terbaru: ${activePdf.matchedUploadDate}${activePdf.matchedUploadTime ? ` ${activePdf.matchedUploadTime}` : ''}`
                        : 'Belum ada upload Excel untuk OR ini';

                      const hasBlockingMissingFields =
                        !activePdf.orNumber?.trim() ||
                        !activePdf.style?.trim() ||
                        activePdf.target === null ||
                        activePdf.target === undefined ||
                        activePdf.target <= 0 ||
                        previewRows.length === 0 ||
                        previewRows.some(
                          (m) =>
                            !m.materialCode?.trim() ||
                            !m.materialName?.trim() ||
                            !m.unit?.trim() ||
                            m.total === null ||
                            m.total === undefined
                        );

                      return (
                        <div className="mt-3 bg-white border border-slate-200 rounded-lg p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <Eye className="w-3.5 h-3.5 text-blue-600" />
                              <span className="font-bold text-slate-800">
                                Preview & Validasi Worksheet: {activePdf.fileName}
                              </span>
                              {activePdf.extractionMethod && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200 font-mono">
                                  {activePdf.extractionMethod === 'gemini'
                                    ? 'OCR/AI'
                                    : activePdf.extractionMethod === 'hybrid'
                                      ? 'Hybrid Teks+AI'
                                      : 'Teks PDF'}
                                </span>
                              )}
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
                                onClick={handleRefreshFormPdfSnapshots}
                                disabled={isRefreshingFormPreview}
                                className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded flex items-center gap-1 cursor-pointer"
                                title="Periksa ulang kecocokan terhadap upload Excel terbaru per OR"
                              >
                                <RefreshCw className={`w-3 h-3 ${isRefreshingFormPreview ? 'animate-spin' : ''}`} />
                                <span>Refresh Ketersediaan</span>
                              </button>
                            </div>
                          </div>

                          {/* Review / Warning Banner when validation flags exist */}
                          {activePdf.needsReview && !activePdf.reviewConfirmed && (
                            <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 space-y-1.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 font-bold">
                                  <FileWarning className="w-4 h-4 text-amber-600 shrink-0" />
                                  <span>Perlu Review & Konfirmasi Pengguna Sebelum Disimpan</span>
                                </div>
                                {!hasBlockingMissingFields && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdatePdfField(activePdf.id, { reviewConfirmed: true })
                                    }
                                    className="px-2.5 py-1 text-[10px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded flex items-center gap-1"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Konfirmasi Data Sudah Benar</span>
                                  </button>
                                )}
                              </div>
                              <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                                {(activePdf.reviewReasons || []).map((reason, rIdx) => (
                                  <li key={rIdx}>{reason}</li>
                                ))}
                              </ul>
                              {emptyTotalCount > 0 && (
                                <p className="text-[10px] font-semibold text-amber-900">
                                  * Lengkapi {emptyTotalCount} kolom TOTAL yang masih kosong pada tabel di bawah sebelum menyimpan jadwal.
                                </p>
                              )}
                            </div>
                          )}

                          {/* Editable Extracted Identity Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px]">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                No. OR * {activePdf.rawOrNumber ? `(${activePdf.rawOrNumber})` : ''}
                              </label>
                              <input
                                type="text"
                                value={activePdf.orNumber || ''}
                                onChange={(e) =>
                                  handleUpdatePdfField(activePdf.id, { orNumber: e.target.value })
                                }
                                placeholder="Contoh: 1014"
                                className={`w-full px-2 py-1 text-xs font-mono font-bold rounded border bg-white ${
                                  !activePdf.orNumber?.trim()
                                    ? 'border-rose-400 bg-rose-50'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                No. Worksheet
                              </label>
                              <input
                                type="text"
                                value={activePdf.worksheetNo || ''}
                                onChange={(e) =>
                                  handleUpdatePdfField(activePdf.id, { worksheetNo: e.target.value })
                                }
                                placeholder="Contoh: WH/MO/22512 · Lot - 1"
                                className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-300 bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Style No *
                              </label>
                              <input
                                type="text"
                                value={activePdf.style || ''}
                                onChange={(e) =>
                                  handleUpdatePdfField(activePdf.id, { style: e.target.value })
                                }
                                placeholder="Nama / Kode Style"
                                className={`w-full px-2 py-1 text-xs rounded border bg-white ${
                                  !activePdf.style?.trim()
                                    ? 'border-rose-400 bg-rose-50'
                                    : 'border-slate-300'
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Target Qty * {activePdf.rawTarget ? `(PDF: "${activePdf.rawTarget}")` : ''}
                              </label>
                              <input
                                type="number"
                                min="1"
                                step="any"
                                value={activePdf.target ?? ''}
                                onChange={(e) =>
                                  handleUpdatePdfField(activePdf.id, {
                                    target: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                placeholder="Target Qty"
                                className={`w-full px-2 py-1 text-xs font-mono font-bold rounded border bg-white ${
                                  activePdf.target === null ||
                                  activePdf.target === undefined ||
                                  activePdf.target <= 0
                                    ? 'border-rose-400 bg-rose-50'
                                    : activePdf.isTargetAmbiguous
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-slate-300'
                                }`}
                              />
                            </div>
                          </div>

                          <div className="text-[10px] text-slate-500 flex items-center justify-between">
                            <span>
                              Sumber Pencocokan:{' '}
                              <strong className="font-mono text-slate-700">{uploadBadgeLabel}</strong>
                            </span>
                            <span className="text-slate-400">
                              Nilai di preview dapat diperiksa & diedit langsung sebelum disimpan
                            </span>
                          </div>

                          {/* Mandatory 6-Column Editable Review Table */}
                          {previewRows.length === 0 ? (
                            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
                              Tidak ada baris material yang terbaca dari tabel MATERIAL & KONSUMSI.
                            </div>
                          ) : (
                            <div className="border border-slate-200 rounded-md overflow-hidden">
                              <div className="max-h-60 overflow-y-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead className="bg-slate-100 text-slate-700 font-semibold text-[11px] uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                                    <tr>
                                      <th className="py-2 px-2.5">Kode Material</th>
                                      <th className="py-2 px-2.5">Nama Material</th>
                                      <th className="py-2 px-2 text-center">Satuan</th>
                                      <th className="py-2 px-2.5 text-right">Total</th>
                                      <th className="py-2 px-2.5 text-right">Diterima</th>
                                      <th className="py-2 px-2.5 text-center">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {previewRows.map((item, idx) => {
                                      const isMissingTotal = item.total === null || item.total === undefined;
                                      const rowWarning = isMissingTotal || item.isTotalAmbiguous || item.needsReview;
                                      return (
                                        <tr
                                          key={item.id || idx}
                                          className={`transition-colors ${
                                            rowWarning ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50'
                                          }`}
                                          title={item.reviewNote || undefined}
                                        >
                                          <td className="py-1.5 px-2.5 font-mono font-medium text-slate-900 whitespace-nowrap">
                                            <input
                                              type="text"
                                              value={item.materialCode}
                                              onChange={(e) =>
                                                handleUpdatePdfMaterialRow(activePdf.id, idx, {
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
                                                handleUpdatePdfMaterialRow(activePdf.id, idx, {
                                                  materialName: e.target.value,
                                                })
                                              }
                                              className="w-full min-w-[160px] px-1.5 py-0.5 text-[11px] border border-slate-200 rounded bg-white focus:border-blue-500 focus:outline-hidden"
                                            />
                                          </td>
                                          <td className="py-1.5 px-2 text-center text-slate-600 font-mono text-[11px]">
                                            <input
                                              type="text"
                                              value={item.unit}
                                              onChange={(e) =>
                                                handleUpdatePdfMaterialRow(activePdf.id, idx, {
                                                  unit: e.target.value,
                                                })
                                              }
                                              className="w-16 text-center px-1 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white focus:border-blue-500 focus:outline-hidden"
                                            />
                                          </td>
                                          <td className="py-1.5 px-2.5 text-right font-mono font-semibold text-slate-900">
                                            <div className="flex flex-col items-end gap-0.5">
                                              <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={item.total ?? ''}
                                                placeholder="Kosong"
                                                onChange={(e) =>
                                                  handleUpdatePdfMaterialRow(activePdf.id, idx, {
                                                    total:
                                                      e.target.value === '' ? null : Number(e.target.value),
                                                  })
                                                }
                                                className={`w-24 text-right px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded border focus:outline-hidden ${
                                                  isMissingTotal
                                                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                                                    : item.isTotalAmbiguous
                                                      ? 'border-amber-400 bg-amber-50'
                                                      : 'border-slate-200 bg-white focus:border-blue-500'
                                                }`}
                                              />
                                              {item.rawTotal && (
                                                <span className="text-[9px] text-slate-400 font-normal">
                                                  PDF: {item.rawTotal}
                                                </span>
                                              )}
                                              {isMissingTotal && (
                                                <span className="text-[9px] text-amber-700 font-semibold">
                                                  Kosong di PDF
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-1.5 px-2.5 text-right font-mono text-slate-900">
                                            {item.receivedQty !== null && item.receivedQty !== undefined ? (
                                              <span className="font-bold">
                                                {item.receivedQty.toLocaleString('id-ID')}
                                              </span>
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
                                                title="Tidak ditemukan di upload Excel terbaru untuk No. OR ini"
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
                          )}
                          <p className="text-[10px] text-slate-400 italic">
                            * Pencocokan hanya mengambil data dari transaksi upload Excel terbaru untuk OR{' '}
                            {activePdf.orNumber || '-'}. Hasil yang sudah valid akan disimpan sebagai snapshot permanen saat jadwal disimpan.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Form Divider */}
              <div className="pt-2 border-t border-slate-200">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Formulir Jadwal Produksi (6 Kolom Wajib)
                </span>
              </div>

              {/* Field 1: Nomor OR */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    1. Nomor OR *
                  </label>
                  <span className="text-[10px] text-blue-600 font-medium">
                    Terdaftar via Upload Excel ({registeredOrNumbers.length} OR)
                  </span>
                </div>
                <div className="space-y-1.5">
                  <input
                    type="text"
                    required
                    value={formData.orNumber}
                    onChange={(e) => handleOrChange(e.target.value)}
                    placeholder="Ketik Nomor OR (Contoh: OR-2026-001)"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono uppercase focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />

                  {/* Quick OR selector chips */}
                  {registeredOrNumbers.length > 0 ? (
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
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
                  ) : (
                    <div className="text-[11px] text-amber-600 font-medium py-1">
                      Belum ada Nomor OR. Unggah file Excel terlebih dahulu.
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Pilih dari Nomor OR yang terdaftar di Upload Excel atau isi sesuai No. OR Worksheet PDF.
                </p>
              </div>

              {/* Field 5: Style */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  2. Style *
                </label>
                <input
                  type="text"
                  required
                  value={formData.style}
                  onChange={(e) => setFormData({ ...formData, style: e.target.value })}
                  placeholder="Contoh: Casual Cotton Shirt Men Navy"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Field 4: Line Produksi */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  3. Line Produksi *
                </label>
                <select
                  required
                  value={formData.productionLine}
                  onChange={(e) => setFormData({ ...formData, productionLine: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {defaultLines.map((ln) => (
                    <option key={ln} value={ln}>
                      {ln}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dates: Tanggal Produksi & Tanggal Selesai */}
              <div className="grid grid-cols-2 gap-3">
                {/* Field 2: Tanggal Produksi */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    4. Tanggal Produksi (Mulai) *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.productionDate}
                    onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Field 3: Tanggal Selesai */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    5. Tanggal Selesai *
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

              {/* Field 6: Target */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  6. Target (Pcs) *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.target}
                  onChange={(e) => setFormData({ ...formData, target: parseFloat(e.target.value) || 0 })}
                  placeholder="Jumlah target output (angka positif)"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Target terakumulasi otomatis dari seluruh PDF Worksheet yang diunggah (atau dapat disesuaikan manual).
                </p>
              </div>

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
                  disabled={isProcessingPdfs || isSubmittingForm}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5"
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
                        ? 'Simpan Jadwal'
                        : 'Simpan Perubahan'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
