import React, { useState, useMemo } from 'react';
import { usePpic } from '../../context/PpicContext';
import {
  calculateParetoAnalysis,
  calculateMaterialComparisonMetrics,
} from '../../utils/ppicCalculations';
import {
  CalendarClock,
  ShieldAlert,
  Flame,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Filter,
  BarChart3,
  PieChart,
  Search,
  Hash,
  X,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    materialRequirements,
    productionSchedules,
    materialRiskAssessments,
    setActiveMenu,
    registeredOrNumbers,
    getOrSummary,
  } = usePpic();

  // Manual Text Input Search for Nomor OR on Dashboard (NO dropdown!)
  const [orSearchInput, setOrSearchInput] = useState<string>('');
  const [selectedPeriodFilter, setSelectedPeriodFilter] = useState<string>('ALL');

  // Filtered requirements based on typed OR (substring matching, case-insensitive)
  // If empty, displays overall data like previous Dashboard behavior
  const filteredRequirements = useMemo(() => {
    const q = orSearchInput.trim().toUpperCase();
    if (!q) {
      return materialRequirements;
    }
    return materialRequirements.filter((r) => r.orNumber.toUpperCase().includes(q));
  }, [materialRequirements, orSearchInput]);

  // Filtered production schedules for typed OR
  const filteredSchedules = useMemo(() => {
    const q = orSearchInput.trim().toUpperCase();
    if (!q) {
      return productionSchedules;
    }
    return productionSchedules.filter((s) => s.orNumber.toUpperCase().includes(q));
  }, [productionSchedules, orSearchInput]);

  // Matching registered ORs for style information preview badge
  const matchingRegisteredOrs = useMemo(() => {
    const q = orSearchInput.trim().toUpperCase();
    if (!q) return [];
    return registeredOrNumbers.filter((or) => or.toUpperCase().includes(q));
  }, [registeredOrNumbers, orSearchInput]);

  // Actual Metrics calculated from filtered requirements
  const comparison = useMemo(() => {
    return calculateMaterialComparisonMetrics(filteredRequirements);
  }, [filteredRequirements]);

  // Pareto Chart items from filtered requirements
  const paretoData = useMemo(() => {
    return calculateParetoAnalysis(filteredRequirements);
  }, [filteredRequirements]);

  // Top materials for Kebutuhan vs Diterima bar chart
  const topMaterialsComparison = useMemo(() => {
    // Group requirements by materialCode
    const map = new Map<string, { code: string; name: string; unit: string; required: number; received: number }>();
    for (const req of filteredRequirements) {
      const existing = map.get(req.materialCode) || {
        code: req.materialCode,
        name: req.materialName,
        unit: req.unit,
        required: 0,
        received: 0,
      };
      existing.required += req.requiredQty;
      existing.received += req.receivedQty;
      map.set(req.materialCode, existing);
    }
    // Take top 6 by required
    return Array.from(map.values())
      .sort((a, b) => b.required - a.required)
      .slice(0, 6);
  }, [filteredRequirements]);

  // Critical items
  const criticalItems = materialRiskAssessments.filter(
    (r) => r.riskCategory === 'CRITICAL' || r.riskCategory === 'HIGH'
  );

  const formatIdr = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Plant Overview & Operational Summary */}
      <div className="p-5 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-xl shadow-xs border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg md:text-xl font-bold tracking-tight">
              Dashboard Analisis Kebutuhan Material & Kesiapan Produksi
            </h2>
            <p className="text-slate-300 text-xs md:text-sm mt-1 max-w-2xl">
              Monitoring real-time komparasi material diterima terhadap kebutuhan OR, diagram pareto defisit, dan deteksi risiko lini produksi.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setActiveMenu('Penjadwalan Produksi')}
              className="px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Kalender Gantt Produksi
            </button>
            <button
              onClick={() => setActiveMenu('Material Risk Analysis')}
              className="px-3 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Tinjau Analisis Risiko
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar: Manual Text Input Search for OR dan Periode */}
      <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Filter className="w-4 h-4 text-blue-600" />
          <span>Filter Data Dashboard:</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 flex-1 justify-end">
          {/* Manual Text Input Search OR (Pure text input, NO dropdown!) */}
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-sm">
            <label className="text-xs font-bold text-slate-700 whitespace-nowrap flex items-center gap-1">
              <Hash className="w-3.5 h-3.5 text-blue-600" />
              Cari Nomor OR:
            </label>
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={orSearchInput}
                onChange={(e) => setOrSearchInput(e.target.value)}
                placeholder="Ketik Nomor OR (misal: OR-2026)..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded font-mono font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
              />
              {orSearchInput && (
                <button
                  type="button"
                  onClick={() => setOrSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title="Hapus pencarian OR"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Active Style / Match Preview Badge */}
          {orSearchInput.trim() && (
            <div className="hidden lg:flex items-center gap-1.5">
              {matchingRegisteredOrs.length === 1 && getOrSummary(matchingRegisteredOrs[0])?.style ? (
                <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  Style: {getOrSummary(matchingRegisteredOrs[0])?.style}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">
                  {filteredRequirements.length} baris material cocok
                </span>
              )}
            </div>
          )}

          {/* Periode Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">Periode:</label>
            <select
              value={selectedPeriodFilter}
              onChange={(e) => setSelectedPeriodFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="ALL">Semua Periode</option>
              <option value="2026-11">Bulan November 2026</option>
              <option value="2026-Q4">Kuartal 4 (Q4 2026)</option>
            </select>
          </div>

          {(orSearchInput.trim() || selectedPeriodFilter !== 'ALL') && (
            <button
              onClick={() => {
                setOrSearchInput('');
                setSelectedPeriodFilter('ALL');
              }}
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* 4 Core Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Kebutuhan vs Diterima */}
        <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Material Fulfillment</span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded ${
                comparison.fulfillmentRatio >= 80
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {comparison.fulfillmentRatio}% Terpenuhi
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {comparison.totalReceived.toLocaleString('id-ID')}
            </span>
            <span className="text-xs text-slate-500">
              / {comparison.totalRequired.toLocaleString('id-ID')} unit
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                comparison.fulfillmentRatio >= 80
                  ? 'bg-emerald-500'
                  : comparison.fulfillmentRatio >= 50
                  ? 'bg-amber-500'
                  : 'bg-red-500'
              }`}
              style={{ width: `${comparison.fulfillmentRatio}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-slate-500 flex justify-between">
            <span>Defisit Total:</span>
            <strong className="text-red-600 font-mono">
              -{comparison.shortageTotal.toLocaleString('id-ID')} unit
            </strong>
          </div>
        </div>

        {/* Card 2: Status Material Ready vs Belum Ready */}
        <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Status Kesiapan Item</span>
            <PieChart className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xl font-bold text-slate-900">{comparison.readyCount}</span>
              <span className="text-xs text-slate-500">READY</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <span className="text-xl font-bold text-slate-900">{comparison.notReadyCount}</span>
              <span className="text-xs text-slate-500">BELUM READY</span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
            <span>Rasio Kesiapan:</span>
            <strong className="text-emerald-700 font-mono">{comparison.readyPercentage}% Siap</strong>
          </div>
        </div>

        {/* Card 3: Jadwal SPK Terencana (Filtered by typed OR) */}
        <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Jadwal Kalender Produksi</span>
            <CalendarClock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {filteredSchedules.length}
            </span>
            <span className="text-xs text-slate-500">batch OR</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
            <span>Total Target:</span>
            <strong className="text-slate-800 font-mono">
              {filteredSchedules.reduce((acc, s) => acc + s.target, 0).toLocaleString('id-ID')} unit
            </strong>
          </div>
        </div>

        {/* Card 4: Material Kritis */}
        <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Risiko Shortage Kritis</span>
            <Flame className="w-4 h-4 text-red-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-red-600 tabular-nums">
              {criticalItems.length}
            </span>
            <span className="text-xs text-red-600 font-semibold">Item Mendesak</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
            <span>Jarak Produksi:</span>
            <strong className="text-red-700">&le; 7 Hari</strong>
          </div>
        </div>
      </div>

      {/* Row 1: Dual Charts - (1) Kebutuhan vs Diterima & (2) Status READY vs BELUM READY */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart 1 (2 cols): Grafik Kebutuhan Material vs Diterima */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-xs p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Grafik Komparasi: Kebutuhan Material vs Jumlah Material Diterima
              </h3>
              <p className="text-xs text-slate-500">
                Membandingkan kuantitas yang dibutuhkan dengan barang fisik yang telah diterima di gudang
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-slate-400"></span> Kebutuhan
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-emerald-500"></span> Diterima
              </span>
            </div>
          </div>

          {topMaterialsComparison.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              {orSearchInput.trim()
                ? `Tidak ada data material untuk Nomor OR "${orSearchInput}".`
                : 'Belum ada data material yang tersimpan.'}
            </div>
          ) : (
            <div className="space-y-4">
              {topMaterialsComparison.map((item) => {
                const maxVal = Math.max(item.required, item.received, 1);
                const reqPct = Math.round((item.required / maxVal) * 100);
                const recPct = Math.round((item.received / maxVal) * 100);
                const isFulfilled = item.received >= item.required;
                const gap = item.required - item.received;

                return (
                  <div key={item.code} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono font-bold text-slate-900">{item.code}</span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="text-slate-700 font-medium">{item.name}</span>
                      </div>
                      <div className="text-right font-mono">
                        <span className="text-slate-500">
                          {item.received.toLocaleString('id-ID')} / {item.required.toLocaleString('id-ID')} {item.unit}
                        </span>
                        <span
                          className={`ml-2 font-bold ${
                            isFulfilled ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {isFulfilled ? '✓ 100%' : `-${gap.toLocaleString('id-ID')} ${item.unit}`}
                        </span>
                      </div>
                    </div>

                    {/* Dual Bar */}
                    <div className="space-y-1 bg-slate-50 p-1.5 rounded">
                      {/* Bar Kebutuhan */}
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-slate-500 rounded-full transition-all duration-500"
                          style={{ width: `${reqPct}%` }}
                          title={`Kebutuhan: ${item.required} ${item.unit}`}
                        />
                      </div>
                      {/* Bar Diterima */}
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isFulfilled ? 'bg-emerald-500' : 'bg-emerald-600'
                          }`}
                          style={{ width: `${recPct}%` }}
                          title={`Diterima: ${item.received} ${item.unit}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Chart 2 (1 col): Grafik Status Material READY vs BELUM READY */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Grafik Status Kesiapan Material
              </h3>
              <p className="text-xs text-slate-500">
                Proporsi material READY vs BELUM READY
              </p>
            </div>

            {/* Circular / Donut Progress representation */}
            <div className="my-6 text-center">
              <div className="relative inline-flex items-center justify-center">
                <svg className="w-36 h-36 transform -rotate-90">
                  <circle
                    cx="72"
                    cy="72"
                    r="56"
                    stroke="#e2e8f0"
                    strokeWidth="16"
                    fill="transparent"
                  />
                  <circle
                    cx="72"
                    cy="72"
                    r="56"
                    stroke="#10b981"
                    strokeWidth="16"
                    strokeDasharray={351.8}
                    strokeDashoffset={351.8 - (351.8 * comparison.readyPercentage) / 100}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-700"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                    {comparison.readyPercentage}%
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">READY</span>
                </div>
              </div>
            </div>

            {/* Detail Legend breakdown */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between p-2.5 rounded bg-emerald-50/70 border border-emerald-100">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-semibold text-emerald-950">Material READY</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-emerald-800 text-xs">
                    {comparison.readyCount} Item
                  </span>
                  <span className="text-[10px] text-emerald-600 block">
                    ({comparison.readyPercentage}%)
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded bg-amber-50/70 border border-amber-100">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-950">Material BELUM READY</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-amber-800 text-xs">
                    {comparison.notReadyCount} Item
                  </span>
                  <span className="text-[10px] text-amber-600 block">
                    ({comparison.notReadyPercentage}%)
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 text-center">
            <button
              onClick={() => setActiveMenu('Material Risk Analysis')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 cursor-pointer"
            >
              Buka Analisis Risiko Mendalam <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: Pareto Chart - Identifikasi Material dengan Kontribusi Kekurangan Terbesar */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-slate-100 mb-4 gap-2">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Pareto Chart: Material dengan Kontribusi Nilai Kekurangan Terbesar (80/20 Rule)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Material diurutkan menurun berdasarkan nilai kekurangan terbesar (Kebutuhan - Diterima). Menampilkan persentase kontribusi dan kurva kumulatif.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-red-500"></span> Nilai Kekurangan (Bar)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1 bg-blue-600 rounded"></span> % Kumulatif (Kurva)
            </span>
          </div>
        </div>

        {paretoData.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            {orSearchInput.trim()
              ? `Tidak ditemukan kekurangan material untuk Nomor OR "${orSearchInput}".`
              : 'Seluruh material pada filter ini sudah terpenuhi (Tidak ada kekurangan material).'}
          </div>
        ) : (
          <div>
            {/* Visual Pareto Chart Rendering */}
            <div className="space-y-3.5 mb-6">
              {paretoData.map((item, idx) => {
                return (
                  <div key={item.materialCode} className="space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-500 w-5">
                          #{idx + 1}
                        </span>
                        <span className="font-mono font-bold text-slate-900">
                          {item.materialCode}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-700 font-medium truncate max-w-xs">
                          {item.materialName}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-right">
                        <span className="font-mono font-semibold text-red-600">
                          {formatIdr(item.shortageValue)} ({item.shortageQty.toLocaleString('id-ID')} {item.unit})
                        </span>
                        <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono text-slate-700 font-semibold">
                          Kontribusi: {item.contributionPercent}%
                        </span>
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[11px] font-mono font-bold">
                          Kumulatif: {item.cumulativePercent}%
                        </span>
                      </div>
                    </div>

                    {/* Stacked bar visualization */}
                    <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden flex relative">
                      {/* Shortage contribution bar */}
                      <div
                        className="h-full bg-red-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(2, item.contributionPercent)}%` }}
                        title={`Kontribusi Kekurangan: ${item.contributionPercent}%`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pareto Summary Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Peringkat</th>
                    <th className="py-2.5 px-3">Kode Material</th>
                    <th className="py-2.5 px-3">Nama Material</th>
                    <th className="py-2.5 px-3 text-right">Kuantitas Defisit</th>
                    <th className="py-2.5 px-3 text-right">Nilai Kerugian Defisit</th>
                    <th className="py-2.5 px-3 text-right">% Kontribusi</th>
                    <th className="py-2.5 px-3 text-right">% Kumulatif</th>
                    <th className="py-2.5 px-3 text-center">Prioritas Mitigasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paretoData.map((p, idx) => (
                    <tr key={p.materialCode} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-mono text-slate-400 font-bold">#{idx + 1}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{p.materialCode}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{p.materialName}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-red-600 font-bold">
                        -{p.shortageQty.toLocaleString('id-ID')} {p.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {formatIdr(p.shortageValue)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-700">
                        {p.contributionPercent}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700">
                        {p.cumulativePercent}%
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.cumulativePercent <= 80
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {p.cumulativePercent <= 80 ? 'VITAL FEW (Prioritas 1)' : 'SECONDARY'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
