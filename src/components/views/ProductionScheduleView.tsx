import React, { useState, useMemo } from 'react';
import { usePpic } from '../../context/PpicContext';
import { ProductionSchedule, ScheduleConflict } from '../../types/ppic';
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
} from 'lucide-react';
import { getIndonesianHolidayInfo, DayHolidayInfo } from '../../utils/indonesianHolidays';

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
  } = usePpic();

  // Calendar Month Navigation: Default to November 2026 (matching demo dataset) or current date
  const [currentYear, setCurrentYear] = useState<number>(2026);
  const [currentMonth, setCurrentMonth] = useState<number>(10); // 0-indexed: 10 = November
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('ALL');
  const [selectedOrFilter, setSelectedOrFilter] = useState<string>('ALL');

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
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (sch: ProductionSchedule) => {
    setModalMode('edit');
    setEditingScheduleId(sch.id);
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
    setActiveDetailSchedule(null);
    setIsModalOpen(true);
  };

  // Submit Form (Validation: finish >= start, target > 0, allow conflicts)
  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
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

    if (modalMode === 'create') {
      addProductionSchedule({
        orNumber: formData.orNumber.trim().toUpperCase(),
        productionDate: formData.productionDate,
        finishDate: formData.finishDate,
        productionLine: formData.productionLine,
        style: formData.style.trim(),
        target: Number(formData.target),
        status: formData.status,
      });
    } else if (editingScheduleId) {
      updateProductionSchedule(editingScheduleId, {
        orNumber: formData.orNumber.trim().toUpperCase(),
        productionDate: formData.productionDate,
        finishDate: formData.finishDate,
        productionLine: formData.productionLine,
        style: formData.style.trim(),
        target: Number(formData.target),
        status: formData.status,
      });
    }

    // Save relation
    saveOrStyleRelation(formData.orNumber.trim().toUpperCase(), formData.style.trim());

    setIsModalOpen(false);
  };

  // Delete Schedule
  const handleDeleteSchedule = (id: string) => {
    if (confirm('Apakah Anda yakin ingin menghapus jadwal produksi ini?')) {
      deleteProductionSchedule(id);
      setActiveDetailSchedule(null);
    }
  };

  // Filter lines to display
  const displayLines = useMemo(() => {
    if (selectedLineFilter === 'ALL') return defaultLines;
    return defaultLines.filter((l) => l === selectedLineFilter);
  }, [defaultLines, selectedLineFilter]);

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
                      if (sch) setActiveDetailSchedule(sch);
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
          >
            Reset ke Nov 2026
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

          {/* OR Filter (Integrated with single source of truth) */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-600">Filter OR:</span>
            <select
              value={selectedOrFilter}
              onChange={(e) => setSelectedOrFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">Semua OR ({registeredOrNumbers.length})</option>
              {registeredOrNumbers.length === 0 ? (
                <option disabled value="">Belum ada Nomor OR</option>
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
      </div>

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
                  if (selectedOrFilter !== 'ALL' && s.orNumber !== selectedOrFilter) return false;
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
                            <div
                              key={sch.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDetailSchedule(sch);
                              }}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                              }}
                              className={`relative pointer-events-auto h-9 rounded-md shadow-xs p-1.5 cursor-pointer transition-all duration-150 flex items-center justify-between text-xs font-semibold overflow-hidden group ${colors.bg} ${colors.border} ${colors.text}`}
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
                                <span className={`text-[10px] font-mono px-1 py-0.2 rounded font-bold ${colors.badge}`}>
                                  {sch.target.toLocaleString('id-ID')}
                                </span>
                              </div>

                              {/* Hover Indicator tooltip badge */}
                              {hasConflict && (
                                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-400 animate-ping" />
                              )}
                            </div>
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
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
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

              {/* Action buttons */}
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMenu('Material Risk Analysis');
                    setActiveDetailSchedule(null);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded flex items-center gap-1.5"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Cek Risiko Material OR Ini
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteSchedule(activeDetailSchedule.id)}
                    className="px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(activeDetailSchedule)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded flex items-center gap-1"
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

      {/* Add / Edit Schedule Form Modal (6 Required Fields) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold">
                  {modalMode === 'create' ? 'Tambah Jadwal Produksi Baru' : 'Perbarui Jadwal Produksi'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
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
                    list="orOptionsList"
                    value={formData.orNumber}
                    onChange={(e) => handleOrChange(e.target.value)}
                    placeholder="Contoh: OR-2026-001"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md font-mono uppercase focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                  <datalist id="orOptionsList">
                    {registeredOrNumbers.map((or) => {
                      const summary = getOrSummary(or);
                      return (
                        <option key={or} value={or}>
                          {summary?.style ? `${or} (${summary.style})` : or}
                        </option>
                      );
                    })}
                  </datalist>

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
                  Pilih dari Nomor OR yang terdaftar di Upload Excel. Style akan terisi otomatis secara konsisten.
                </p>
              </div>

              {/* Field 5: Style (Placed near OR for visual clarity) */}
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
                  Target harus berupa angka positif (&gt; 0).
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <CheckCircle className="w-4 h-4" />
                  {modalMode === 'create' ? 'Simpan Jadwal' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
