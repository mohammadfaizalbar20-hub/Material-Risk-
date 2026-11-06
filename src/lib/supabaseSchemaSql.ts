// Skema SQL Lengkap untuk Supabase PostgreSQL PPIC
// Dioptimalkan untuk Skala Besar (High-Volume Scale: 20.000+ baris/hari, Jutaan Baris)
export const PPIC_SUPABASE_SCHEMA_SQL = `-- ==============================================================================
-- SKEMA DATABASE SUPABASE PPIC (PRODUCTION PLANNING & INVENTORY CONTROL)
-- Terpusat, Realtime, dan Siap Digunakan Antar Laptop / Multi-Device
-- Dioptimalkan untuk Skala Besar: 20.000+ baris baru/hari / Jutaan Baris
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Diperlukan untuk GIN Trigram Index (ILIKE '%pattern%' pada jutaan baris)

-- 2. TABEL: or_style_relations (Pemetaan No. OR dan Style)
CREATE TABLE IF NOT EXISTS public.or_style_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    or_number TEXT NOT NULL UNIQUE,
    style TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_or_style_number ON public.or_style_relations(or_number);
CREATE INDEX IF NOT EXISTS idx_or_style_trgm ON public.or_style_relations USING gin (style gin_trgm_ops);

-- 3. TABEL: upload_history (Riwayat Unggahan File Excel)
CREATE TABLE IF NOT EXISTS public.upload_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    or_number TEXT NOT NULL,
    style TEXT NOT NULL,
    file_name TEXT NOT NULL,
    update_date DATE NOT NULL,
    upload_time TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Sukses',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upload_history_or ON public.upload_history(or_number);
CREATE INDEX IF NOT EXISTS idx_upload_history_date ON public.upload_history(update_date);
CREATE INDEX IF NOT EXISTS idx_upload_hist_date_or ON public.upload_history(update_date DESC, or_number);
CREATE INDEX IF NOT EXISTS idx_upload_hist_created ON public.upload_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_hist_or_trgm ON public.upload_history USING gin (or_number gin_trgm_ops);

-- 4. TABEL: material_requirements (Detail Kebutuhan & Penerimaan Material)
CREATE TABLE IF NOT EXISTS public.material_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id UUID REFERENCES public.upload_history(id) ON DELETE SET NULL,
    or_number TEXT NOT NULL,
    style TEXT NOT NULL,
    material_code TEXT NOT NULL,
    material_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Raw Material',
    unit TEXT NOT NULL,
    required_qty NUMERIC(14, 2) NOT NULL DEFAULT 0,
    received_qty NUMERIC(14, 2) NOT NULL DEFAULT 0,
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    supplier_name TEXT,
    update_date DATE NOT NULL,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- B-Tree Indexes (Optimal untuk =, range date, dan ORDER BY)
CREATE INDEX IF NOT EXISTS idx_mat_req_or ON public.material_requirements(or_number);
CREATE INDEX IF NOT EXISTS idx_mat_req_date ON public.material_requirements(update_date);
CREATE INDEX IF NOT EXISTS idx_mat_req_or_date ON public.material_requirements(or_number, update_date DESC);
CREATE INDEX IF NOT EXISTS idx_mat_req_upload_id ON public.material_requirements(upload_id);
CREATE INDEX IF NOT EXISTS idx_mat_req_code ON public.material_requirements(material_code);
CREATE INDEX IF NOT EXISTS idx_mat_req_style ON public.material_requirements(style);
CREATE INDEX IF NOT EXISTS idx_mat_req_category ON public.material_requirements(category);
CREATE INDEX IF NOT EXISTS idx_mat_req_created ON public.material_requirements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mat_req_imported ON public.material_requirements(imported_at DESC);

-- GIN Trigram Indexes (Wajib untuk pencarian cepat wildcard ILIKE '%pola%' tanpa Full Table Scan)
-- CATATAN POSTGRESQL: Indeks ini dieksekusi di luar blok transaksi (DO $$)
-- karena CREATE INDEX CONCURRENTLY / DDL tidak diizinkan di dalam transaction block.
CREATE INDEX IF NOT EXISTS idx_mat_req_name_trgm ON public.material_requirements USING gin (material_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mat_req_code_trgm ON public.material_requirements USING gin (material_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mat_req_or_trgm ON public.material_requirements USING gin (or_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mat_req_style_trgm ON public.material_requirements USING gin (style gin_trgm_ops);

-- 5. TABEL: production_schedules (Penjadwalan Produksi / Gantt Board)
CREATE TABLE IF NOT EXISTS public.production_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    or_number TEXT NOT NULL,
    style TEXT NOT NULL,
    production_line TEXT NOT NULL,
    production_date DATE NOT NULL,
    finish_date DATE NOT NULL,
    target INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Terjadwal',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_schedules_or ON public.production_schedules(or_number);
CREATE INDEX IF NOT EXISTS idx_schedules_dates ON public.production_schedules(production_date, finish_date);

-- 6. TABEL: master_materials (Katalog Master Material)
CREATE TABLE IF NOT EXISTS public.master_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Raw Material',
    unit TEXT NOT NULL,
    total_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
    allocated_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
    safety_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
    lead_time_days INTEGER NOT NULL DEFAULT 7,
    supplier_name TEXT,
    default_warehouse TEXT DEFAULT 'Gudang Bahan Baku Utama',
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    min_order_qty NUMERIC(14, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_master_mat_code ON public.master_materials(code);

-- 7. TABEL: warehouse_stock (Posisi Stok Fisik Gudang)
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_code TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    stock_on_hand NUMERIC(14, 2) NOT NULL DEFAULT 0,
    stock_reserved NUMERIC(14, 2) NOT NULL DEFAULT 0,
    location_rack TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_stock_mat ON public.warehouse_stock(material_code);

-- 8. TABEL: deletion_history (Audit Log Riwayat Penghapusan)
CREATE TABLE IF NOT EXISTS public.deletion_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TEXT NOT NULL,
    method TEXT NOT NULL,
    method_label TEXT NOT NULL,
    target_value TEXT NOT NULL,
    target_details TEXT,
    deleted_row_count INTEGER NOT NULL DEFAULT 0,
    affected_ors TEXT[],
    operator_user TEXT DEFAULT 'Tim PPIC',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- MIGRASI NON-DESTRUKTIF UNTUK DATABASE YANG SUDAH DIBUAT DENGAN VARCHAR(255)
-- ==============================================================================
DO $$
BEGIN
  ALTER TABLE IF EXISTS public.or_style_relations ALTER COLUMN or_number TYPE TEXT;
  ALTER TABLE IF EXISTS public.or_style_relations ALTER COLUMN style TYPE TEXT;

  ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN or_number TYPE TEXT;
  ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN style TYPE TEXT;
  ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN file_name TYPE TEXT;
  ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN status TYPE TEXT;
  ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN upload_time TYPE TEXT;

  ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN or_number TYPE TEXT;
  ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN style TYPE TEXT;
  ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN material_code TYPE TEXT;
  ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN material_name TYPE TEXT;
  ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN category TYPE TEXT;
  ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN unit TYPE TEXT;
  ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN supplier_name TYPE TEXT;

  ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN or_number TYPE TEXT;
  ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN style TYPE TEXT;
  ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN production_line TYPE TEXT;
  ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN status TYPE TEXT;

  ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN code TYPE TEXT;
  ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN name TYPE TEXT;
  ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN category TYPE TEXT;
  ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN unit TYPE TEXT;
  ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN supplier_name TYPE TEXT;
  ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN default_warehouse TYPE TEXT;

  ALTER TABLE IF EXISTS public.warehouse_stock ALTER COLUMN material_code TYPE TEXT;
  ALTER TABLE IF EXISTS public.warehouse_stock ALTER COLUMN warehouse_id TYPE TEXT;
  ALTER TABLE IF EXISTS public.warehouse_stock ALTER COLUMN location_rack TYPE TEXT;

  ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN timestamp TYPE TEXT;
  ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN method TYPE TEXT;
  ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN method_label TYPE TEXT;
  ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN target_value TYPE TEXT;
  ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN operator_user TYPE TEXT;
END $$;

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
-- FUNGSI RPC SERVER-SIDE AGGREGATION UNTUK DASHBOARD (HIGH-PERFORMANCE)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_ppic_dashboard_summary(
    p_or_query TEXT DEFAULT NULL,
    p_date_from DATE DEFAULT NULL,
    p_date_to DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
    v_clean_or TEXT := NULLIF(TRIM(p_or_query), '');
BEGIN
    WITH filtered_data AS (
        SELECT 
            id,
            or_number,
            style,
            material_code,
            material_name,
            category,
            unit,
            required_qty,
            received_qty,
            GREATEST(0, required_qty - received_qty) AS deficit,
            CASE WHEN received_qty >= required_qty THEN 1 ELSE 0 END AS is_ready,
            update_date
        FROM public.material_requirements
        WHERE (v_clean_or IS NULL OR or_number ILIKE '%' || v_clean_or || '%' OR style ILIKE '%' || v_clean_or || '%')
          AND (p_date_from IS NULL OR update_date >= p_date_from)
          AND (p_date_to IS NULL OR update_date <= p_date_to)
    ),
    summary_metrics AS (
        SELECT 
            COUNT(*)::BIGINT AS total_rows,
            COALESCE(SUM(required_qty), 0)::NUMERIC AS total_required,
            COALESCE(SUM(received_qty), 0)::NUMERIC AS total_received,
            COALESCE(SUM(deficit), 0)::NUMERIC AS total_deficit,
            COALESCE(SUM(is_ready), 0)::BIGINT AS ready_rows,
            COUNT(*) - COALESCE(SUM(is_ready), 0)::BIGINT AS not_ready_rows
        FROM filtered_data
    ),
    pareto_agg AS (
        SELECT 
            material_code,
            MAX(material_name) AS material_name,
            MAX(unit) AS unit,
            SUM(required_qty)::NUMERIC AS total_required,
            SUM(received_qty)::NUMERIC AS total_received,
            SUM(deficit)::NUMERIC AS total_deficit
        FROM filtered_data
        GROUP BY material_code
        HAVING SUM(deficit) > 0
        ORDER BY total_deficit DESC
        LIMIT 10
    ),
    top_materials_agg AS (
        SELECT 
            material_code,
            MAX(material_name) AS material_name,
            MAX(unit) AS unit,
            SUM(required_qty)::NUMERIC AS required,
            SUM(received_qty)::NUMERIC AS received
        FROM filtered_data
        GROUP BY material_code
        ORDER BY SUM(required_qty) DESC
        LIMIT 6
    ),
    category_agg AS (
        SELECT 
            category,
            COUNT(*)::BIGINT AS count,
            COALESCE(SUM(required_qty), 0)::NUMERIC AS total_qty
        FROM filtered_data
        GROUP BY category
    )
    SELECT json_build_object(
        'total_rows', sm.total_rows,
        'total_required', sm.total_required,
        'total_received', sm.total_received,
        'total_deficit', sm.total_deficit,
        'ready_rows', sm.ready_rows,
        'not_ready_rows', sm.not_ready_rows,
        'fulfillment_rate', CASE WHEN sm.total_required > 0 THEN ROUND((sm.total_received / sm.total_required * 100)::NUMERIC, 1) ELSE 100 END,
        'pareto_items', COALESCE((SELECT json_agg(p) FROM pareto_agg p), '[]'::json),
        'top_materials', COALESCE((SELECT json_agg(t) FROM top_materials_agg t), '[]'::json),
        'category_breakdown', COALESCE((SELECT json_agg(c) FROM category_agg c), '[]'::json)
    ) INTO v_result
    FROM summary_metrics sm;

    RETURN v_result;
END;
$$;

-- ==============================================================================
-- FUNGSI RPC DATABASE STORAGE MONITORING (PEMANTAUAN UKURAN & PERTUMBUHAN)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_ppic_database_storage_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_db_size BIGINT;
    v_req_table_size BIGINT;
    v_hist_table_size BIGINT;
    v_total_rows BIGINT;
    v_hist_count BIGINT;
    v_or_count BIGINT;
    v_mat_count BIGINT;
    v_free_tier_limit BIGINT := 524288000; -- 500 MB dalam bytes (Free Tier)
    v_pro_tier_limit BIGINT := 8589934592; -- 8 GB dalam bytes (Pro Tier)
    v_avg_row_bytes NUMERIC;
    v_daily_growth_bytes BIGINT;
BEGIN
    SELECT pg_database_size(current_database()) INTO v_db_size;
    SELECT pg_total_relation_size('public.material_requirements') INTO v_req_table_size;
    SELECT pg_total_relation_size('public.upload_history') INTO v_hist_table_size;

    SELECT COUNT(*) INTO v_total_rows FROM public.material_requirements;
    SELECT COUNT(*) INTO v_hist_count FROM public.upload_history;
    SELECT COUNT(*) INTO v_or_count FROM public.or_style_relations;
    SELECT COUNT(*) INTO v_mat_count FROM public.master_materials;

    IF v_total_rows > 0 AND v_req_table_size > 0 THEN
        v_avg_row_bytes := ROUND((v_req_table_size::NUMERIC / v_total_rows::NUMERIC), 1);
    ELSE
        v_avg_row_bytes := 350;
    END IF;

    -- Pertumbuhan 20.000 baris/hari
    v_daily_growth_bytes := (20000 * v_avg_row_bytes)::BIGINT;

    RETURN json_build_object(
        'database_size_bytes', v_db_size,
        'database_size_pretty', pg_size_pretty(v_db_size),
        'requirements_table_size_bytes', v_req_table_size,
        'requirements_table_size_pretty', pg_size_pretty(v_req_table_size),
        'history_table_size_bytes', v_hist_table_size,
        'history_table_size_pretty', pg_size_pretty(v_hist_table_size),
        'total_material_rows', v_total_rows,
        'total_upload_history', v_hist_count,
        'total_or_relations', v_or_count,
        'total_master_materials', v_mat_count,
        'avg_row_bytes', v_avg_row_bytes,
        'daily_growth_est_bytes', v_daily_growth_bytes,
        'daily_growth_est_pretty', pg_size_pretty(v_daily_growth_bytes),
        'monthly_growth_est_bytes', (v_daily_growth_bytes * 30),
        'monthly_growth_est_pretty', pg_size_pretty(v_daily_growth_bytes * 30),
        'free_tier_limit_bytes', v_free_tier_limit,
        'free_tier_usage_percent', ROUND((v_db_size::NUMERIC / v_free_tier_limit::NUMERIC * 100), 2),
        'pro_tier_limit_bytes', v_pro_tier_limit,
        'pro_tier_usage_percent', ROUND((v_db_size::NUMERIC / v_pro_tier_limit::NUMERIC * 100), 2)
    );
END;
$$;

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
    NULL;
  END;
END $$;
`;

// Script Cepat Pembaruan Kolom VARCHAR ke TEXT (Aman untuk database yang sudah terisi)
export const PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL = `-- Jalankan query berikut di Supabase SQL Editor untuk memperbarui kolom VARCHAR(255) ke TEXT:
ALTER TABLE IF EXISTS public.or_style_relations ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.or_style_relations ALTER COLUMN style TYPE TEXT;

ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN style TYPE TEXT;
ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN file_name TYPE TEXT;

ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN style TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN material_code TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN material_name TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN supplier_name TYPE TEXT;

ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN style TYPE TEXT;
ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN production_line TYPE TEXT;

ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN code TYPE TEXT;
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN name TYPE TEXT;
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN supplier_name TYPE TEXT;
`;

// Script Optimasi High-Volume Scale (Index Komposit & RPC Dashboard/Monitoring)
export const PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL = `-- Jalankan query berikut di Supabase SQL Editor untuk mengaktifkan Index High-Volume & RPC Aggregation:
CREATE INDEX IF NOT EXISTS idx_mat_req_or_date ON public.material_requirements(or_number, update_date DESC);
CREATE INDEX IF NOT EXISTS idx_mat_req_upload_id ON public.material_requirements(upload_id);
CREATE INDEX IF NOT EXISTS idx_mat_req_category ON public.material_requirements(category);
CREATE INDEX IF NOT EXISTS idx_mat_req_created ON public.material_requirements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mat_req_imported ON public.material_requirements(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_hist_date_or ON public.upload_history(update_date DESC, or_number);
CREATE INDEX IF NOT EXISTS idx_upload_hist_created ON public.upload_history(created_at DESC);

-- RPC Server-Side Aggregation Dashboard
CREATE OR REPLACE FUNCTION public.get_ppic_dashboard_summary(
    p_or_query TEXT DEFAULT NULL,
    p_date_from DATE DEFAULT NULL,
    p_date_to DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
    v_clean_or TEXT := NULLIF(TRIM(p_or_query), '');
BEGIN
    WITH filtered_data AS (
        SELECT 
            id,
            or_number,
            style,
            material_code,
            material_name,
            category,
            unit,
            required_qty,
            received_qty,
            GREATEST(0, required_qty - received_qty) AS deficit,
            CASE WHEN received_qty >= required_qty THEN 1 ELSE 0 END AS is_ready,
            update_date
        FROM public.material_requirements
        WHERE (v_clean_or IS NULL OR or_number ILIKE '%' || v_clean_or || '%' OR style ILIKE '%' || v_clean_or || '%')
          AND (p_date_from IS NULL OR update_date >= p_date_from)
          AND (p_date_to IS NULL OR update_date <= p_date_to)
    ),
    summary_metrics AS (
        SELECT 
            COUNT(*)::BIGINT AS total_rows,
            COALESCE(SUM(required_qty), 0)::NUMERIC AS total_required,
            COALESCE(SUM(received_qty), 0)::NUMERIC AS total_received,
            COALESCE(SUM(deficit), 0)::NUMERIC AS total_deficit,
            COALESCE(SUM(is_ready), 0)::BIGINT AS ready_rows,
            COUNT(*) - COALESCE(SUM(is_ready), 0)::BIGINT AS not_ready_rows
        FROM filtered_data
    ),
    pareto_agg AS (
        SELECT 
            material_code,
            MAX(material_name) AS material_name,
            MAX(unit) AS unit,
            SUM(required_qty)::NUMERIC AS total_required,
            SUM(received_qty)::NUMERIC AS total_received,
            SUM(deficit)::NUMERIC AS total_deficit
        FROM filtered_data
        GROUP BY material_code
        HAVING SUM(deficit) > 0
        ORDER BY total_deficit DESC
        LIMIT 10
    ),
    top_materials_agg AS (
        SELECT 
            material_code,
            MAX(material_name) AS material_name,
            MAX(unit) AS unit,
            SUM(required_qty)::NUMERIC AS required,
            SUM(received_qty)::NUMERIC AS received
        FROM filtered_data
        GROUP BY material_code
        ORDER BY SUM(required_qty) DESC
        LIMIT 6
    ),
    category_agg AS (
        SELECT 
            category,
            COUNT(*)::BIGINT AS count,
            COALESCE(SUM(required_qty), 0)::NUMERIC AS total_qty
        FROM filtered_data
        GROUP BY category
    )
    SELECT json_build_object(
        'total_rows', sm.total_rows,
        'total_required', sm.total_required,
        'total_received', sm.total_received,
        'total_deficit', sm.total_deficit,
        'ready_rows', sm.ready_rows,
        'not_ready_rows', sm.not_ready_rows,
        'fulfillment_rate', CASE WHEN sm.total_required > 0 THEN ROUND((sm.total_received / sm.total_required * 100)::NUMERIC, 1) ELSE 100 END,
        'pareto_items', COALESCE((SELECT json_agg(p) FROM pareto_agg p), '[]'::json),
        'top_materials', COALESCE((SELECT json_agg(t) FROM top_materials_agg t), '[]'::json),
        'category_breakdown', COALESCE((SELECT json_agg(c) FROM category_agg c), '[]'::json)
    ) INTO v_result
    FROM summary_metrics sm;

    RETURN v_result;
END;
$$;

-- RPC Database Storage Monitoring
CREATE OR REPLACE FUNCTION public.get_ppic_database_storage_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_db_size BIGINT;
    v_req_table_size BIGINT;
    v_hist_table_size BIGINT;
    v_total_rows BIGINT;
    v_hist_count BIGINT;
    v_or_count BIGINT;
    v_mat_count BIGINT;
    v_free_tier_limit BIGINT := 524288000;
    v_pro_tier_limit BIGINT := 8589934592;
    v_avg_row_bytes NUMERIC;
    v_daily_growth_bytes BIGINT;
BEGIN
    SELECT pg_database_size(current_database()) INTO v_db_size;
    SELECT pg_total_relation_size('public.material_requirements') INTO v_req_table_size;
    SELECT pg_total_relation_size('public.upload_history') INTO v_hist_table_size;

    SELECT COUNT(*) INTO v_total_rows FROM public.material_requirements;
    SELECT COUNT(*) INTO v_hist_count FROM public.upload_history;
    SELECT COUNT(*) INTO v_or_count FROM public.or_style_relations;
    SELECT COUNT(*) INTO v_mat_count FROM public.master_materials;

    IF v_total_rows > 0 AND v_req_table_size > 0 THEN
        v_avg_row_bytes := ROUND((v_req_table_size::NUMERIC / v_total_rows::NUMERIC), 1);
    ELSE
        v_avg_row_bytes := 350;
    END IF;

    v_daily_growth_bytes := (20000 * v_avg_row_bytes)::BIGINT;

    RETURN json_build_object(
        'database_size_bytes', v_db_size,
        'database_size_pretty', pg_size_pretty(v_db_size),
        'requirements_table_size_bytes', v_req_table_size,
        'requirements_table_size_pretty', pg_size_pretty(v_req_table_size),
        'history_table_size_bytes', v_hist_table_size,
        'history_table_size_pretty', pg_size_pretty(v_hist_table_size),
        'total_material_rows', v_total_rows,
        'total_upload_history', v_hist_count,
        'total_or_relations', v_or_count,
        'total_master_materials', v_mat_count,
        'avg_row_bytes', v_avg_row_bytes,
        'daily_growth_est_bytes', v_daily_growth_bytes,
        'daily_growth_est_pretty', pg_size_pretty(v_daily_growth_bytes),
        'monthly_growth_est_bytes', (v_daily_growth_bytes * 30),
        'monthly_growth_est_pretty', pg_size_pretty(v_daily_growth_bytes * 30),
        'free_tier_limit_bytes', v_free_tier_limit,
        'free_tier_usage_percent', ROUND((v_db_size::NUMERIC / v_free_tier_limit::NUMERIC * 100), 2),
        'pro_tier_limit_bytes', v_pro_tier_limit,
        'pro_tier_usage_percent', ROUND((v_db_size::NUMERIC / v_pro_tier_limit::NUMERIC * 100), 2)
    );
END;
$$;
`;
