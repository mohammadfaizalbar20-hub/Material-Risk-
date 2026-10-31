import React, { useState, useMemo } from 'react';
import { usePpic } from '../../context/PpicContext';
import { RiskBadge } from '../common/RiskBadge';
import {
  ShieldAlert,
  Flame,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  Filter,
  Layers,
  HelpCircle,
  FileSpreadsheet,
  Clock,
  ChevronDown,
  ChevronUp,
  Tag,
  Hash,
  AlertCircle,
} from 'lucide-react';
import { RiskLevel } from '../../types/ppic';

export const MaterialRiskAnalysisView: React.FC = () => {
  const {
    materialRiskAssessments,
    orRiskSummaries,
    productionSchedules,
    setActiveMenu,
  } = usePpic();

  const [activeTab, setActiveTab] = useState<'or' | 'material'>('or');
  const [filterRisk, setFilterRisk] = useState<string>('ALL');
  const [filterOr, setFilterOr] = useState<string>('ALL');
  const [expandedOrNumber, setExpandedOrNumber] = useState<string | null>(null);

  // List of unique ORs for filter
  const uniqueOrs = useMemo(() => {
    return Array.from(new Set(orRiskSummaries.map((s) => s.orNumber)));
  }, [orRiskSummaries]);

  // Filtered OR Summaries
  const filteredOrSummaries = useMemo(() => {
    return orRiskSummaries.filter((item) => {
      if (filterRisk !== 'ALL' && item.highestRiskCategory !== filterRisk) return false;
      if (filterOr !== 'ALL' && item.orNumber !== filterOr) return false;
      return true;
    });
  }, [orRiskSummaries, filterRisk, filterOr]);

  // Filtered Material Assessments
  const filteredMaterialAssessments = useMemo(() => {
    return materialRiskAssessments.filter((item) => {
      if (filterRisk !== 'ALL' && item.riskCategory !== filterRisk) return false;
      if (filterOr !== 'ALL' && item.orNumber !== filterOr) return false;
      return true;
    });
  }, [materialRiskAssessments, filterRisk, filterOr]);

  // Risk counts
  const riskCounts = useMemo(() => {
    let low = 0, medium = 0, high = 0, critical = 0;
    for (const m of materialRiskAssessments) {
      if (m.riskCategory === 'LOW') low++;
      else if (m.riskCategory === 'MEDIUM') medium++;
      else if (m.riskCategory === 'HIGH') high++;
      else if (m.riskCategory === 'CRITICAL') critical++;
    }
    return { low, medium, high, critical, total: materialRiskAssessments.length };
  }, [materialRiskAssessments]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-5 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            <h2 className="text-base md:text-lg font-bold text-slate-900">
              Material Risk Analysis (Berdasarkan Jadwal Produksi)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Penilaian risiko dinamis dihitung otomatis dari jadwal produksi yang tersimpan. Formula: <strong>Risk Score = (60% × Skor Kekurangan) + (40% × Skor Urgensi)</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveMenu('AI Assistant')}
            className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4 text-blue-200" />
            Konsultasi Mitigasi AI
          </button>
        </div>
      </div>

      {/* Formula & Criteria Card Info */}
      <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-5 border border-slate-800 shadow-md">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400">
            <Layers className="w-4 h-4" />
            Ketentuan & Formula Penilaian Risiko PPIC
          </div>
          <span className="text-[11px] text-slate-400">
            Terhubung ke {productionSchedules.length} Jadwal Produksi
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-3 text-xs">
          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-1">
            <span className="text-slate-400 text-[11px] block">1. Rasio & Skor Kekurangan (60%)</span>
            <div className="font-mono text-slate-200 text-[11px]">
              ((Butuh - Diterima) / Butuh) × 100%
            </div>
            <p className="text-[10px] text-slate-400 pt-1">
              0% = 0 | &le;10% = 25 | &le;30% = 50 | &le;50% = 75 | &gt;50% = 100
            </p>
          </div>

          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-1">
            <span className="text-slate-400 text-[11px] block">2. Skor Urgensi H-Hari (40%)</span>
            <div className="font-mono text-slate-200 text-[11px]">
              Tgl Produksi - Hari Ini
            </div>
            <p className="text-[10px] text-slate-400 pt-1">
              &gt;14h = 0 | 8-14h = 25 | 4-7h = 50 | 1-3h = 75 | &le;0h = 100
            </p>
          </div>

          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-1">
            <span className="text-slate-400 text-[11px] block">3. Kategori Risk Score</span>
            <div className="font-mono text-slate-200 text-[11px]">
              (60% × Skor Kekurangan) + (40% × Skor Urgensi)
            </div>
            <p className="text-[10px] text-slate-400 pt-1">
              0-29: LOW | 30-59: MEDIUM | 60-79: HIGH | 80-100: CRITICAL
            </p>
          </div>

          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-1">
            <span className="text-slate-400 text-[11px] block">4. Ketentuan Khusus</span>
            <p className="text-[11px] text-slate-300">
              • 100% terpenuhi &rarr; otomatis <strong>LOW</strong>
            </p>
            <p className="text-[11px] text-slate-400">
              • Belum terjadwal &rarr; tidak ada risiko final
            </p>
            <p className="text-[11px] text-slate-400">
              • Data tidak lengkap &rarr; status data belum lengkap
            </p>
          </div>
        </div>
      </div>

      {/* 4-Tier Risk Summary Filter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* LOW */}
        <button
          onClick={() => setFilterRisk(filterRisk === 'LOW' ? 'ALL' : 'LOW')}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            filterRisk === 'LOW'
              ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
              : 'border-slate-200 bg-white hover:border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <RiskBadge level="LOW" size="sm" />
            <span className="text-xl font-bold font-mono text-emerald-800 tabular-nums">
              {riskCounts.low}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Skor 0–29 / Material 100% Terpenuhi
          </p>
        </button>

        {/* MEDIUM */}
        <button
          onClick={() => setFilterRisk(filterRisk === 'MEDIUM' ? 'ALL' : 'MEDIUM')}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            filterRisk === 'MEDIUM'
              ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
              : 'border-slate-200 bg-white hover:border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <RiskBadge level="MEDIUM" size="sm" />
            <span className="text-xl font-bold font-mono text-amber-800 tabular-nums">
              {riskCounts.medium}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Skor 30–59 / Defisit Ringan & Jadwal Longgar
          </p>
        </button>

        {/* HIGH */}
        <button
          onClick={() => setFilterRisk(filterRisk === 'HIGH' ? 'ALL' : 'HIGH')}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            filterRisk === 'HIGH'
              ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
              : 'border-slate-200 bg-white hover:border-orange-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <RiskBadge level="HIGH" size="sm" />
            <span className="text-xl font-bold font-mono text-orange-800 tabular-nums">
              {riskCounts.high}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Skor 60–79 / Defisit Menengah & Waktu Mepet
          </p>
        </button>

        {/* CRITICAL */}
        <button
          onClick={() => setFilterRisk(filterRisk === 'CRITICAL' ? 'ALL' : 'CRITICAL')}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            filterRisk === 'CRITICAL'
              ? 'border-red-500 bg-red-50 ring-1 ring-red-500'
              : 'border-slate-200 bg-white hover:border-red-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <RiskBadge level="CRITICAL" size="sm" />
            <span className="text-xl font-bold font-mono text-red-800 tabular-nums">
              {riskCounts.critical}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Skor 80–100 / Defisit &gt;50% atau Mulai 1-3 Hari!
          </p>
        </button>
      </div>

      {/* Tabs & Filter Bar */}
      <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Two Separate Views Tab (Requirement 6) */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('or')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'or'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Ringkasan Penilaian per OR ({filteredOrSummaries.length})
          </button>
          <button
            onClick={() => setActiveTab('material')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'material'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Detail Penilaian per Material ({filteredMaterialAssessments.length})
          </button>
        </div>

        {/* OR Filter & Reset */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-slate-600">Filter OR:</span>
          <select
            value={filterOr}
            onChange={(e) => setFilterOr(e.target.value)}
            className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">Semua Nomor OR</option>
            {uniqueOrs.map((or) => (
              <option key={or} value={or}>
                {or}
              </option>
            ))}
          </select>

          {(filterRisk !== 'ALL' || filterOr !== 'ALL') && (
            <button
              onClick={() => {
                setFilterRisk('ALL');
                setFilterOr('ALL');
              }}
              className="text-xs text-blue-600 font-semibold hover:underline ml-2"
            >
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: PENILAIAN PER OR */}
      {activeTab === 'or' && (
        <div className="space-y-4">
          {filteredOrSummaries.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-lg border border-slate-200 text-slate-500 text-xs">
              Tidak ada data penilaian risiko untuk filter yang dipilih.
            </div>
          ) : (
            filteredOrSummaries.map((summary) => {
              const isExpanded = expandedOrNumber === summary.orNumber;
              const isIncomplete = summary.materials.some((m) => !m.isCompleteData);

              return (
                <div
                  key={`${summary.orNumber}-${summary.productionDate}-${summary.productionLine}`}
                  className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden transition-all"
                >
                  {/* Summary Card Header */}
                  <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                        <Hash className="w-5 h-5" />
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-sm text-slate-900">
                            {summary.orNumber}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="text-xs font-semibold text-slate-700">
                            {summary.style}
                          </span>

                          {summary.productionLine && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              {summary.productionLine}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          {summary.hasSchedule ? (
                            <>
                              <span>
                                Tgl Produksi: <strong className="text-slate-800 font-mono">{summary.productionDate}</strong>
                              </span>
                              <span>
                                Komponen Material: <strong className="text-slate-800 font-mono">{summary.materials.length} Item</strong>
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                              <AlertCircle className="w-3.5 h-3.5" />
                              Material belum memiliki jadwal sehingga tidak ada penilaian risiko final
                            </span>
                          )}

                          {isIncomplete && (
                            <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Data belum lengkap
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right side: Overall Risk Score & Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between lg:justify-end gap-4 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                      <div className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-slate-500">Penilaian Risiko OR:</span>
                          <RiskBadge
                            level={summary.highestRiskCategory}
                            score={summary.hasSchedule ? summary.highestRiskScore : undefined}
                            size="md"
                          />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {summary.readyMaterialsCount} dari {summary.totalMaterials} material READY (100%)
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedOrNumber(isExpanded ? null : summary.orNumber)}
                          className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors flex items-center gap-1"
                        >
                          {isExpanded ? (
                            <>Tutup Rincian <ChevronUp className="w-3.5 h-3.5" /></>
                          ) : (
                            <>Lihat {summary.materials.length} Material <ChevronDown className="w-3.5 h-3.5" /></>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expandable Material Table for this OR */}
                  {isExpanded && (
                    <div className="px-5 py-4 bg-slate-50 border-t border-slate-200">
                      <div className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">
                        Rincian Perhitungan Formula Risiko Material ({summary.orNumber})
                      </div>

                      <div className="overflow-x-auto bg-white rounded border border-slate-200">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                              <th className="py-2.5 px-3">Status Risiko</th>
                              <th className="py-2.5 px-3">Kode & Nama Material</th>
                              <th className="py-2.5 px-3 text-right">Kebutuhan</th>
                              <th className="py-2.5 px-3 text-right">Diterima</th>
                              <th className="py-2.5 px-3 text-right">Rasio Kurang</th>
                              <th className="py-2.5 px-3 text-center">Skor Kurang</th>
                              <th className="py-2.5 px-3 text-center">H-Hari</th>
                              <th className="py-2.5 px-3 text-center">Skor Urgensi</th>
                              <th className="py-2.5 px-3 text-center">Total Skor</th>
                              <th className="py-2.5 px-3">Rekomendasi Tindakan PPIC</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {summary.materials.map((mat) => (
                              <tr key={mat.id} className="hover:bg-slate-50/70">
                                <td className="py-2.5 px-3">
                                  <RiskBadge level={mat.riskCategory} size="sm" />
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-mono font-bold text-slate-900">{mat.materialCode}</div>
                                  <div className="text-[11px] text-slate-600">{mat.materialName}</div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                                  {mat.requiredQty.toLocaleString('id-ID')} {mat.unit}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                                  {mat.receivedQty.toLocaleString('id-ID')} {mat.unit}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold">
                                  {mat.shortageRatio === 0 ? (
                                    <span className="text-emerald-600">0% (Lengkap)</span>
                                  ) : (
                                    <span className="text-red-600">{mat.shortageRatio}%</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800">
                                  {mat.shortageScore}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono text-slate-700">
                                  {mat.hasSchedule ? `${mat.daysToProduction} Hari` : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800">
                                  {mat.hasSchedule ? mat.urgencyScore : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-blue-700 bg-blue-50/50">
                                  {mat.hasSchedule ? `${mat.riskScore}/100` : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-[11px] text-slate-600 max-w-xs">
                                  {mat.recommendedAction}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW 2: PENILAIAN PER MATERIAL */}
      {activeTab === 'material' && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                Matriks Penilaian Risiko Dinamis ({filteredMaterialAssessments.length} Material)
              </h3>
            </div>
            <div className="text-xs text-slate-500">
              Evaluasi deterministik berdasar tanggal jadwal riil
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-3 px-3.5">Kategori Risiko</th>
                  <th className="py-3 px-3.5">Nomor OR & Style</th>
                  <th className="py-3 px-3.5">Kode & Nama Material</th>
                  <th className="py-3 px-3 text-right">Kebutuhan</th>
                  <th className="py-3 px-3 text-right">Diterima</th>
                  <th className="py-3 px-3 text-right">Rasio Kurang</th>
                  <th className="py-3 px-3 text-center">Skor Defisit</th>
                  <th className="py-3 px-3 text-center">Tgl Produksi / H-Hari</th>
                  <th className="py-3 px-3 text-center">Skor Urgensi</th>
                  <th className="py-3 px-3 text-center bg-blue-50/40">Risk Score</th>
                  <th className="py-3 px-3.5">Rekomendasi Tindakan PPIC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMaterialAssessments.map((item, idx) => {
                  const isCritical = item.riskCategory === 'CRITICAL';
                  const isHigh = item.riskCategory === 'HIGH';

                  return (
                    <tr
                      key={`${item.orNumber}-${item.materialCode}-${idx}`}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isCritical ? 'bg-red-50/30' : isHigh ? 'bg-orange-50/20' : ''
                      }`}
                    >
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <RiskBadge level={item.riskCategory} size="sm" />
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-slate-900">{item.orNumber}</div>
                        <div className="text-[11px] text-slate-600 truncate max-w-44">{item.style}</div>
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-slate-900">{item.materialCode}</div>
                        <div className="text-[11px] text-slate-700">{item.materialName}</div>
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-800">
                        {item.requiredQty.toLocaleString('id-ID')} {item.unit}
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-800">
                        {item.receivedQty.toLocaleString('id-ID')} {item.unit}
                      </td>

                      <td
                        className={`py-3 px-3 text-right font-mono font-bold ${
                          item.shortageRatio === 0
                            ? 'text-emerald-700'
                            : item.shortageRatio > 50
                            ? 'text-red-600'
                            : 'text-amber-600'
                        }`}
                      >
                        {item.shortageRatio}%
                      </td>

                      <td className="py-3 px-3 text-center font-mono font-bold text-slate-800">
                        {item.shortageScore}
                      </td>

                      <td className="py-3 px-3 text-center font-mono text-slate-700">
                        {item.hasSchedule ? (
                          <div>
                            <div className="font-bold text-[11px]">{item.productionDate}</div>
                            <div className="text-[10px] text-slate-500">
                              {item.daysToProduction > 0
                                ? `H-${item.daysToProduction} Hari`
                                : item.daysToProduction === 0
                                ? 'HARI INI'
                                : `Lewat ${Math.abs(item.daysToProduction)} Hari`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-amber-700 font-semibold text-[10px]">
                            Belum Terjadwal
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-center font-mono font-bold text-slate-800">
                        {item.hasSchedule ? item.urgencyScore : '-'}
                      </td>

                      <td className="py-3 px-3 text-center font-mono font-bold text-blue-700 bg-blue-50/50">
                        {item.hasSchedule ? (
                          <div>
                            <span className="text-sm">{item.riskScore}</span>
                            <span className="text-[10px] text-slate-400 block font-normal">/100</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>

                      <td className="py-3 px-3.5 max-w-xs text-[11px] text-slate-700 leading-snug">
                        {item.recommendedAction}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
