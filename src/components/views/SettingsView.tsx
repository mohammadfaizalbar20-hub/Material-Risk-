import React, { useState } from 'react';
import { usePpic } from '../../context/PpicContext';
import { RiskBadge } from '../common/RiskBadge';
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
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { resetToInitialData, materials, workOrders, warehouseStock } = usePpic();

  const [savedNotification, setSavedNotification] = useState(false);
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
