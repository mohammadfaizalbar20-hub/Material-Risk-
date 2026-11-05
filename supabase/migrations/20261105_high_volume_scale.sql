-- ==============================================================================
-- MIGRASI OPTIMASI HIGH-VOLUME DATABASE PPIC (SKALA 20.000+ BARIS/HARI / JUTAAN BARIS)
-- 1. Index Komposit Berkecepatan Tinggi untuk Pencarian & Filter Instan
-- 2. Fungsi RPC Server-Side Aggregation untuk Dashboard Cepat tanpa Mengunduh Jutaan Baris
-- 3. Fungsi RPC Database Storage Monitoring untuk Memantau Kapasitas & Pertumbuhan Data Riil
-- ==============================================================================

-- 1. INDEX OPTIMIZATION (HIGH-THROUGHPUT B-TREE INDEXES)
CREATE INDEX IF NOT EXISTS idx_mat_req_or_date ON public.material_requirements(or_number, update_date DESC);
CREATE INDEX IF NOT EXISTS idx_mat_req_upload_id ON public.material_requirements(upload_id);
CREATE INDEX IF NOT EXISTS idx_mat_req_category ON public.material_requirements(category);
CREATE INDEX IF NOT EXISTS idx_mat_req_created ON public.material_requirements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mat_req_imported ON public.material_requirements(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_hist_date_or ON public.upload_history(update_date DESC, or_number);
CREATE INDEX IF NOT EXISTS idx_upload_hist_created ON public.upload_history(created_at DESC);

-- 2. SERVER-SIDE AGGREGATION RPC FUNCTION UNTUK DASHBOARD
-- Menghitung metrik analitik langsung di PostgreSQL dalam milidetik tanpa membebani browser
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

-- 3. MONITORING KAPASITAS & ESTIMASI DATABASE STORAGE RPC
-- Mengambil metrik autentik ukuran penyimpanan database PostgreSQL Supabase
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
    -- Ukuran database keseluruhan
    SELECT pg_database_size(current_database()) INTO v_db_size;

    -- Ukuran tabel inti PPIC
    SELECT pg_total_relation_size('public.material_requirements') INTO v_req_table_size;
    SELECT pg_total_relation_size('public.upload_history') INTO v_hist_table_size;

    -- Jumlah baris aktual
    SELECT COUNT(*) INTO v_total_rows FROM public.material_requirements;
    SELECT COUNT(*) INTO v_hist_count FROM public.upload_history;
    SELECT COUNT(*) INTO v_or_count FROM public.or_style_relations;
    SELECT COUNT(*) INTO v_mat_count FROM public.master_materials;

    -- Estimasi ukuran rata-rata baris
    IF v_total_rows > 0 AND v_req_table_size > 0 THEN
        v_avg_row_bytes := ROUND((v_req_table_size::NUMERIC / v_total_rows::NUMERIC), 1);
    ELSE
        v_avg_row_bytes := 350; -- Default estimasi ~350 bytes per baris material
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
