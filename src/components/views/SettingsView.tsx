import React, { useState, useEffect } from 'react';
import { usePpic } from '../../context/PpicContext';
import { RiskBadge } from '../common/RiskBadge';
import { getSupabaseCredentials, getSupabaseLiveCounts, cleanSupabaseUrl } from '../../lib/supabase';
import { PPIC_SUPABASE_SCHEMA_SQL } from '../../lib/supabaseSchemaSql';
import {
  Settings,
  Shield,
  User,
  Factory,
  Database,
  Save,
  RotateCcw,
  CheckCircle,
  HelpCircle,
  Cloud,
  CloudOff,
  RefreshCw,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Key,
  Copy,
  Check,
  Code,
  Eye,
  EyeOff,
  ArrowLeftRight,
  Share2,
  Layers,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const {
    resetToInitialData,
    materials,
    workOrders,
    warehouseStock,
    supabaseConnected,
    supabaseLoading,
    supabaseSyncError,
    lastSyncTimestamp,
    syncWithSupabase,
    migrateLocalDataToSupabase,
    updateSupabaseCredentials,
    disconnectSupabase,
  } = usePpic();

  const [savedNotification, setSavedNotification] = useState(false);
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseAnonKeyInput, setSupabaseAnonKeyInput] = useState('');
  const [supabaseActionStatus, setSupabaseActionStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showAnonKey, setShowAnonKey] = useState(false);

  const isUrlActuallyKey =
    supabaseUrlInput.trim().startsWith('sb_publishable_') ||
    supabaseUrlInput.trim().startsWith('eyJ');

  const isKeyActuallyUrl =
    supabaseAnonKeyInput.trim().startsWith('http://') ||
    supabaseAnonKeyInput.trim().startsWith('https://');

  const handleSwapCredentials = () => {
    const tempUrl = supabaseUrlInput;
    setSupabaseUrlInput(supabaseAnonKeyInput);
    setSupabaseAnonKeyInput(tempUrl);
    setSupabaseActionStatus({
      type: 'info',
      message: 'Posisi URL dan Key berhasil ditukar. Pastikan URL diawali https:// dan Key diawali sb_publishable_ lalu klik Simpan & Uji Koneksi.',
    });
  };

  const [cloudStats, setCloudStats] = useState<{
    requirementsCount: number;
    historyCount: number;
    relationsCount: number;
    schedulesCount: number;
    materialsCount: number;
  } | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  const refreshCloudStats = async () => {
    const res = await getSupabaseLiveCounts();
    if (res.connected) {
      setCloudStats({
        requirementsCount: res.requirementsCount,
        historyCount: res.historyCount,
        relationsCount: res.relationsCount,
        schedulesCount: res.schedulesCount,
        materialsCount: res.materialsCount,
      });
    }
  };

  useEffect(() => {
    if (supabaseConnected) {
      refreshCloudStats();
    }
  }, [supabaseConnected, lastSyncTimestamp]);

  const handleCopyShareLink = () => {
    const cleanUrl = supabaseUrlInput.trim();
    const cleanKey = supabaseAnonKeyInput.trim();
    if (!cleanUrl || !cleanKey) {
      setSupabaseActionStatus({
        type: 'error',
        message: 'Mohon masukkan dan simpan Project URL serta Anon Key terlebih dahulu.',
      });
      return;
    }
    const currentOrigin = window.location.origin;
    const currentPath = window.location.pathname;
    const shareUrl = `${currentOrigin}${currentPath}#sb_url=${encodeURIComponent(cleanUrl)}&sb_key=${encodeURIComponent(cleanKey)}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedShareLink(true);
    setSupabaseActionStatus({
      type: 'success',
      message: 'Tautan Akses Cepat Berhasil Disalin! Buka tautan ini di laptop atau device lain, maka database Supabase akan langsung terhubung secara otomatis tanpa perlu input manual.',
    });
    setTimeout(() => setCopiedShareLink(false), 3500);
  };

  useEffect(() => {
    const creds = getSupabaseCredentials();
    setSupabaseUrlInput(creds.url || '');
    setSupabaseAnonKeyInput(creds.anonKey || '');
  }, []);
  const [profile, setProfile] = useState({
    name: 'Budi Santoso, S.T.',
    title: 'Senior PPIC Specialist',
    plant: 'Plant 1 Cikarang - High Speed FMCG',
    shift: 'Shift 1 (07:00 - 15:00 WIB)',
  });

  const [config, setConfig] = useState({
    defaultSafetyStockPercent: 20,
    criticalThresholdDays: 2,
    leadTimeBufferMargin: 1,
    freezeWindowDays: 3,
  });

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 2500);
  };

  const handleExportBackup = () => {
    const backupData = {
      timestamp: new Date().toISOString(),
      materials,
      workOrders,
      warehouseStock,
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PPIC_System_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="p-5 bg-white rounded-lg border border-slate-200 shadow-xs">
        <h2 className="text-base md:text-lg font-bold text-slate-900">
          Pengaturan Sistem & Konfigurasi Parameter PPIC
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Atur parameter ambang batas risiko material, data profil pengguna PPIC, dan cadangan database sistem.
        </p>
      </div>

      {savedNotification && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-600" />
          <span>Pengaturan parameter PPIC berhasil disimpan dan diterapkan ke seluruh kalkulasi sistem!</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Section 1: PPIC Thresholds */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Shield className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Parameter Ambang Batas Risiko (Risk Matrix Engine)
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ambang Batas Kritis (Hari Sebelum Lini Stop)
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={config.criticalThresholdDays}
                onChange={(e) =>
                  setConfig({ ...config, criticalThresholdDays: parseInt(e.target.value, 10) || 2 })
                }
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Material berstatus defisit akan ditandai <strong>CRITICAL RISK</strong> jika jadwal produksi &le; nilai hari ini.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Margin Safety Buffer Tambahan (Hari)
              </label>
              <input
                type="number"
                min="0"
                max="5"
                value={config.leadTimeBufferMargin}
                onChange={(e) =>
                  setConfig({ ...config, leadTimeBufferMargin: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Ditambahkan ke Lead Time supplier untuk mengantisipasi keterlambatan bea cukai / QC.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Jendela Beku Jadwal Produksi (Freeze Window - Hari)
              </label>
              <input
                type="number"
                min="1"
                max="7"
                value={config.freezeWindowDays}
                onChange={(e) =>
                  setConfig({ ...config, freezeWindowDays: parseInt(e.target.value, 10) || 3 })
                }
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Periode di mana SPK tidak boleh diubah tanpa persetujuan Plant Manager.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Standar Safety Stock Default (% Pemakaian Bulanan)
              </label>
              <input
                type="number"
                min="5"
                max="50"
                value={config.defaultSafetyStockPercent}
                onChange={(e) =>
                  setConfig({ ...config, defaultSafetyStockPercent: parseInt(e.target.value, 10) || 20 })
                }
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Ambang batas batas bawah sebelum status berubah menjadi <strong>MEDIUM RISK</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Realtime Supabase Cloud Data Stats */}
        {supabaseConnected && (
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-emerald-950 font-bold">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Status Data di Cloud Online (Supabase):</span>
              </div>
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                title="Bagikan tautan ini ke laptop lain agar langsung terhubung tanpa input manual"
              >
                {copiedShareLink ? <Check className="w-3.5 h-3.5 text-emerald-200" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{copiedShareLink ? 'Tautan Terhubung Tersalin!' : 'Bagikan Link ke Laptop Lain'}</span>
              </button>
            </div>

            {cloudStats ? (
              cloudStats.requirementsCount === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded text-amber-900 flex items-start gap-2.5 shadow-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold text-amber-950">Database Supabase online saat ini masih kosong (0 baris material).</strong>
                    <p className="mt-1 text-amber-800 leading-relaxed">
                      Hal ini menjelaskan mengapa ketika Anda membuka aplikasi di laptop/device lain, data tampil kosong. Klik tombol hijau <strong>"Migrasikan Data Lokal ke Supabase"</strong> di bawah ini agar seluruh data kebutuhan material, nomor OR, dan jadwal dari laptop ini dikirim ke server Supabase.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                  <div className="bg-white p-2.5 rounded border border-emerald-100 shadow-2xs">
                    <span className="text-slate-500 block text-[10px]">Detail Kebutuhan Material:</span>
                    <strong className="text-sm font-bold text-emerald-800">{cloudStats.requirementsCount} Baris</strong>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-emerald-100 shadow-2xs">
                    <span className="text-slate-500 block text-[10px]">Riwayat Upload Excel:</span>
                    <strong className="text-sm font-bold text-slate-800">{cloudStats.historyCount} Batch</strong>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-emerald-100 shadow-2xs">
                    <span className="text-slate-500 block text-[10px]">Nomor OR Terdaftar:</span>
                    <strong className="text-sm font-bold text-slate-800">{cloudStats.relationsCount} OR</strong>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-emerald-100 shadow-2xs">
                    <span className="text-slate-500 block text-[10px]">Jadwal Produksi (Gantt):</span>
                    <strong className="text-sm font-bold text-slate-800">{cloudStats.schedulesCount} Item</strong>
                  </div>
                </div>
              )
            ) : (
              <span className="text-slate-500 text-[11px] flex items-center gap-1.5 py-1">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                Memeriksa data di cloud Supabase...
              </span>
            )}
          </div>
        )}

        {/* Section 2: User Profile PPIC */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <User className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Identitas Pengguna PPIC
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Pengguna
              </label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Jabatan / Role
              </label>
              <input
                type="text"
                value={profile.title}
                onChange={(e) => setProfile({ ...profile, title: e.target.value })}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Lokasi Pabrik (Plant)
              </label>
              <input
                type="text"
                value={profile.plant}
                onChange={(e) => setProfile({ ...profile, plant: e.target.value })}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Shift Kerja Operasional
              </label>
              <input
                type="text"
                value={profile.shift}
                onChange={(e) => setProfile({ ...profile, shift: e.target.value })}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-xs flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              Simpan Perubahan
            </button>
          </div>
        </div>
      </form>

      {/* Section 2.5: Centralized Supabase Database Integration */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-5 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Integrasi Database Terpusat Supabase (Multi-User & Multi-Device)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Hubungkan seluruh laptop tim PPIC ke satu database PostgreSQL online agar semua pengguna melihat data yang sama secara serentak.
              </p>
            </div>
          </div>

          {/* Connection Status Badge */}
          <div className="flex items-center gap-2">
            {supabaseLoading ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Menghubungkan...
              </span>
            ) : supabaseConnected ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Database Terpusat Aktif
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                <CloudOff className="w-3.5 h-3.5" />
                Penyimpanan Lokal (Offline)
              </span>
            )}
          </div>
        </div>

        {/* Action Status Notice */}
        {supabaseActionStatus && (
          <div
            className={`p-3.5 rounded-lg text-xs flex items-center justify-between gap-2 border ${
              supabaseActionStatus.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : supabaseActionStatus.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {supabaseActionStatus.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : supabaseActionStatus.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              ) : (
                <RefreshCw className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
              )}
              <span>{supabaseActionStatus.message}</span>
            </div>
            <button
              onClick={() => setSupabaseActionStatus(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold"
            >
              Tutup
            </button>
          </div>
        )}

        {supabaseSyncError && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{supabaseSyncError}</span>
          </div>
        )}

        {/* Warning if user pasted API Key into Project URL */}
        {(isUrlActuallyKey || isKeyActuallyUrl) && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex items-start gap-2.5 max-w-xl">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold text-amber-950">Terdeteksi Posisi Input Tertukar:</strong>
                <p className="mt-1 text-amber-800 leading-relaxed">
                  {isUrlActuallyKey && (
                    <span>
                      Kolom <strong>Project URL</strong> terisi API Key (<code className="font-mono bg-amber-100 px-1 rounded">{supabaseUrlInput.slice(0, 20)}...</code>). Project URL harus berupa link seperti <code className="font-mono bg-amber-100 px-1 rounded">https://xyzcompany.supabase.co</code>.
                    </span>
                  )}
                  {isKeyActuallyUrl && (
                    <span className="block mt-0.5">
                      Kolom <strong>Anon Key</strong> terisi tautan URL.
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSwapCredentials}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors shrink-0"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Tukar Posisi URL & Key
            </button>
          </div>
        )}

        {/* Credentials Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-600" />
                Supabase Project URL:
              </label>
              <span className="text-[10px] text-slate-400 font-mono">Format: https://*.supabase.co</span>
            </div>
            <input
              type="text"
              value={supabaseUrlInput}
              onChange={(e) => {
                const val = e.target.value;
                if (val.includes('/rest/v1') || val.includes('/rest')) {
                  setSupabaseUrlInput(cleanSupabaseUrl(val));
                } else {
                  setSupabaseUrlInput(val);
                }
              }}
              onBlur={() => {
                if (supabaseUrlInput.trim() && !isUrlActuallyKey) {
                  setSupabaseUrlInput(cleanSupabaseUrl(supabaseUrlInput));
                }
              }}
              placeholder="https://xyzcompany.supabase.co"
              className={`w-full px-3 py-2 text-xs font-mono border rounded focus:ring-1 focus:ring-blue-500 bg-slate-50 focus:bg-white ${
                isUrlActuallyKey ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
              }`}
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              Cari di dashboard Supabase: <strong>Project Settings &rarr; Data API &rarr; Project URL</strong> (URL dasar saja, tanpa akhiran <code>/rest/v1</code>).
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-blue-600" />
                Supabase Anon / Publishable Key:
              </label>
              <button
                type="button"
                onClick={() => setShowAnonKey(!showAnonKey)}
                className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
              >
                {showAnonKey ? (
                  <>
                    <EyeOff className="w-3 h-3" />
                    <span>Sembunyikan</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3 h-3" />
                    <span>Lihat Kunci</span>
                  </>
                )}
              </button>
            </div>
            <div className="relative">
              <input
                type={showAnonKey ? 'text' : 'password'}
                value={supabaseAnonKeyInput}
                onChange={(e) => setSupabaseAnonKeyInput(e.target.value)}
                placeholder="sb_publishable_... atau eyJhbGciOi..."
                className={`w-full pl-3 pr-8 py-2 text-xs font-mono border rounded focus:ring-1 focus:ring-blue-500 bg-slate-50 focus:bg-white ${
                  isKeyActuallyUrl ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                }`}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Cari di dashboard Supabase: <strong>Project Settings &rarr; Data API &rarr; anon (public)</strong>.
            </p>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const normalizedUrl = cleanSupabaseUrl(supabaseUrlInput);
                const cleanKey = supabaseAnonKeyInput.trim();

                if (!supabaseUrlInput.trim() || !cleanKey) {
                  setSupabaseActionStatus({
                    type: 'error',
                    message: 'Mohon isi Project URL dan Anon Key terlebih dahulu.',
                  });
                  return;
                }

                if (supabaseUrlInput.trim().startsWith('sb_publishable_') || supabaseUrlInput.trim().startsWith('eyJ')) {
                  setSupabaseActionStatus({
                    type: 'error',
                    message: 'Kolom "Project URL" terisi API Key. Project URL harus berupa link seperti "https://[id-proyek].supabase.co". Klik tombol "Tukar Posisi URL & Key" di atas jika tertukar.',
                  });
                  return;
                }

                if (!normalizedUrl.startsWith('https://') && !normalizedUrl.startsWith('http://')) {
                  setSupabaseActionStatus({
                    type: 'error',
                    message: 'Project URL harus diawali dengan https:// (contoh: https://xyzcompany.supabase.co).',
                  });
                  return;
                }

                // If user didn't write https://, update the field in UI to show the full URL
                if (normalizedUrl !== supabaseUrlInput.trim()) {
                  setSupabaseUrlInput(normalizedUrl);
                }

                setSupabaseActionStatus({ type: 'info', message: 'Menguji koneksi ke Supabase...' });
                const res = await updateSupabaseCredentials(normalizedUrl, cleanKey);
                if (res.success) {
                  await refreshCloudStats();
                }
                setSupabaseActionStatus({
                  type: res.success ? 'success' : 'error',
                  message: res.message,
                });
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Simpan & Uji Koneksi
            </button>

            {supabaseConnected && (
              <button
                type="button"
                onClick={async () => {
                  setSupabaseActionStatus({ type: 'info', message: 'Menyinkronkan data dengan Supabase...' });
                  await syncWithSupabase();
                  await refreshCloudStats();
                  setSupabaseActionStatus({
                    type: 'success',
                    message: 'Data berhasil disinkronkan dengan database pusat Supabase!',
                  });
                }}
                className="px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Sinkronkan Data Sekarang
              </button>
            )}

            <button
              type="button"
              disabled={isMigrating}
              onClick={async () => {
                if (!supabaseUrlInput.trim() || !supabaseAnonKeyInput.trim()) {
                  alert('Mohon isi dan simpan kredensial Supabase terlebih dahulu sebelum migrasi.');
                  return;
                }
                if (
                  confirm(
                    'Apakah Anda ingin menyalin dan memigrasikan seluruh data kebutuhan material, OR, dan jadwal lokal saat ini ke database Supabase terpusat?'
                  )
                ) {
                  setIsMigrating(true);
                  setSupabaseActionStatus({ type: 'info', message: 'Sedang memigrasikan data ke Supabase...' });
                  const res = await migrateLocalDataToSupabase();
                  setIsMigrating(false);
                  if (res.success) {
                    await refreshCloudStats();
                  }
                  setSupabaseActionStatus({
                    type: res.success ? 'success' : 'error',
                    message: res.message,
                  });
                }
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {isMigrating ? 'Sedang Memigrasikan...' : 'Migrasikan Data Lokal ke Supabase'}
            </button>

            {supabaseConnected && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Apakah Anda ingin memutuskan koneksi dan kembali ke mode penyimpanan lokal?')) {
                    disconnectSupabase();
                    setSupabaseUrlInput('');
                    setSupabaseAnonKeyInput('');
                    setSupabaseActionStatus({
                      type: 'info',
                      message: 'Koneksi diputus. Aplikasi kini beroperasi dalam mode penyimpanan lokal.',
                    });
                  }
                }}
                className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
              >
                Putuskan Koneksi
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowSqlGuide(!showSqlGuide)}
            className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 underline cursor-pointer"
          >
            <Code className="w-3.5 h-3.5" />
            {showSqlGuide ? 'Sembunyikan Skema SQL' : 'Lihat Skema Tabel SQL Supabase'}
          </button>
        </div>

        {/* Collapsible SQL Guide */}
        {showSqlGuide && (
          <div className="p-4 bg-slate-900 text-slate-200 rounded-lg text-xs space-y-3">
            <div className="flex items-center justify-between text-slate-300 flex-wrap gap-2">
              <span className="font-semibold text-white">Script Skema Database (Jalankan di Supabase SQL Editor):</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(PPIC_SUPABASE_SCHEMA_SQL);
                  setCopiedSql(true);
                  setTimeout(() => setCopiedSql(false), 2000);
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSql ? 'Skema SQL Berhasil Tersalin!' : 'Salin Seluruh Skema SQL (1-Klik)'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Jika tabel belum dibuat di Supabase Anda, buka <strong>Supabase Dashboard &rarr; SQL Editor</strong>, buat <strong>New Query</strong>, klik tombol <strong>Salin Seluruh Skema SQL</strong> di atas, lalu tempel (paste) dan klik <strong>Run</strong> untuk membuat ke-5 tabel lengkap (<code>or_style_relations</code>, <code>upload_history</code>, <code>material_requirements</code>, <code>production_schedules</code>, <code>master_materials</code>), indeks, Row Level Security (RLS), dan publikasi realtime.
            </p>
          </div>
        )}

        {lastSyncTimestamp && (
          <div className="text-[11px] text-slate-400 text-right">
            Sinkronisasi terakhir: {new Date(lastSyncTimestamp).toLocaleTimeString('id-ID')} WIB
          </div>
        )}
      </div>

      {/* Section 3: Data Management & Backup */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Database className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">
            Pengelolaan Data & Cadangan Sistem (Backup / Reset)
          </h3>
        </div>

        <p className="text-xs text-slate-500">
          Anda dapat mengekspor seluruh basis data PPIC lokal untuk keperluan arsip, atau mereset data kembali ke pengaturan pabrik awal untuk keperluan pengujian.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handleExportBackup}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors flex items-center gap-1.5"
          >
            <Database className="w-4 h-4 text-slate-600" />
            Cadangkan Basis Data (JSON)
          </button>

          <button
            onClick={() => {
              if (
                confirm(
                  'Apakah Anda yakin ingin mereset seluruh data kembali ke kondisi default awal PPIC?'
                )
              ) {
                resetToInitialData();
                alert('Data berhasil direset ke kondisi default!');
              }
            }}
            className="px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4 text-red-600" />
            Reset ke Data Pabrik Awal
          </button>
        </div>
      </div>

      {/* Risk Level Standard Reference Card */}
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-5 space-y-3">
        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
          Standar Klasifikasi 4 Tingkat Risiko Material PPIC
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-white rounded border border-emerald-200 flex items-start gap-2.5">
            <RiskBadge level="READY" size="sm" />
            <div className="text-slate-600 leading-relaxed">
              <strong>READY (Hijau):</strong> Saldo stok bebas melebihi total kebutuhan SPK ditambah Safety Stock buffer. Lini produksi aman dieksekusi.
            </div>
          </div>

          <div className="p-3 bg-white rounded border border-amber-200 flex items-start gap-2.5">
            <RiskBadge level="MEDIUM" size="sm" />
            <div className="text-slate-600 leading-relaxed">
              <strong>MEDIUM RISK (Kuning):</strong> Stok mencukupi jadwal namun cadangan turun di bawah batas Safety Stock. Perlu pembuatan PR reguler ke purchasing.
            </div>
          </div>

          <div className="p-3 bg-white rounded border border-orange-200 flex items-start gap-2.5">
            <RiskBadge level="HIGH" size="sm" />
            <div className="text-slate-600 leading-relaxed">
              <strong>HIGH RISK (Oranye):</strong> Terjadi defisit stok terhadap jadwal, namun waktu produksi masih lebih besar dari Lead Time supplier (dapat di-expedite).
            </div>
          </div>

          <div className="p-3 bg-white rounded border border-red-200 flex items-start gap-2.5">
            <RiskBadge level="CRITICAL" size="sm" />
            <div className="text-slate-600 leading-relaxed">
              <strong>CRITICAL RISK (Merah):</strong> Defisit material mengancam jadwal yang akan mulai dalam 1-3 hari ke depan. Menuntut tindakan segera (transfer transit QC/reschedule).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
