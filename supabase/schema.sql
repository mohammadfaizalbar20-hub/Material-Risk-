-- ==============================================================================
-- SKEMA DATABASE SUPABASE PPIC (PRODUCTION PLANNING & INVENTORY CONTROL)
-- Terpusat, Realtime, dan Siap Digunakan Antar Laptop / Multi-Device
-- Seluruh kolom teks menggunakan tipe TEXT agar menampung deskripsi panjang tanpa batasan 255 karakter
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABEL: or_style_relations (Pemetaan No. OR dan Style)
CREATE TABLE IF NOT EXISTS public.or_style_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    or_number TEXT NOT NULL UNIQUE,
    style TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_or_style_number ON public.or_style_relations(or_number);

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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upload_history_or ON public.upload_history(or_number);
CREATE INDEX IF NOT EXISTS idx_upload_history_date ON public.upload_history(update_date);
CREATE INDEX IF NOT EXISTS idx_upload_hist_updated ON public.upload_history(updated_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_mat_req_or ON public.material_requirements(or_number);
CREATE INDEX IF NOT EXISTS idx_mat_req_date ON public.material_requirements(update_date);
CREATE INDEX IF NOT EXISTS idx_mat_req_code ON public.material_requirements(material_code);
CREATE INDEX IF NOT EXISTS idx_mat_req_style ON public.material_requirements(style);

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

  -- Kolom updated_at untuk indikator aktivitas upload_history (Perlindungan Resume Aktif)
  ALTER TABLE IF EXISTS public.upload_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
END $$;

-- Trigger otomatis untuk memperbarui updated_at setiap kali ada aktivitas update pada upload_history
CREATE OR REPLACE FUNCTION public.trg_set_upload_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_upload_history_updated_at ON public.upload_history;
CREATE TRIGGER trg_upload_history_updated_at
BEFORE UPDATE ON public.upload_history
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_upload_history_updated_at();

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

-- 1. or_style_relations
DROP POLICY IF EXISTS "Akses tim or_style_relations" ON public.or_style_relations;
DROP POLICY IF EXISTS "Auth_access_or_style_relations" ON public.or_style_relations;
CREATE POLICY "Auth_access_or_style_relations" ON public.or_style_relations 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- 2. upload_history
DROP POLICY IF EXISTS "Akses tim upload_history" ON public.upload_history;
DROP POLICY IF EXISTS "Auth_access_upload_history" ON public.upload_history 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- 3. material_requirements
DROP POLICY IF EXISTS "Akses tim material_requirements" ON public.material_requirements;
DROP POLICY IF EXISTS "Auth_access_material_requirements" ON public.material_requirements 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- 4. production_schedules
DROP POLICY IF EXISTS "Akses tim production_schedules" ON public.production_schedules;
DROP POLICY IF EXISTS "Auth_access_production_schedules" ON public.production_schedules 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- 5. master_materials
DROP POLICY IF EXISTS "Akses tim master_materials" ON public.master_materials;
DROP POLICY IF EXISTS "Auth_access_master_materials" ON public.master_materials 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- 6. warehouse_stock
DROP POLICY IF EXISTS "Akses tim warehouse_stock" ON public.warehouse_stock;
DROP POLICY IF EXISTS "Auth_access_warehouse_stock" ON public.warehouse_stock 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- 7. deletion_history
DROP POLICY IF EXISTS "Akses tim deletion_history" ON public.deletion_history;
DROP POLICY IF EXISTS "Auth_access_deletion_history" ON public.deletion_history 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- 8. ppic_cleanup_log
CREATE TABLE IF NOT EXISTS public.ppic_cleanup_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    executed_at TIMESTAMPTZ DEFAULT NOW(),
    cutoff_time TIMESTAMPTZ NOT NULL,
    deleted_uploads_count INTEGER NOT NULL DEFAULT 0,
    deleted_materials_count INTEGER NOT NULL DEFAULT 0,
    affected_upload_ids UUID[],
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'SUCCESS'
);
CREATE INDEX IF NOT EXISTS idx_cleanup_log_time ON public.ppic_cleanup_log(executed_at DESC);
ALTER TABLE public.ppic_cleanup_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth_access_ppic_cleanup_log" ON public.ppic_cleanup_log;
CREATE POLICY "Auth_access_ppic_cleanup_log" ON public.ppic_cleanup_log 
    TO authenticated 
    USING (auth.uid() IS NOT NULL) 
    WITH CHECK (auth.uid() IS NOT NULL);

-- ==============================================================================
-- FUNGSI RPC SERVER-SIDE AGGREGATION UNTUK DASHBOARD (BERDASARKAN TANGGAL UPLOAD)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_ppic_dashboard_summary(
    p_or_query TEXT DEFAULT NULL,
    p_upload_date DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
    v_clean_or TEXT := NULLIF(TRIM(p_or_query), '');
    v_date_start TIMESTAMPTZ;
    v_date_end TIMESTAMPTZ;
BEGIN
    IF p_upload_date IS NOT NULL THEN
        v_date_start := (p_upload_date::TEXT || ' 00:00:00+07')::TIMESTAMPTZ;
        v_date_end := (p_upload_date::TEXT || ' 23:59:59.999999+07')::TIMESTAMPTZ;
    END IF;

    -- Menggunakan timestamp upload pada upload_history sebagai sumber tanggal utama melalui upload_id
    WITH filtered_data AS (
        SELECT 
            mr.id,
            mr.or_number,
            mr.style,
            mr.material_code,
            mr.material_name,
            mr.category,
            mr.unit,
            mr.required_qty,
            mr.received_qty,
            GREATEST(0, mr.required_qty - mr.received_qty) AS deficit,
            CASE WHEN mr.received_qty >= mr.required_qty THEN 1 ELSE 0 END AS is_ready,
            COALESCE(uh.created_at, mr.created_at) AS authoritative_upload_at
        FROM public.material_requirements mr
        LEFT JOIN public.upload_history uh ON mr.upload_id = uh.id
        WHERE (v_clean_or IS NULL OR mr.or_number ILIKE '%' || v_clean_or || '%' OR mr.style ILIKE '%' || v_clean_or || '%')
          AND (
            p_upload_date IS NULL OR 
            (COALESCE(uh.created_at, mr.created_at) >= v_date_start AND COALESCE(uh.created_at, mr.created_at) <= v_date_end)
          )
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
-- PENGHAPUSAN OTOMATIS ROLLING 4 HARI (4 x 24 JAM / 96 JAM SEJAK WAKTU UPLOAD)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_uploads_rolling_4days()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '4 days';
    v_target_upload_ids UUID[];
    v_deleted_materials INTEGER := 0;
    v_deleted_uploads INTEGER := 0;
    v_log_id UUID;
BEGIN
    -- 1. Cari upload_history yang berumur > 4 hari (96 jam sejak created_at)
    -- Syarat & Perlindungan Ketat:
    -- - Upload 'Sukses' yang berumur > 96 jam dihapus
    -- - Upload 'Melanjutkan Upload...' atau 'Sedang Berjalan' JANGAN PERNAH dihapus (sedang aktif)
    -- - Upload 'Gagal Sebagian' / 'Gagal' / 'Peringatan' HANYA dihapus jika BENAR-BENAR DITINGGALKAN:
    --   (1) Tidak ada update aktivitas pada upload_history dalam 96 jam terakhir (updated_at < cutoff), DAN
    --   (2) Tidak ada baris material_requirements yang baru ditambahkan/diperbarui dalam 96 jam terakhir
    SELECT ARRAY_AGG(uh.id) INTO v_target_upload_ids
    FROM public.upload_history uh
    WHERE uh.created_at < v_cutoff
      AND uh.id IS NOT NULL
      AND uh.status NOT IN ('Melanjutkan Upload...', 'Sedang Berjalan')
      AND (
          (uh.status = 'Sukses')
          OR
          (
              uh.status IN ('Gagal Sebagian', 'Gagal', 'Peringatan')
              AND COALESCE(uh.updated_at, uh.created_at) < v_cutoff
              AND NOT EXISTS (
                  SELECT 1 
                  FROM public.material_requirements mr 
                  WHERE mr.upload_id = uh.id 
                    AND (COALESCE(mr.updated_at, mr.created_at) >= v_cutoff)
              )
          )
      );

    IF v_target_upload_ids IS NOT NULL AND array_length(v_target_upload_ids, 1) > 0 THEN
        -- 2. Hapus detail material_requirements yang terkait dengan upload_id tersebut terlebih dahulu
        WITH deleted_mats AS (
            DELETE FROM public.material_requirements
            WHERE upload_id = ANY(v_target_upload_ids)
            RETURNING id
        )
        SELECT COUNT(*) INTO v_deleted_materials FROM deleted_mats;

        -- 3. Hapus riwayat upload terkait
        WITH deleted_ups AS (
            DELETE FROM public.upload_history
            WHERE id = ANY(v_target_upload_ids)
            RETURNING id
        )
        SELECT COUNT(*) INTO v_deleted_uploads FROM deleted_ups;
    END IF;

    -- 4. Catat log pembersihan agar proses dapat diverifikasi
    INSERT INTO public.ppic_cleanup_log (
        executed_at,
        cutoff_time,
        deleted_uploads_count,
        deleted_materials_count,
        affected_upload_ids,
        notes,
        status
    ) VALUES (
        NOW(),
        v_cutoff,
        v_deleted_uploads,
        v_deleted_materials,
        v_target_upload_ids,
        CASE 
            WHEN v_deleted_uploads > 0 THEN 'Pembersihan rolling 4 hari berhasil: ' || v_deleted_materials || ' baris material dari ' || v_deleted_uploads || ' sesi upload (> 96 jam) dihapus.'
            ELSE 'Pemeriksaan rutin rolling 4 hari: Tidak ada data berumur > 96 jam yang memenuhi syarat penghapusan.'
        END,
        'SUCCESS'
    ) RETURNING id INTO v_log_id;

    RETURN json_build_object(
        'success', true,
        'log_id', v_log_id,
        'cutoff_time', v_cutoff,
        'deleted_uploads_count', v_deleted_uploads,
        'deleted_materials_count', v_deleted_materials,
        'affected_upload_ids', v_target_upload_ids
    );
EXCEPTION WHEN OTHERS THEN
    -- Catat error ke tabel ppic_cleanup_log
    BEGIN
        INSERT INTO public.ppic_cleanup_log (
            executed_at,
            cutoff_time,
            deleted_uploads_count,
            deleted_materials_count,
            notes,
            status
        ) VALUES (
            NOW(),
            v_cutoff,
            0,
            0,
            'Gagal mengeksekusi rolling 4 hari: ' || SQLERRM,
            'FAILED'
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Lempar kembali exception agar pg_cron mencatat eksekusi sebagai FAILED di cron.job_run_details
    RAISE EXCEPTION 'Cleanup rolling 4 hari gagal: %', SQLERRM;
END;
$$;

-- Cabut seluruh hak EXECUTE dari PUBLIC, anon, dan authenticated untuk keamanan ketat (Mencegah pemanggilan dari browser RPC)
REVOKE ALL ON FUNCTION public.cleanup_old_uploads_rolling_4days() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() FROM authenticated;

-- Berikan izin eksekusi hanya kepada role pemilik/administrator database (postgres dan service_role)
-- pg_cron berjalan secara internal sebagai superuser postgres sehingga tetap dapat mengeksekusi terjadwal
GRANT EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() TO postgres;
GRANT EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() TO service_role;

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
      public.deletion_history,
      public.ppic_cleanup_log;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- ==============================================================================
-- JADWAL CRON OTOMATIS SUPABASE (pg_cron) — ROLLING 4 HARI (SETIAP 15 MENIT)
-- ==============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Bersihkan seluruh jadwal cron lama agar tidak pernah ada duplikasi saat SQL dijalankan berulang
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT jobid FROM cron.job 
        WHERE jobname IN ('ppic_rolling_4days_cleanup_hourly', 'ppic_rolling_4days_cleanup_15min')
    ) LOOP
        BEGIN
            PERFORM cron.unschedule(r.jobid);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;

-- Jadwalkan pembersihan otomatis setiap 15 menit:
SELECT cron.schedule(
    'ppic_rolling_4days_cleanup_15min',
    '*/15 * * * *',
    'SELECT public.cleanup_old_uploads_rolling_4days();'
);

