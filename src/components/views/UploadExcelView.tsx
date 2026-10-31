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
} from 'lucide-react';
import { parseExcelRowsToMaterials } from '../../utils/excelMaterialParser';

export const UploadExcelView: React.FC = () => {
  const {
    materials,
    warehouseStock,
    productionSchedules,
    orStyleRelations,
    saveOrStyleRelation,
    getStyleForOr,
    getOrsForStyle,
    autoSaveExcelMaterials,
    setActiveMenu,
    lastImportedInfo,
  } = usePpic();

  // Two inputs: Nomor OR and Style (with 2-way relation intelligence)
  const [orNumber, setOrNumber] = useState<string>('');
  const [style, setStyle] = useState<string>('');
  const [multipleOrOptions, setMultipleOrOptions] = useState<string[]>([]);
  const [orInputFeedback, setOrInputFeedback] = useState<string | null>(null);

  // File upload state
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Handle changes to OR Number with auto-fill for Style
  const handleOrChange = (value: string) => {
    setOrNumber(value);
    setMultipleOrOptions([]);
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
    setOrInputFeedback(`Nomor OR "${selectedOr}" dipilih untuk style "${style}".`);
  };

  // Immediate, fully automated Excel parsing & auto-storage into Master Data Material
  const handleFileUpload = (file: File) => {
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
          setStatusMessage('Berkas Excel kosong atau tidak memiliki baris data.');
          setIsProcessing(false);
          return;
        }

        // Automatic parsing with full support for:
        // - Order Lines/Product/Display Name
        // - Order Lines/Quantity
        // - Order Lines/Received Qty
        // - Order Lines/Product Unit of Measure/Display Name
        // - Master Data Material reference matching
        const result = parseExcelRowsToMaterials(rawJson, materials, orNumber, style);

        // Immediate automatic storage into Master Data Material
        // No manual confirmation or revision required!
        autoSaveExcelMaterials({
          newRequirements: result.requirements,
          newMasterMaterials: result.newMasterMaterials,
          newRelations: result.relations,
        });

        setIsProcessing(false);
        setStatusMessage(
          `Sukses! ${result.summary.validRows} baris material berhasil dibaca dan otomatis disimpan ke Master Data Material. Mengarahkan...`
        );
      } catch (err: any) {
        console.error(err);
        setIsProcessing(false);
        setStatusMessage(`Gagal membaca file Excel: ${err.message || 'Format tidak valid'}`);
      }
    };
    reader.readAsBinaryString(file);
  };

  // 1-Click Load Realistic Sample Excel Data directly into Master Data Material
  const loadRealisticSampleExcel = () => {
    const targetOr = orNumber.trim().toUpperCase() || 'OR-2026-088';
    const targetStyle = style.trim() || getStyleForOr(targetOr) || 'Casual Daily Bomber Jacket Navy';
    setOrNumber(targetOr);
    setStyle(targetStyle);
    setFileName('PPIC_Order_Lines_Odoo_ERP.xlsx');
    setIsProcessing(true);
    setStatusMessage('Memuat dataset Excel realistis ERP (Order Lines)...');

    // Create realistic rows with exact column headers specified by user
    const sampleRows = [
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[FAB-TASLAN-NVY] Fabric Taslan Waterproof Navy 210T',
        'Order Lines/Quantity': 2500,
        'Order Lines/Received Qty': 1200,
        'Order Lines/Product Unit of Measure/Display Name': 'Yard',
        'Supplier': 'PT Kahatex Textile',
        'Harga Satuan (IDR)': 42000,
      },
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[ZIP-YKK-MET5] Zipper Metal Antique Silver YKK #5 65cm',
        'Order Lines/Quantity': 1000,
        'Order Lines/Received Qty': 450,
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
        'Order Lines/Received Qty': 1600,
        'Order Lines/Product Unit of Measure/Display Name': 'Yard',
        'Supplier': 'PT Sinar Mulia Lining',
        'Harga Satuan (IDR)': 28000,
      },
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[PKG-POLY-A3] Polybag Self-Adhesive Seal 35x45cm Clear',
        'Order Lines/Quantity': 1000,
        'Order Lines/Received Qty': 1000,
        'Order Lines/Product Unit of Measure/Display Name': 'Pcs',
        'Supplier': 'PT Poly Unggul Perkasa',
        'Harga Satuan (IDR)': 850,
      },
      {
        'Order Reference': targetOr,
        'Style': targetStyle,
        'Order Lines/Product/Display Name': '[PKG-BOX-MSTR] Master Carton Box K150 Double Wall 60x40x40cm',
        'Order Lines/Quantity': 40,
        'Order Lines/Received Qty': 40,
        'Order Lines/Product Unit of Measure/Display Name': 'Box',
        'Supplier': 'PT Fajar Surya Wisesa',
        'Harga Satuan (IDR)': 22000,
      },
    ];

    setTimeout(() => {
      const result = parseExcelRowsToMaterials(sampleRows, materials, targetOr, targetStyle);
      autoSaveExcelMaterials({
        newRequirements: result.requirements,
        newMasterMaterials: result.newMasterMaterials,
        newRelations: result.relations,
      });
      setIsProcessing(false);
      setStatusMessage(`Berhasil memuat ${result.summary.validRows} baris material contoh ke Master Data Material.`);
    }, 400);
  };

  // Save relation only button
  const handleSaveOnlyRelation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orNumber.trim() || !style.trim()) {
      setStatusMessage('Silakan lengkapi Nomor OR dan Style sebelum menyimpan relasi.');
      return;
    }
    saveOrStyleRelation(orNumber.trim().toUpperCase(), style.trim());
    setStatusMessage(`Hubungan Nomor OR "${orNumber.toUpperCase()}" dan Style "${style}" berhasil disimpan!`);
  };

  // Export current active state to real Excel (.xlsx) file
  const handleExportCurrentToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Master Data Material (Kebutuhan & Status)
    const matSheetData = materials.map((m) => ({
      'Kode Material': m.code,
      'Nama Material': m.name,
      Kategori: m.category,
      Satuan: m.unit,
      'Total Stok': m.totalStock,
      'Alokasi SPK': m.allocatedStock,
      'Safety Stock': m.safetyStock,
      'Lead Time (Hari)': m.leadTimeDays,
      Supplier: m.supplierName,
      'Gudang Default': m.defaultWarehouse,
      'Harga Satuan (IDR)': m.unitPrice,
    }));
    const wsMaterials = XLSX.utils.json_to_sheet(matSheetData);
    XLSX.utils.book_append_sheet(wb, wsMaterials, 'Master_Material');

    // Sheet 2: Jadwal Produksi
    const woSheetData = productionSchedules.map((w) => ({
      'Nomor OR': w.orNumber,
      Style: w.style,
      Target: w.target,
      'Line Produksi': w.productionLine,
      'Tgl Mulai': w.productionDate,
      'Tgl Selesai': w.finishDate,
      Status: w.status,
    }));
    const wsWO = XLSX.utils.json_to_sheet(woSheetData);
    XLSX.utils.book_append_sheet(wb, wsWO, 'Jadwal_Produksi');

    XLSX.writeFile(wb, `PPIC_Export_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Download official template file (.xlsx) with exact required column names
  const handleDownloadBlankTemplate = () => {
    const wb = XLSX.utils.book_new();
    const templateData = [
      {
        'Order Reference': 'OR-2026-001',
        'Style': 'Bomber Jacket Taslan Navy (BJ-01)',
        'Order Lines/Product/Display Name': '[FAB-TASLAN-NVY] Fabric Taslan Waterproof Navy 210T',
        'Order Lines/Quantity': 2500,
        'Order Lines/Received Qty': 1200,
        'Order Lines/Product Unit of Measure/Display Name': 'Yard',
      },
      {
        'Order Reference': 'OR-2026-001',
        'Style': 'Bomber Jacket Taslan Navy (BJ-01)',
        'Order Lines/Product/Display Name': '[ZIP-YKK-MET5] Zipper Metal Antique Silver YKK #5 65cm',
        'Order Lines/Quantity': 1000,
        'Order Lines/Received Qty': 450,
        'Order Lines/Product Unit of Measure/Display Name': 'Pcs',
      },
      {
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
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Otomatisasi Pembacaan Excel Langsung ke Master Data Material
          </div>
          <h2 className="text-base md:text-lg font-bold text-slate-900">
            Unggah Berkas Excel Kebutuhan Material (Order Lines)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Sistem secara otomatis membaca kolom <code>Order Lines/Product/Display Name</code>, <code>Quantity</code>, <code>Received Qty</code>, dan <code>UoM</code> lalu langsung menyimpannya ke <strong>Master Data Material</strong> tanpa revisi manual.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownloadBlankTemplate}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Unduh Template Excel ERP
          </button>
          <button
            onClick={() => setActiveMenu('Rekap Material')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
          >
            Buka Master Data Material
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Information Banner on Auto-Save Behavior */}
      <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3 text-xs text-blue-900">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold">Mekanisme Pembacaan Otomatis (Tanpa Revisi Manual):</div>
          <div className="text-blue-800 text-[11px] leading-relaxed">
            1. Seluruh baris material dibaca langsung dari file Excel sesuai struktur kolom ERP Odoo/SAP.<br />
            2. Master Data Material digunakan sebagai referensi untuk mengenali kode, nama, dan satuan jika penulisan tidak konsisten.<br />
            3. Data langsung tersimpan dan otomatis terhubung ke Nomor OR serta Style terkait per baris transaksi.<br />
            4. Setelah pembacaan, tampilan langsung berpindah ke Master Data Material untuk pengecekan cepat.
          </div>
        </div>
      </div>

      {/* SECTION: Nomor OR & Style 2-Way Mapping Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center">
              <LinkIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Hubungan Nomor OR & Style
              </h3>
              <p className="text-[11px] text-slate-500">
                Digunakan sebagai fallback jika kolom OR/Style di file Excel kosong. Nilai otomatis terisi dua arah berdasarkan riwayat.
              </p>
            </div>
          </div>
          <span className="text-[11px] px-2.5 py-1 bg-slate-100 text-slate-600 font-medium rounded-full">
            Tersimpan: {orStyleRelations.length} Pasangan
          </span>
        </div>

        <form onSubmit={handleSaveOnlyRelation} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Input 1: Nomor OR */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-blue-600" />
                Nomor OR
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={orNumber}
                  onChange={(e) => handleOrChange(e.target.value)}
                  placeholder="Contoh: OR-2026-001"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono uppercase bg-white"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Ketik nomor OR untuk melengkapi Style secara otomatis.
              </p>
            </div>

            {/* Input 2: Style */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-blue-600" />
                Style
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={style}
                  onChange={(e) => handleStyleChange(e.target.value)}
                  placeholder="Contoh: Bomber Jacket Taslan Navy"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Ketik Style untuk mencari nomor OR yang cocok.
              </p>
            </div>
          </div>

          {/* Feedback indicator */}
          {orInputFeedback && (
            <div className="p-2.5 rounded bg-blue-50/70 border border-blue-200/80 text-xs text-blue-800 flex items-center justify-between">
              <span className="font-medium">{orInputFeedback}</span>
              <button
                type="submit"
                className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline ml-2"
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
                    className="px-2.5 py-1 text-xs font-mono font-medium bg-white hover:bg-amber-100 border border-amber-300 rounded text-slate-800 transition-colors shadow-2xs"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Select from Saved Relations */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 font-medium mr-1">
              Pilihan Cepat Riwayat:
            </span>
            {orStyleRelations.slice(0, 6).map((rel) => (
              <button
                key={rel.id}
                type="button"
                onClick={() => {
                  setOrNumber(rel.orNumber);
                  setStyle(rel.style);
                  setMultipleOrOptions([]);
                  setOrInputFeedback(`Dipilih: ${rel.orNumber} - ${rel.style}`);
                }}
                className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                  orNumber === rel.orNumber
                    ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {rel.orNumber} ({rel.style.slice(0, 16)}...)
              </button>
            ))}
          </div>
        </form>
      </div>

      {/* Upload Drop Zone & Fast Demo */}
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
                Tarik & Lepas File Excel di Sini
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Mendukung file .xlsx, .xls, atau .csv hasil ekspor ERP. Hasil pembacaan akan <strong>langsung disimpan dan ditampilkan ke Master Data Material</strong> tanpa perlu revisi atau konfirmasi manual.
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
              Uji langsung alur pembacaan dan penyimpanan otomatis menggunakan sampel riil struktur kolom <code>Order Lines</code> Odoo ERP.
            </p>

            <div className="mt-4 p-3 bg-slate-50 rounded border border-slate-100 text-[11px] text-slate-600 space-y-1.5">
              <div className="font-semibold text-slate-800">Kolom Teruji:</div>
              <div>• <code>Order Lines/Product/Display Name</code></div>
              <div>• <code>Order Lines/Quantity</code> (Kebutuhan)</div>
              <div>• <code>Order Lines/Received Qty</code> (Diterima)</div>
              <div>• <code>Order Lines/Product Unit of Measure</code></div>
              <div>• Otomatis menghitung <code>Kekurangan & Status READY</code></div>
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
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs rounded shadow-xs transition-colors shrink-0 flex items-center gap-1.5"
          >
            Buka Master Data Material <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Info card for previous upload */}
      {lastImportedInfo && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <CheckCircle className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-950">
                Penyimpanan Terakhir: {lastImportedInfo.count} Baris Material Tersimpan
              </div>
              <div className="text-[11px] text-emerald-800">
                Nomor OR: <strong className="font-mono">{lastImportedInfo.orNumber}</strong> {lastImportedInfo.style && `(${lastImportedInfo.style})`} · Tersimpan di Master Data Material tanpa revisi manual.
              </div>
            </div>
          </div>
          <button
            onClick={() => setActiveMenu('Rekap Material')}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-md transition-colors"
          >
            Lihat Hasil di Master Data
          </button>
        </div>
      )}
    </div>
  );
};
