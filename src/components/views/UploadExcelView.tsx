import React, { useState } from 'react';
import { usePpic } from '../../context/PpicContext';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Database,
  FileCheck,
  RefreshCw,
  Hash,
  Tag,
  Link as LinkIcon,
  Sparkles,
  Info,
  Calendar,
  History,
  Clock,
  Layers,
} from 'lucide-react';
import { parseExcelRowsToMaterials } from '../../utils/excelMaterialParser';

export const UploadExcelView: React.FC = () => {
  const {
    materials,
    registeredOrNumbers,
    searchRegisteredOrs,
    uploadHistory,
    orStyleRelations,
    saveOrStyleRelation,
    getStyleForOr,
    getOrsForStyle,
    autoSaveExcelMaterials,
    setActiveMenu,
    lastImportedInfo,
  } = usePpic();

  // Helper: Default today's date in Western Indonesia Time (WIB / Asia/Jakarta)
  const getTodayWib = () => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  };

  // Mandatory Tanggal Update field (Default: WIB today)
  const [updateDate, setUpdateDate] = useState<string>(getTodayWib());

  // Two inputs: Nomor OR and Style (Integrated with Single Source of Truth)
  const [orNumber, setOrNumber] = useState<string>('');
  const [style, setStyle] = useState<string>('');
  const [multipleOrOptions, setMultipleOrOptions] = useState<string[]>([]);
  const [orInputFeedback, setOrInputFeedback] = useState<string | null>(null);

  // File upload state
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Handle changes to OR Number with auto-fill for Style
  const handleOrChange = (value: string) => {
    setOrNumber(value);
    setMultipleOrOptions([]);
    setErrorMessage(null);
    const clean = value.trim().toUpperCase();
    if (!clean) {
      setOrInputFeedback(null);
      return;
    }

    const matchedStyle = getStyleForOr(clean);
    if (matchedStyle) {
      setStyle(matchedStyle);
      setOrInputFeedback(`Style otomatis terisi: "${matchedStyle}" berdasarkan riwayat OR.`);
    } else {
      setOrInputFeedback('Nomor OR baru (belum ada riwayat Style).');
    }
  };

  // Handle changes to Style with auto-fill for OR Number
  const handleStyleChange = (value: string) => {
    setStyle(value);
    setErrorMessage(null);
    const clean = value.trim();
    if (!clean) {
      setMultipleOrOptions([]);
      setOrInputFeedback(null);
      return;
    }

    const matchedOrs = getOrsForStyle(clean);
    if (matchedOrs.length === 1) {
      setOrNumber(matchedOrs[0]);
      setMultipleOrOptions([]);
      setOrInputFeedback(`Nomor OR otomatis terisi: "${matchedOrs[0]}" (1 kecocokan).`);
    } else if (matchedOrs.length > 1) {
      setMultipleOrOptions(matchedOrs);
      setOrInputFeedback(`Ditemukan ${matchedOrs.length} Nomor OR untuk style "${clean}". Silakan pilih.`);
    } else {
      setMultipleOrOptions([]);
      setOrInputFeedback('Style baru (belum ada riwayat OR terkait).');
    }
  };

  const selectSuggestedOr = (selectedOr: string) => {
    setOrNumber(selectedOr);
    setMultipleOrOptions([]);
    const matchedStyle = getStyleForOr(selectedOr);
    if (matchedStyle) setStyle(matchedStyle);
    setOrInputFeedback(`Nomor OR "${selectedOr}" dipilih untuk style "${matchedStyle || style}".`);
  };

  // Immediate, fully automated Excel parsing & auto-storage into Master Data Material
  const handleFileUpload = (file: File) => {
    setErrorMessage(null);

    // Validation: Tanggal Update is mandatory
    if (!updateDate) {
      setErrorMessage('Tanggal Update wajib diisi sebelum file Excel diproses dan disimpan!');
      return;
    }

    setFileName(file.name);
    setIsProcessing(true);
    setStatusMessage('Membaca berkas Excel dan memproses kolom material...');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result;
        const workbook = XLSX.read(buffer, { type: 'binary' });

        const sheetName = workbook.SheetNames[0];
        const rawJson: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (!rawJson || rawJson.length === 0) {
          setErrorMessage('Berkas Excel kosong atau tidak memiliki baris data.');
          setIsProcessing(false);
          return;
        }

        // Automatic parsing with full support for:
        // - Order Lines/Product/Display Name
        // - Order Lines/Quantity
        // - Order Lines/Received Qty
        // - Order Lines/Product Unit of Measure/Display Name
        // - Master Data Material reference matching
        // - Tanggal Update tagging
        const result = parseExcelRowsToMaterials(rawJson, materials, orNumber, style, updateDate);

        // Immediate automatic storage into Master Data Material with date and upload history
        autoSaveExcelMaterials({
          newRequirements: result.requirements,
          newMasterMaterials: result.newMasterMaterials,
          newRelations: result.relations,
          updateDate: updateDate,
          fileName: file.name,
        });

        setIsProcessing(false);
        setStatusMessage(
          `Sukses! ${result.summary.validRows} baris material berhasil dibaca dan otomatis disimpan ke Master Data Material (Tanggal Update: ${updateDate}). Mengarahkan...`
        );
      } catch (err: any) {
        console.error(err);
        setIsProcessing(false);
        setErrorMessage(`Gagal membaca file Excel: ${err.message || 'Format tidak valid'}`);
      }
    };
    reader.readAsBinaryString(file);
  };

  // 1-Click Load Realistic Sample Excel Data directly into Master Data Material
  const loadRealisticSampleExcel = () => {
    setErrorMessage(null);
    if (!updateDate) {
      setErrorMessage('Tanggal Update wajib diisi sebelum memuat data!');
      return;
    }

    const targetOr = orNumber.trim().toUpperCase() || 'OR-2026-088';
    const targetStyle = style.trim() || getStyleForOr(targetOr) || 'Casual Daily Bomber Jacket Navy';
    setOrNumber(targetOr);
    setStyle(targetStyle);
    setFileName('PPIC_Order_Lines_Odoo_ERP.xlsx');
    setIsProcessing(true);
    setStatusMessage('Memuat dataset Excel realistis ERP (Order Lines)...');

    const sampleRows = [
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[FAB-TASLAN-NVY] Fabric Taslan Waterproof Navy 210T',
        'Order Lines/Quantity': 2500,
        'Order Lines/Received Qty': 1400,
        'Order Lines/Product Unit of Measure/Display Name': 'Yard',
        'Supplier': 'PT Kahatex Textile',
        'Harga Satuan (IDR)': 42000,
      },
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[ZIP-YKK-MET5] Zipper Metal Antique Silver YKK #5 65cm',
        'Order Lines/Quantity': 1000,
        'Order Lines/Received Qty': 600,
        'Order Lines/Product Unit of Measure/Display Name': 'Pcs',
        'Supplier': 'PT YKK Zipper Indonesia',
        'Harga Satuan (IDR)': 18500,
      },
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[RIB-POLY-NVY] Rib Spun Polyester 2x2 Navy',
        'Order Lines/Quantity': 300,
        'Order Lines/Received Qty': 300,
        'Order Lines/Product Unit of Measure/Display Name': 'Kg',
        'Supplier': 'PT Tri Bintang Rib',
        'Harga Satuan (IDR)': 65000,
      },
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[LIN-QUILT-BLK] Lining Quilting Dacron 4oz Black Diamond',
        'Order Lines/Quantity': 1800,
        'Order Lines/Received Qty': 1750,
        'Order Lines/Product Unit of Measure/Display Name': 'Yard',
        'Supplier': 'PT Sinar Mulia Lining',
        'Harga Satuan (IDR)': 28000,
      },
    ];

    setTimeout(() => {
      const result = parseExcelRowsToMaterials(sampleRows, materials, targetOr, targetStyle, updateDate);
      autoSaveExcelMaterials({
        newRequirements: result.requirements,
        newMasterMaterials: result.newMasterMaterials,
        newRelations: result.relations,
        updateDate: updateDate,
        fileName: 'PPIC_Order_Lines_Odoo_ERP.xlsx',
      });
      setIsProcessing(false);
      setStatusMessage(`Berhasil memuat ${result.summary.validRows} baris material contoh ke Master Data Material.`);
    }, 400);
  };

  // Save relation only button
  const handleSaveOnlyRelation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orNumber.trim() || !style.trim()) {
      setErrorMessage('Silakan lengkapi Nomor OR dan Style sebelum menyimpan relasi.');
      return;
    }
    saveOrStyleRelation(orNumber.trim().toUpperCase(), style.trim());
    setStatusMessage(`Hubungan Nomor OR "${orNumber.toUpperCase()}" dan Style "${style}" berhasil disimpan!`);
  };

  // Download official template file (.xlsx) with exact required column names
  const handleDownloadBlankTemplate = () => {
    const wb = XLSX.utils.book_new();
    const templateData = [
      {
        'Tanggal Update': updateDate,
        'Order Reference': 'OR-2026-001',
        'Style': 'Bomber Jacket Taslan Navy (BJ-01)',
        'Order Lines/Product/Display Name': '[FAB-TASLAN-NVY] Fabric Taslan Waterproof Navy 210T',
        'Order Lines/Quantity': 2500,
        'Order Lines/Received Qty': 1200,
        'Order Lines/Product Unit of Measure/Display Name': 'Yard',
      },
      {
        'Tanggal Update': updateDate,
        'Order Reference': 'OR-2026-001',
        'Style': 'Bomber Jacket Taslan Navy (BJ-01)',
        'Order Lines/Product/Display Name': '[ZIP-YKK-MET5] Zipper Metal Antique Silver YKK #5 65cm',
        'Order Lines/Quantity': 1000,
        'Order Lines/Received Qty': 450,
        'Order Lines/Product Unit of Measure/Display Name': 'Pcs',
      },
      {
        'Tanggal Update': updateDate,
        'Order Reference': 'OR-2026-002',
        'Style': 'Polo Shirt DryFit Performance White (PS-02)',
        'Order Lines/Product/Display Name': '[FAB-DRYFIT-WHT] Fabric Micro DryFit Pique UV-Shield White',
        'Order Lines/Quantity': 1200,
        'Order Lines/Received Qty': 400,
        'Order Lines/Product Unit of Measure/Display Name': 'Kg',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Order_Lines');
    XLSX.writeFile(wb, 'PPIC_Template_Order_Lines.xlsx');
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="p-5 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Upload Excel & Pencatatan Perkembangan Tanggal Harian
          </div>
          <h2 className="text-base md:text-lg font-bold text-slate-900">
            Unggah Berkas Excel Kebutuhan Material & Manajemen Tanggal Update
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Seluruh data Nomor OR yang dimasukkan di sini menjadi <strong>sumber data utama (single source of truth)</strong> untuk seluruh fitur pencarian OR di aplikasi, dilengkapi dengan <strong>Tanggal Update</strong> untuk pelacakan perkembangan material harian.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownloadBlankTemplate}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Unduh Template Excel ERP
          </button>
          <button
            onClick={() => setActiveMenu('Rekap Material')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            Buka Master Data Material
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Error alert banner */}
      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-300 text-red-900 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span className="font-semibold">{errorMessage}</span>
        </div>
      )}

      {/* SECTION 1: Tanggal Update, Nomor OR & Style Mapping Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                1. Parameter Upload: Tanggal Update & Relasi OR - Style
              </h3>
              <p className="text-[11px] text-slate-500">
                Nomor OR yang dimasukkan akan otomatis menjadi Single Source of Truth bagi seluruh fitur Search OR di sistem.
              </p>
            </div>
          </div>
          <span className="text-[11px] px-2.5 py-1 bg-blue-50 text-blue-700 font-semibold rounded-full border border-blue-200">
            {registeredOrNumbers.length} Nomor OR Terdaftar
          </span>
        </div>

        <form onSubmit={handleSaveOnlyRelation} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Input 1: TANGGAL UPDATE (Wajib) */}
            <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-lg">
              <label className="block text-xs font-bold text-blue-950 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-600" />
                  Tanggal Update *
                </span>
                <span className="text-[10px] font-normal text-blue-700 bg-blue-100 px-1.5 py-0.2 rounded font-mono">
                  WIB (Jakarta)
                </span>
              </label>
              <input
                type="date"
                required
                value={updateDate}
                onChange={(e) => {
                  setUpdateDate(e.target.value);
                  setErrorMessage(null);
                }}
                className="w-full px-3 py-2 text-xs border border-blue-300 rounded-md font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-slate-900"
              />
              <p className="text-[10px] text-blue-800 mt-1">
                Data material akan dikelompokkan pada tanggal ini untuk melacak perkembangan harian.
              </p>
            </div>

            {/* Input 2: Nomor OR (Searchable from Single Source of Truth) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-blue-600" />
                Nomor OR
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="registeredOrDatalist"
                  value={orNumber}
                  onChange={(e) => handleOrChange(e.target.value)}
                  placeholder="Ketik / pilih OR (Contoh: OR-2026-001)"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase bg-white font-medium"
                />
                <datalist id="registeredOrDatalist">
                  {registeredOrNumbers.map((or) => (
                    <option key={or} value={or}>
                      {getStyleForOr(or) ? `${or} (${getStyleForOr(or)})` : or}
                    </option>
                  ))}
                </datalist>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Mendukung pencarian sebagian teks. OR yang dipilih otomatis mengisi Style.
              </p>
            </div>

            {/* Input 3: Style */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-blue-600" />
                Style
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={style}
                  onChange={(e) => handleStyleChange(e.target.value)}
                  placeholder="Contoh: Bomber Jacket Taslan Navy"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Ketik Style untuk mencari Nomor OR terkait secara dua arah.
              </p>
            </div>
          </div>

          {/* Feedback indicator */}
          {orInputFeedback && (
            <div className="p-2.5 rounded bg-blue-50/70 border border-blue-200/80 text-xs text-blue-800 flex items-center justify-between">
              <span className="font-medium">{orInputFeedback}</span>
              <button
                type="submit"
                className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline ml-2 cursor-pointer"
              >
                Simpan Hubungan Pasangan Ini
              </button>
            </div>
          )}

          {/* Multiple Matches Choices */}
          {multipleOrOptions.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                Ditemukan beberapa Nomor OR untuk Style &quot;{style}&quot;. Pilih salah satu:
              </div>
              <div className="flex flex-wrap gap-2">
                {multipleOrOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => selectSuggestedOr(opt)}
                    className="px-2.5 py-1 text-xs font-mono font-medium bg-white hover:bg-amber-100 border border-amber-300 rounded text-slate-800 transition-colors shadow-2xs cursor-pointer"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Select from Single Source of Truth Registered ORs */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 font-medium mr-1 flex items-center gap-1">
              <Hash className="w-3 h-3 text-slate-400" />
              Pilihan Cepat OR Terdaftar:
            </span>
            {registeredOrNumbers.slice(0, 8).map((regOr) => (
              <button
                key={regOr}
                type="button"
                onClick={() => {
                  setOrNumber(regOr);
                  const st = getStyleForOr(regOr);
                  if (st) setStyle(st);
                  setMultipleOrOptions([]);
                  setOrInputFeedback(`Dipilih: ${regOr} ${st ? `- ${st}` : ''}`);
                }}
                className={`text-[11px] px-2 py-0.5 rounded border transition-colors cursor-pointer font-mono ${
                  orNumber === regOr
                    ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {regOr}
              </button>
            ))}
          </div>
        </form>
      </div>

      {/* SECTION 2: Upload Drop Zone & Fast Demo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dropzone Column */}
        <div className="lg:col-span-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileUpload(e.dataTransfer.files[0]);
              }
            }}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all bg-white relative ${
              dragActive
                ? 'border-blue-500 bg-blue-50/50'
                : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            <div className="max-w-md mx-auto space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center mx-auto">
                <Upload className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                2. Tarik & Lepas File Excel di Sini
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Mendukung .xlsx, .xls, atau .csv. Data otomatis disimpan ke <strong>Master Data Material</strong> dengan Tanggal Update: <strong className="text-blue-700">{updateDate}</strong> tanpa perlu koreksi manual.
              </p>

              <div className="pt-2 flex items-center justify-center gap-3">
                <label className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-md shadow-xs cursor-pointer transition-colors inline-flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  {isProcessing ? 'Memproses Berkas...' : 'Pilih File Excel dari Komputer'}
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    className="hidden"
                    disabled={isProcessing}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                  />
                </label>
              </div>

              {fileName && (
                <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800 font-medium inline-flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4 text-blue-600" />
                  Berkas Terakhir: <strong>{fileName}</strong>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Demo Helper Column */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-2">
              <Database className="w-4 h-4 text-blue-600" />
              Simulasi Data Excel ERP (1-Klik)
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Uji langsung alur pembacaan dan pencatatan tanggal harian menggunakan sampel riil struktur kolom <code>Order Lines</code> Odoo ERP.
            </p>

            <div className="mt-4 p-3 bg-slate-50 rounded border border-slate-100 text-[11px] text-slate-600 space-y-1.5">
              <div className="font-semibold text-slate-800">Detail Simulasi:</div>
              <div>• Tanggal Update Aktif: <strong className="font-mono text-blue-700">{updateDate}</strong></div>
              <div>• Kolom: <code>Order Lines/Product/Display Name</code></div>
              <div>• Kolom: <code>Order Lines/Quantity</code> & <code>Received Qty</code></div>
              <div>• Disimpan ke Riwayat Update & Master Data</div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <button
              onClick={loadRealisticSampleExcel}
              disabled={isProcessing}
              className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-md shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isProcessing ? 'animate-spin' : ''}`} />
              Muat & Simpan Otomatis Sampel ERP
            </button>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{statusMessage}</span>
          </div>
          <button
            onClick={() => setActiveMenu('Rekap Material')}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs rounded shadow-xs transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            Buka Master Data Material <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SECTION 3: RIWAYAT UPDATE (UPLOAD HISTORY) - Required Specification */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                Riwayat Update & Log Pengunggahan File Excel ({uploadHistory.length} Proses Tercatat)
              </h3>
              <p className="text-[11px] text-slate-500">
                Setiap proses upload tercatat permanen dengan Tanggal Update, waktu upload, OR, file, dan status.
              </p>
            </div>
          </div>

          <div className="text-[11px] text-slate-500">
            Riwayat tidak ditimpa saat ada upload baru
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/70 text-slate-700 font-semibold border-b border-slate-200">
                <th className="py-2.5 px-3.5">Tanggal Update</th>
                <th className="py-2.5 px-3">Waktu Upload</th>
                <th className="py-2.5 px-3.5">Nomor OR</th>
                <th className="py-2.5 px-3.5">Style Terkait</th>
                <th className="py-2.5 px-3.5">Nama File Excel</th>
                <th className="py-2.5 px-3 text-right">Jumlah Baris</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {uploadHistory.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                    Belum ada riwayat proses upload. Silakan unggah berkas Excel.
                  </td>
                </tr>
              ) : (
                uploadHistory.map((hist) => (
                  <tr key={hist.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3.5 font-mono font-bold text-blue-700 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded">
                        <Calendar className="w-3 h-3 text-blue-600" />
                        {hist.updateDate}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                      {hist.uploadTime}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {hist.orNumber}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-700 max-w-[200px] truncate">
                      {hist.style}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono text-slate-600 text-[11px] max-w-[180px] truncate">
                      {hist.fileName}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                      {hist.rowCount} Baris
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                        {hist.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                      <button
                        onClick={() => setActiveMenu('Rekap Material')}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline cursor-pointer"
                      >
                        Buka di Master Data
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
