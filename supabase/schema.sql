-- ==============================================================================
-- SKEMA DATABASE SUPABASE PPIC (PRODUCTION PLANNING & INVENTORY CONTROL)
-- Terpusat, Realtime, dan Siap Digunakan Antar Laptop / Multi-Device
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABEL: or_style_relations (Pemetaan No. OR dan Style)
CREATE TABLE IF NOT EXISTS public.or_style_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    or_number VARCHAR(100) NOT NULL UNIQUE,
    style VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_or_style_number ON public.or_style_relations(or_number);

-- 3. TABEL: upload_history (Riwayat Unggahan File Excel)
CREATE TABLE IF NOT EXISTS public.upload_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    or_number VARCHAR(100) NOT NULL,
    style VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    update_date DATE NOT NULL,
    upload_time VARCHAR(30) NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'Sukses',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upload_history_or ON public.upload_history(or_number);
CREATE INDEX IF NOT EXISTS idx_upload_history_date ON public.upload_history(update_date);

-- 4. TABEL: material_requirements (Detail Kebutuhan & Penerimaan Material)
CREATE TABLE IF NOT EXISTS public.material_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id UUID REFERENCES public.upload_history(id) ON DELETE SET NULL,
    or_number VARCHAR(100) NOT NULL,
    style VARCHAR(255) NOT NULL,
    material_code VARCHAR(100) NOT NULL,
    material_name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'Raw Material',
    unit VARCHAR(30) NOT NULL,
    required_qty NUMERIC(14, 2) NOT NULL DEFAULT 0,
    received_qty NUMERIC(14, 2) NOT NULL DEFAULT 0,
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    supplier_name VARCHAR(255),
    update_date DATE NOT NULL,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mat_req_or ON public.material_requirements(or_number);
CREATE INDEX IF NOT EXISTS idx_mat_req_date ON public.material_requirements(update_date);
CREATE INDEX IF NOT EXISTS idx_mat_req_code ON public.material_requirements(material_code);
CREATE INDEX IF NOT EXISTS idx_mat_req_style ON public.material_requirements(style);

-- 5. TABEL: production_schedules (Penjadwalan Produksi / Gantt Board)
CREATE TABLE IF NOT EXISTS public.production_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    or_number VARCHAR(100) NOT NULL,
    style VARCHAR(255) NOT NULL,
    production_line VARCHAR(50) NOT NULL,
    production_date DATE NOT NULL,
    finish_date DATE NOT NULL,
    target INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'Terjadwal',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_schedules_or ON public.production_schedules(or_number);
CREATE INDEX IF NOT EXISTS idx_schedules_dates ON public.production_schedules(production_date, finish_date);

-- 6. TABEL: master_materials (Katalog Master Material)
CREATE TABLE IF NOT EXISTS public.master_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'Raw Material',
    unit VARCHAR(30) NOT NULL,
    total_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
    allocated_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
    safety_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
    lead_time_days INTEGER NOT NULL DEFAULT 7,
    supplier_name VARCHAR(255),
    default_warehouse VARCHAR(100) DEFAULT 'Gudang Bahan Baku Utama',
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    min_order_qty NUMERIC(14, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_master_mat_code ON public.master_materials(code);

-- 7. TABEL: warehouse_stock (Posisi Stok Fisik Gudang)
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_code VARCHAR(100) NOT NULL,
    warehouse_id VARCHAR(50) NOT NULL,
    stock_on_hand NUMERIC(14, 2) NOT NULL DEFAULT 0,
    stock_reserved NUMERIC(14, 2) NOT NULL DEFAULT 0,
    location_rack VARCHAR(50),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_stock_mat ON public.warehouse_stock(material_code);

-- 8. TABEL: deletion_history (Audit Log Riwayat Penghapusan)
CREATE TABLE IF NOT EXISTS public.deletion_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp VARCHAR(50) NOT NULL,
    method VARCHAR(50) NOT NULL,
    method_label VARCHAR(100) NOT NULL,
    target_value VARCHAR(255) NOT NULL,
    target_details TEXT,
    deleted_row_count INTEGER NOT NULL DEFAULT 0,
    affected_ors TEXT[],
    operator_user VARCHAR(100) DEFAULT 'Tim PPIC',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.or_style_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_history ENABLE ROW LEVEL SECURITY;

-- Kebijakan Akses Bersama untuk Tim PPIC (Bisa diakses dari browser tim yang terhubung)
DROP POLICY IF EXISTS "Akses tim or_style_relations" ON public.or_style_relations;
CREATE POLICY "Akses tim or_style_relations" ON public.or_style_relations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses tim upload_history" ON public.upload_history;
CREATE POLICY "Akses tim upload_history" ON public.upload_history FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses tim material_requirements" ON public.material_requirements;
CREATE POLICY "Akses tim material_requirements" ON public.material_requirements FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses tim production_schedules" ON public.production_schedules;
CREATE POLICY "Akses tim production_schedules" ON public.production_schedules FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses tim master_materials" ON public.master_materials;
CREATE POLICY "Akses tim master_materials" ON public.master_materials FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses tim warehouse_stock" ON public.warehouse_stock;
CREATE POLICY "Akses tim warehouse_stock" ON public.warehouse_stock FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses tim deletion_history" ON public.deletion_history;
CREATE POLICY "Akses tim deletion_history" ON public.deletion_history FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- SUPABASE REALTIME REPLICATION (Sinkronisasi Otomatis Antar Device)
-- ==============================================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE 
      public.or_style_relations,
      public.upload_history,
      public.material_requirements,
      public.production_schedules,
      public.master_materials,
      public.warehouse_stock,
      public.deletion_history;
  EXCEPTION WHEN duplicate_object THEN
    -- Tabel sudah ada di publikasi realtime
    NULL;
  END;
END $$;
