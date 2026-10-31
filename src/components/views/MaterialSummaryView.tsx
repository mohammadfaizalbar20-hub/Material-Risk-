import React, { useState, useMemo } from 'react';
import { usePpic } from '../../context/PpicContext';
import { Material, MaterialCategory, MaterialUnit } from '../../types/ppic';
import { RiskBadge } from '../common/RiskBadge';
import {
  Boxes,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  AlertTriangle,
  ArrowUpDown,
  Download,
  X,
  Check,
  Building2,
  Clock,
  Layers,
} from 'lucide-react';

export const MaterialSummaryView: React.FC = () => {
  const {
    materials,
    addMaterial,
    updateMaterial,
    deleteMaterial,
    materialRiskAssessments,
    activeSearchQuery,
    setActiveSearchQuery,
  } = usePpic();

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stockHealthFilter, setStockHealthFilter] = useState<string>('ALL');
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);

  // Form state
  const [formData, setFormData] = useState<{
    code: string;
    name: string;
    category: MaterialCategory;
    unit: MaterialUnit;
    totalStock: number;
    safetyStock: number;
    leadTimeDays: number;
    supplierName: string;
    defaultWarehouse: string;
    unitPrice: number;
    minOrderQty: number;
  }>({
    code: '',
    name: '',
    category: 'Raw Material',
    unit: 'Kg',
    totalStock: 1000,
    safetyStock: 300,
    leadTimeDays: 7,
    supplierName: '',
    defaultWarehouse: 'WH-01',
    unitPrice: 25000,
    minOrderQty: 500,
  });

  // Material risk lookup map by material code
  const riskMap = useMemo(() => {
    return new Map(materialRiskAssessments.map((r) => [r.materialCode, r]));
  }, [materialRiskAssessments]);

  // Filtering materials
  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      // Search
      const q = activeSearchQuery.toLowerCase();
      const matchSearch =
        m.code.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.supplierName.toLowerCase().includes(q);

      if (!matchSearch) return false;

      // Category filter
      if (selectedCategory !== 'ALL' && m.category !== selectedCategory) {
        return false;
      }

      // Health filter
      const free = m.totalStock - m.allocatedStock;
      const risk = riskMap.get(m.code)?.riskCategory || (free < 0 ? 'CRITICAL' : 'LOW');

      if (stockHealthFilter === 'CRITICAL' && risk !== 'CRITICAL') return false;
      if (stockHealthFilter === 'SHORTAGE' && free >= 0) return false;
      if (stockHealthFilter === 'LOW_SAFETY' && free >= m.safetyStock) return false;
      if (stockHealthFilter === 'READY' && risk !== 'LOW') return false;

      return true;
    });
  }, [materials, activeSearchQuery, selectedCategory, stockHealthFilter, riskMap]);

  const handleOpenAddModal = () => {
    setEditingMaterial(null);
    setFormData({
      code: `RM-NEW-${Math.floor(100 + Math.random() * 900)}`,
      name: '',
      category: 'Raw Material',
      unit: 'Kg',
      totalStock: 1000,
      safetyStock: 300,
      leadTimeDays: 7,
      supplierName: '',
      defaultWarehouse: 'WH-01',
      unitPrice: 25000,
      minOrderQty: 500,
    });
    setModalOpen(true);
  };

  const handleOpenEditModal = (mat: Material) => {
    setEditingMaterial(mat);
    setFormData({
      code: mat.code,
      name: mat.name,
      category: mat.category,
      unit: mat.unit,
      totalStock: mat.totalStock,
      safetyStock: mat.safetyStock,
      leadTimeDays: mat.leadTimeDays,
      supplierName: mat.supplierName,
      defaultWarehouse: mat.defaultWarehouse,
      unitPrice: mat.unitPrice,
      minOrderQty: mat.minOrderQty,
    });
    setModalOpen(true);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code || !formData.name) return;

    if (editingMaterial) {
      updateMaterial(editingMaterial.id, {
        ...formData,
      });
    } else {
      addMaterial({
        ...formData,
        allocatedStock: 0,
      });
    }
    setModalOpen(false);
  };

  const formatIdr = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="p-5 bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base md:text-lg font-bold text-slate-900">
            Rekap Master Material & Saldo Stok
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Database seluruh komponen Raw Material, Kemasan, dan Bahan Kimia dengan status alokasi produksi SPK.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAddModal}
            className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Tambah Material Baru
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500 mr-2">Kategori:</span>
          {['ALL', 'Raw Material', 'Packaging', 'Chemical', 'Auxiliary'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {cat === 'ALL' ? 'Semua Kategori' : cat}
            </button>
          ))}
        </div>

        {/* Health status filter & live search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 mr-2">Status Stok:</span>
            {[
              { id: 'ALL', label: 'Semua Status' },
              { id: 'CRITICAL', label: 'Kritis Shortage' },
              { id: 'LOW_SAFETY', label: 'Di Bawah Safety Stock' },
              { id: 'READY', label: 'Ready / Aman' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStockHealthFilter(f.id)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  stockHealthFilter === f.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-500">
            Menampilkan <strong className="text-slate-900">{filteredMaterials.length}</strong> dari {materials.length} material
          </div>
        </div>
      </div>

      {/* Main Material Master Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <th className="py-3 px-3.5">Kode Material</th>
                <th className="py-3 px-3.5">Deskripsi Material</th>
                <th className="py-3 px-3">Kategori</th>
                <th className="py-3 px-3 text-right">Total Stok</th>
                <th className="py-3 px-3 text-right">Alokasi SPK</th>
                <th className="py-3 px-3 text-right">Free Stock</th>
                <th className="py-3 px-3 text-right">Safety Stock</th>
                <th className="py-3 px-3 text-center">Lead Time</th>
                <th className="py-3 px-3">Default WH</th>
                <th className="py-3 px-3.5">Status Risiko</th>
                <th className="py-3 px-3.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400 text-xs">
                    Tidak ada material yang sesuai dengan kriteria filter atau pencarian.
                  </td>
                </tr>
              ) : (
                filteredMaterials.map((mat) => {
                  const free = mat.totalStock - mat.allocatedStock;
                  const assessment = riskMap.get(mat.code);
                  const riskLevel = assessment?.riskCategory || (free < 0 ? 'CRITICAL' : 'LOW');

                  return (
                    <tr key={mat.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3.5 font-mono font-bold text-slate-900">
                        {mat.code}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-900">{mat.name}</div>
                        <div className="text-[11px] text-slate-400">
                          Supplier: {mat.supplierName}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {mat.category}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-900">
                        {mat.totalStock.toLocaleString('id-ID')} {mat.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-600">
                        {mat.allocatedStock.toLocaleString('id-ID')} {mat.unit}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono font-bold ${
                          free < 0
                            ? 'text-red-600 bg-red-50/50'
                            : free < mat.safetyStock
                            ? 'text-amber-600'
                            : 'text-emerald-700'
                        }`}
                      >
                        {free.toLocaleString('id-ID')} {mat.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-500">
                        {mat.safetyStock.toLocaleString('id-ID')} {mat.unit}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-slate-600">
                        {mat.leadTimeDays} Hari
                      </td>
                      <td className="py-3 px-3 font-mono font-medium text-slate-700">
                        {mat.defaultWarehouse}
                      </td>
                      <td className="py-3 px-3.5">
                        <RiskBadge level={riskLevel} size="sm" />
                      </td>
                      <td className="py-3 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleOpenEditModal(mat)}
                            className="p-1 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded"
                            title="Edit Material"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Hapus material ${mat.code} (${mat.name})?`)) {
                                deleteMaterial(mat.id);
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded"
                            title="Hapus Material"
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

      {/* Add / Edit Material Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold">
                  {editingMaterial ? 'Edit Parameter Material PPIC' : 'Tambah Material Baru'}
                </h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kode Material (Unique)
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    placeholder="e.g. RM-RESIN-01"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kategori Material
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value as MaterialCategory })
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="Raw Material">Raw Material (Bahan Baku)</option>
                    <option value="Packaging">Packaging (Kemasan)</option>
                    <option value="Chemical">Chemical (Bahan Kimia/Aditif)</option>
                    <option value="Auxiliary">Auxiliary (Bahan Penolong)</option>
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
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  placeholder="e.g. Polypropylene Copolymer (PP Blow Grade)"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Satuan (UoM)
                  </label>
                  <select
                    value={formData.unit}
                    onChange={(e) =>
                      setFormData({ ...formData, unit: e.target.value as MaterialUnit })
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="Kg">Kg</option>
                    <option value="Pcs">Pcs</option>
                    <option value="Roll">Roll</option>
                    <option value="Drum">Drum</option>
                    <option value="Box">Box</option>
                    <option value="Liter">Liter</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Total Stok Awal
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.totalStock}
                    onChange={(e) =>
                      setFormData({ ...formData, totalStock: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Safety Stock
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.safetyStock}
                    onChange={(e) =>
                      setFormData({ ...formData, safetyStock: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lead Time (Hari)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.leadTimeDays}
                    onChange={(e) =>
                      setFormData({ ...formData, leadTimeDays: parseInt(e.target.value, 10) || 1 })
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Gudang Default
                  </label>
                  <select
                    value={formData.defaultWarehouse}
                    onChange={(e) => setFormData({ ...formData, defaultWarehouse: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="WH-01">WH-01 (Bahan Baku)</option>
                    <option value="WH-02">WH-02 (Kemasan)</option>
                    <option value="WH-03">WH-03 (Bahan Kimia)</option>
                    <option value="WH-04">WH-04 (Transit QC)</option>
                    <option value="WH-05">WH-05 (WIP)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Harga Satuan (IDR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.unitPrice}
                    onChange={(e) =>
                      setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Vendor / Supplier Utama
                </label>
                <input
                  type="text"
                  required
                  value={formData.supplierName}
                  onChange={(e) => setFormData({ ...formData, supplierName: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  placeholder="e.g. PT Chandra Asri Petrochemical Tbk"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-xs"
                >
                  {editingMaterial ? 'Perbarui Material' : 'Simpan Material'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
