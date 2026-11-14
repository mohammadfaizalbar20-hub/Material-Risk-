-- ==============================================================================
-- STAGE 2B: ATOMIC SNAPSHOT SYNC RPC FOR PRODUCTION SCHEDULE
-- Sifat migrasi: Non-destruktif (hanya menambah/memperbarui fungsi RPC + izin EXECUTE)
-- Prasyarat: Migrasi Stage 1 (kolom production_schedules.worksheets_snapshot,
--            tabel production_schedule_worksheets, tabel production_schedule_material_snapshots,
--            serta RLS & GRANT role anon) sudah diterapkan.
-- CATATAN: File ini adalah draft migration SQL; JANGAN dijalankan otomatis dari frontend.
-- ==============================================================================

BEGIN;

-- Pastikan kolom snapshot JSONB tersedia (idempotent & non-destruktif)
ALTER TABLE IF EXISTS public.production_schedules
ADD COLUMN IF NOT EXISTS worksheets_snapshot JSONB;

-- ==============================================================================
-- Fungsi RPC: public.sync_production_schedule_snapshots
-- Menjaga konsistensi 4 lapisan penyimpanan dalam SATU transaksi database atomik:
--   1. public.production_schedules.notes ([WORKSHEET_PAYLOAD] atau catatan biasa)
--   2. public.production_schedules.worksheets_snapshot (JSONB array, '[]' jika tanpa PDF)
--   3. public.production_schedule_worksheets (metadata PDF Worksheet ternormalisasi)
--   4. public.production_schedule_material_snapshots (baris material snapshot + row_order)
--
-- Keamanan:
--   - Menggunakan SECURITY INVOKER agar tetap tunduk penuh pada RLS role pemanggil (anon/authenticated)
--     dan tidak membypass kebijakan akses database.
--   - search_path dikunci ke public, pg_temp untuk mencegah search_path hijacking.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.sync_production_schedule_snapshots(
    p_schedule_id UUID,
    p_notes TEXT,
    p_worksheets_snapshot JSONB,
    p_worksheets JSONB,
    p_material_snapshots JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_schedule_prefix TEXT;
    v_ws_snapshot_count INTEGER := 0;
    v_ws_count INTEGER := 0;
    v_mat_count INTEGER := 0;
    v_notes_json JSONB;
    v_ws JSONB;
    v_mat JSONB;
    v_ws_id TEXT;
    v_ws_target NUMERIC;
    v_mat_id TEXT;
    v_mat_ws_id TEXT;
    v_mat_row_order_num NUMERIC;
    v_mat_row_order INTEGER;
    v_mat_pdf_total NUMERIC;
    v_mat_received_qty NUMERIC;
    v_mat_status TEXT;
    v_mat_is_found BOOLEAN;
    v_test_date DATE;
    v_test_ts TIMESTAMPTZ;
    v_raw_date TEXT;
    v_new_ws_ids TEXT[] := ARRAY[]::TEXT[];
    v_new_mat_ids TEXT[] := ARRAY[]::TEXT[];
    v_conflict_id TEXT;
    v_conflict_schedule_id UUID;
    v_mismatch_detail TEXT;
    v_affected_rows INTEGER := 0;
    v_verified_count INTEGER := 0;
BEGIN
    -- --------------------------------------------------------------------------
    -- FASE 1: VALIDASI KETAT SEBELUM MENGUBAH DATA LAMA
    -- --------------------------------------------------------------------------
    IF p_schedule_id IS NULL THEN
        RAISE EXCEPTION 'schedule_id wajib diisi untuk sinkronisasi snapshot.'
            USING ERRCODE = '22023';
    END IF;

    v_schedule_prefix := p_schedule_id::TEXT || '__';

    IF p_worksheets_snapshot IS NULL OR jsonb_typeof(p_worksheets_snapshot) <> 'array' THEN
        RAISE EXCEPTION 'worksheets_snapshot harus berupa JSON array (gunakan [] untuk jadwal tanpa PDF, bukan NULL).'
            USING ERRCODE = '22023';
    END IF;

    IF p_worksheets IS NULL OR jsonb_typeof(p_worksheets) <> 'array' THEN
        RAISE EXCEPTION 'p_worksheets harus berupa JSON array.'
            USING ERRCODE = '22023';
    END IF;

    IF p_material_snapshots IS NULL OR jsonb_typeof(p_material_snapshots) <> 'array' THEN
        RAISE EXCEPTION 'p_material_snapshots harus berupa JSON array.'
            USING ERRCODE = '22023';
    END IF;

    v_ws_snapshot_count := jsonb_array_length(p_worksheets_snapshot);
    v_ws_count := jsonb_array_length(p_worksheets);
    v_mat_count := jsonb_array_length(p_material_snapshots);

    IF v_ws_snapshot_count <> v_ws_count THEN
        RAISE EXCEPTION 'Inkonsistensi jumlah worksheet antara worksheets_snapshot (%) dan data normalized (%).',
            v_ws_snapshot_count, v_ws_count
            USING ERRCODE = '22023';
    END IF;

    IF v_ws_count = 0 AND v_mat_count > 0 THEN
        RAISE EXCEPTION 'Material snapshot tidak boleh dikirim ketika jadwal tidak memiliki Worksheet PDF.'
            USING ERRCODE = '22023';
    END IF;

    -- Validasi Layer 1 (notes) vs Layer 2 (worksheets_snapshot)
    IF v_ws_count > 0 THEN
        IF p_notes IS NULL OR LEFT(p_notes, 19) <> '[WORKSHEET_PAYLOAD]' THEN
            RAISE EXCEPTION 'Kolom notes wajib memuat [WORKSHEET_PAYLOAD] ketika jadwal memiliki Worksheet PDF.'
                USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_notes_json := SUBSTRING(p_notes FROM 20)::JSONB;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Payload JSON pada notes setelah prefix [WORKSHEET_PAYLOAD] tidak valid: %', SQLERRM
                USING ERRCODE = '22023';
        END;

        IF v_notes_json IS NULL OR jsonb_typeof(v_notes_json) <> 'object' THEN
            RAISE EXCEPTION 'Payload JSON pada notes wajib berupa JSON object.'
                USING ERRCODE = '22023';
        END IF;

        IF NOT (v_notes_json ? 'worksheets') OR jsonb_typeof(v_notes_json->'worksheets') <> 'array' THEN
            RAISE EXCEPTION 'Payload JSON pada notes wajib memiliki key "worksheets" bertipe JSON array.'
                USING ERRCODE = '22023';
        END IF;

        IF (v_notes_json->'worksheets') IS DISTINCT FROM p_worksheets_snapshot THEN
            RAISE EXCEPTION 'Inkonsistensi Layer 1 & Layer 2: isi key "worksheets" pada notes tidak identik dengan worksheets_snapshot.'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        IF p_notes IS NOT NULL AND LEFT(p_notes, 19) = '[WORKSHEET_PAYLOAD]' THEN
            RAISE EXCEPTION 'Kolom notes tidak boleh memuat [WORKSHEET_PAYLOAD] ketika jadwal tidak memiliki Worksheet PDF.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Kunci baris jadwal target (FOR UPDATE) dan pastikan jadwal benar-benar ada
    PERFORM 1
    FROM public.production_schedules
    WHERE id = p_schedule_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Jadwal produksi dengan id % tidak ditemukan di Supabase.', p_schedule_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Tolak elemen non-object, ID kosong, atau ID duplikat di p_worksheets_snapshot
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_worksheets_snapshot) s(val)
        WHERE jsonb_typeof(s.val) <> 'object'
           OR NULLIF(TRIM(COALESCE(s.val->>'id', '')), '') IS NULL
    ) THEN
        RAISE EXCEPTION 'Setiap elemen worksheets_snapshot harus berupa JSON object dengan id yang valid.'
            USING ERRCODE = '22023';
    END IF;

    SELECT TRIM(s.val->>'id')
    INTO v_conflict_id
    FROM jsonb_array_elements(p_worksheets_snapshot) s(val)
    GROUP BY TRIM(s.val->>'id')
    HAVING COUNT(*) > 1
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Ditemukan duplikasi Worksheet ID "%" dalam worksheets_snapshot.', v_conflict_id
            USING ERRCODE = '23505';
    END IF;

    -- Tolak elemen non-object, ID kosong, atau ID duplikat di p_worksheets
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_worksheets) w(val)
        WHERE jsonb_typeof(w.val) <> 'object'
           OR NULLIF(TRIM(COALESCE(w.val->>'id', '')), '') IS NULL
    ) THEN
        RAISE EXCEPTION 'Setiap elemen p_worksheets harus berupa JSON object dengan id yang valid.'
            USING ERRCODE = '22023';
    END IF;

    SELECT w.val->>'id'
    INTO v_conflict_id
    FROM jsonb_array_elements(p_worksheets) w(val)
    GROUP BY w.val->>'id'
    HAVING COUNT(*) > 1
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Ditemukan duplikasi Worksheet ID "%" dalam p_worksheets.', v_conflict_id
            USING ERRCODE = '23505';
    END IF;

    -- Tolak elemen non-object, ID kosong, atau ID duplikat di p_material_snapshots
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_material_snapshots) m(val)
        WHERE jsonb_typeof(m.val) <> 'object'
           OR NULLIF(TRIM(COALESCE(m.val->>'id', '')), '') IS NULL
    ) THEN
        RAISE EXCEPTION 'Setiap elemen p_material_snapshots harus berupa JSON object dengan id yang valid.'
            USING ERRCODE = '22023';
    END IF;

    SELECT m.val->>'id'
    INTO v_conflict_id
    FROM jsonb_array_elements(p_material_snapshots) m(val)
    GROUP BY m.val->>'id'
    HAVING COUNT(*) > 1
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Ditemukan duplikasi Material Snapshot ID "%" dalam p_material_snapshots.', v_conflict_id
            USING ERRCODE = '23505';
    END IF;

    -- Validasi setiap elemen Worksheet (format prefix UUID, kolom wajib, numeric & tanggal)
    FOR v_ws IN SELECT value FROM jsonb_array_elements(p_worksheets)
    LOOP
        v_ws_id := v_ws->>'id';

        IF v_ws_id IS DISTINCT FROM TRIM(v_ws_id)
           OR LEFT(v_ws_id, LENGTH(v_schedule_prefix)) <> v_schedule_prefix
           OR LENGTH(TRIM(SUBSTRING(v_ws_id FROM LENGTH(v_schedule_prefix) + 1))) = 0 THEN
            RAISE EXCEPTION 'Kepemilikan Worksheet ID "%" tidak valid: wajib menggunakan prefix UUID jadwal "%".',
                v_ws_id, v_schedule_prefix
                USING ERRCODE = '42501';
        END IF;

        IF NULLIF(TRIM(COALESCE(v_ws->>'file_name', '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_ws->>'or_number', '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_ws->>'style', '')), '') IS NULL THEN
            RAISE EXCEPTION 'Data worksheet "%" tidak valid: file_name, or_number, dan style wajib diisi.', v_ws_id
                USING ERRCODE = '22023';
        END IF;

        BEGIN
            IF NULLIF(TRIM(COALESCE(v_ws->>'schedule_id', '')), '')::UUID IS DISTINCT FROM p_schedule_id THEN
                RAISE EXCEPTION 'schedule_id pada worksheet "%" (%) tidak cocok dengan jadwal target (%).',
                    v_ws_id, v_ws->>'schedule_id', p_schedule_id
                    USING ERRCODE = '42501';
            END IF;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'Format schedule_id pada worksheet "%" bukan UUID yang valid.', v_ws_id
                USING ERRCODE = '22023';
        END;

        BEGIN
            IF (v_ws ? 'target') AND jsonb_typeof(v_ws->'target') NOT IN ('null', 'number', 'string') THEN
                RAISE EXCEPTION 'Target worksheet "%" tidak bertipe angka.', v_ws_id
                    USING ERRCODE = '22023';
            END IF;
            v_ws_target := COALESCE(NULLIF(TRIM(COALESCE(v_ws->>'target', '')), '')::NUMERIC, 0);
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Format target worksheet "%" tidak valid: %', v_ws_id, SQLERRM
                USING ERRCODE = '22023';
        END;

        IF v_ws_target < 0 OR v_ws_target > 999999999999.99 THEN
            RAISE EXCEPTION 'Target worksheet "%" tidak boleh negatif atau melebihi kapasitas kolom.', v_ws_id
                USING ERRCODE = '22023';
        END IF;

        IF (v_ws ? 'matched_upload_date') AND jsonb_typeof(v_ws->'matched_upload_date') NOT IN ('null', 'string') THEN
            RAISE EXCEPTION 'matched_upload_date pada worksheet "%" harus bernilai NULL atau teks ISO YYYY-MM-DD.', v_ws_id
                USING ERRCODE = '22023';
        END IF;

        v_raw_date := NULLIF(TRIM(COALESCE(v_ws->>'matched_upload_date', '')), '');
        IF v_raw_date IS NOT NULL THEN
            IF v_raw_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
                RAISE EXCEPTION 'Format matched_upload_date pada worksheet "%" ("%") tidak valid. Wajib berformat ISO YYYY-MM-DD.',
                    v_ws_id, v_raw_date
                    USING ERRCODE = '22023';
            END IF;
            BEGIN
                v_test_date := v_raw_date::DATE;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'matched_upload_date pada worksheet "%" ("%") bukan tanggal kalender yang valid: %',
                    v_ws_id, v_raw_date, SQLERRM
                    USING ERRCODE = '22023';
            END;
            IF TO_CHAR(v_test_date, 'YYYY-MM-DD') IS DISTINCT FROM v_raw_date THEN
                RAISE EXCEPTION 'matched_upload_date pada worksheet "%" ("%") bukan tanggal kalender yang valid.',
                    v_ws_id, v_raw_date
                    USING ERRCODE = '22023';
            END IF;
        END IF;

        BEGIN
            v_test_ts := NULLIF(TRIM(COALESCE(v_ws->>'matched_upload_created_at', '')), '')::TIMESTAMPTZ;
            v_test_ts := NULLIF(TRIM(COALESCE(v_ws->>'last_synced_at', '')), '')::TIMESTAMPTZ;
            v_test_ts := NULLIF(TRIM(COALESCE(v_ws->>'uploaded_at', '')), '')::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Format tanggal/waktu pada worksheet "%" tidak valid: %', v_ws_id, SQLERRM
                USING ERRCODE = '22023';
        END;
    END LOOP;

    -- Validasi setiap elemen Material Snapshot (prefix, row_order integer, received_qty, status, is_found)
    FOR v_mat IN SELECT value FROM jsonb_array_elements(p_material_snapshots)
    LOOP
        v_mat_id := v_mat->>'id';
        v_mat_ws_id := v_mat->>'worksheet_id';

        IF NULLIF(TRIM(COALESCE(v_mat_ws_id, '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_mat->>'or_number', '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_mat->>'style', '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_mat->>'material_code', '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_mat->>'material_name', '')), '') IS NULL
           OR NULLIF(TRIM(COALESCE(v_mat->>'unit', '')), '') IS NULL THEN
            RAISE EXCEPTION 'Data material snapshot "%" tidak valid: kolom wajib tidak boleh kosong.', v_mat_id
                USING ERRCODE = '22023';
        END IF;

        BEGIN
            IF NULLIF(TRIM(COALESCE(v_mat->>'schedule_id', '')), '')::UUID IS DISTINCT FROM p_schedule_id THEN
                RAISE EXCEPTION 'schedule_id pada material snapshot "%" (%) tidak cocok dengan jadwal target (%).',
                    v_mat_id, v_mat->>'schedule_id', p_schedule_id
                    USING ERRCODE = '42501';
            END IF;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'Format schedule_id pada material snapshot "%" bukan UUID yang valid.', v_mat_id
                USING ERRCODE = '22023';
        END;

        IF LEFT(v_mat_ws_id, LENGTH(v_schedule_prefix)) <> v_schedule_prefix THEN
            RAISE EXCEPTION 'Kepemilikan worksheet_id "%" pada material snapshot "%" tidak cocok dengan jadwal "%".',
                v_mat_ws_id, v_mat_id, p_schedule_id
                USING ERRCODE = '42501';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_worksheets) w
            WHERE w.value->>'id' = v_mat_ws_id
        ) THEN
            RAISE EXCEPTION 'Material snapshot "%" mereferensikan worksheet_id "%" yang tidak ada di payload.',
                v_mat_id, v_mat_ws_id
                USING ERRCODE = '23503';
        END IF;

        -- Validasi row_order: wajib JSON number, bilangan bulat >= 0, dalam rentang INTEGER
        IF NOT (v_mat ? 'row_order') OR jsonb_typeof(v_mat->'row_order') <> 'number' THEN
            RAISE EXCEPTION 'row_order material snapshot "%" wajib berupa angka bilangan bulat >= 0.', v_mat_id
                USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_mat_row_order_num := (v_mat->>'row_order')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'row_order material snapshot "%" tidak dapat dibaca sebagai angka.', v_mat_id
                USING ERRCODE = '22023';
        END;

        IF v_mat_row_order_num <> TRUNC(v_mat_row_order_num)
           OR v_mat_row_order_num < 0
           OR v_mat_row_order_num > 2147483647 THEN
            RAISE EXCEPTION 'row_order material snapshot "%" (%) harus bilangan bulat non-negatif dalam rentang INTEGER.',
                v_mat_id, v_mat->>'row_order'
                USING ERRCODE = '22023';
        END IF;

        v_mat_row_order := v_mat_row_order_num::INTEGER;

        -- Validasi deterministik ID material snapshot: <schedule_uuid>__<raw_ws_id>__<row_order>
        IF v_mat_id IS DISTINCT FROM (v_mat_ws_id || '__' || v_mat_row_order::TEXT) THEN
            RAISE EXCEPTION 'Format ID material snapshot "%" tidak valid: harus "%".',
                v_mat_id, (v_mat_ws_id || '__' || v_mat_row_order::TEXT)
                USING ERRCODE = '42501';
        END IF;

        -- Validasi pdf_total >= 0
        BEGIN
            IF (v_mat ? 'pdf_total') AND jsonb_typeof(v_mat->'pdf_total') NOT IN ('null', 'number', 'string') THEN
                RAISE EXCEPTION 'pdf_total material snapshot "%" tidak bertipe angka.', v_mat_id
                    USING ERRCODE = '22023';
            END IF;
            v_mat_pdf_total := COALESCE(NULLIF(TRIM(COALESCE(v_mat->>'pdf_total', '')), '')::NUMERIC, 0);
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Format pdf_total material snapshot "%" tidak valid: %', v_mat_id, SQLERRM
                USING ERRCODE = '22023';
        END;

        IF v_mat_pdf_total < 0 OR v_mat_pdf_total > 999999999999.99 THEN
            RAISE EXCEPTION 'pdf_total material snapshot "%" tidak boleh bernilai negatif atau melebihi batas.', v_mat_id
                USING ERRCODE = '22023';
        END IF;

        -- Validasi received_qty: NULL atau angka >= 0
        IF NOT (v_mat ? 'received_qty') OR jsonb_typeof(v_mat->'received_qty') = 'null' THEN
            v_mat_received_qty := NULL;
        ELSIF jsonb_typeof(v_mat->'received_qty') <> 'number' THEN
            RAISE EXCEPTION 'received_qty material snapshot "%" harus bernilai NULL atau angka.', v_mat_id
                USING ERRCODE = '22023';
        ELSE
            v_mat_received_qty := (v_mat->>'received_qty')::NUMERIC;
            IF v_mat_received_qty < 0 OR v_mat_received_qty > 999999999999.99 THEN
                RAISE EXCEPTION 'received_qty material snapshot "%" tidak boleh bernilai negatif atau melebihi batas.', v_mat_id
                    USING ERRCODE = '22023';
            END IF;
        END IF;

        -- Validasi status: hanya NULL, 'READY', atau 'BELUM READY'; tolak string kosong eksplisit
        IF NOT (v_mat ? 'status') OR jsonb_typeof(v_mat->'status') = 'null' THEN
            v_mat_status := NULL;
        ELSIF jsonb_typeof(v_mat->'status') <> 'string' THEN
            RAISE EXCEPTION 'status material snapshot "%" harus bernilai NULL atau teks READY / BELUM READY.', v_mat_id
                USING ERRCODE = '22023';
        ELSE
            v_mat_status := v_mat->>'status';
            IF TRIM(v_mat_status) = '' THEN
                RAISE EXCEPTION 'status material snapshot "%" tidak boleh berupa string kosong.', v_mat_id
                    USING ERRCODE = '22023';
            END IF;
            IF v_mat_status NOT IN ('READY', 'BELUM READY') THEN
                RAISE EXCEPTION 'status material snapshot "%" tidak valid ("%"). Nilai yang diizinkan hanya NULL, READY, atau BELUM READY.',
                    v_mat_id, v_mat_status
                    USING ERRCODE = '22023';
            END IF;
        END IF;

        -- Validasi is_found_in_master_data: NULL atau boolean
        IF NOT (v_mat ? 'is_found_in_master_data') OR jsonb_typeof(v_mat->'is_found_in_master_data') = 'null' THEN
            v_mat_is_found := NULL;
        ELSIF jsonb_typeof(v_mat->'is_found_in_master_data') <> 'boolean' THEN
            RAISE EXCEPTION 'is_found_in_master_data material snapshot "%" harus bernilai NULL atau boolean.', v_mat_id
                USING ERRCODE = '22023';
        ELSE
            v_mat_is_found := (v_mat->>'is_found_in_master_data')::BOOLEAN;
        END IF;

        IF v_mat_is_found IS TRUE AND (v_mat_received_qty IS NULL OR v_mat_status IS NULL) THEN
            RAISE EXCEPTION 'Material snapshot "%" dengan is_found_in_master_data = TRUE wajib memiliki received_qty dan status.', v_mat_id
                USING ERRCODE = '22023';
        END IF;

        IF v_mat_is_found IS FALSE AND (v_mat_received_qty IS NOT NULL OR v_mat_status IS NOT NULL) THEN
            RAISE EXCEPTION 'Material snapshot "%" dengan is_found_in_master_data = FALSE wajib memiliki received_qty = NULL dan status = NULL.', v_mat_id
                USING ERRCODE = '22023';
        END IF;

        IF (v_mat_received_qty IS NULL) <> (v_mat_status IS NULL) THEN
            RAISE EXCEPTION 'Inkonsistensi material snapshot "%": received_qty dan status harus sama-sama terisi atau sama-sama NULL.', v_mat_id
                USING ERRCODE = '22023';
        END IF;

        IF (v_mat ? 'matched_upload_date') AND jsonb_typeof(v_mat->'matched_upload_date') NOT IN ('null', 'string') THEN
            RAISE EXCEPTION 'matched_upload_date pada material snapshot "%" harus bernilai NULL atau teks ISO YYYY-MM-DD.', v_mat_id
                USING ERRCODE = '22023';
        END IF;

        v_raw_date := NULLIF(TRIM(COALESCE(v_mat->>'matched_upload_date', '')), '');
        IF v_raw_date IS NOT NULL THEN
            IF v_raw_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
                RAISE EXCEPTION 'Format matched_upload_date pada material snapshot "%" ("%") tidak valid. Wajib berformat ISO YYYY-MM-DD.',
                    v_mat_id, v_raw_date
                    USING ERRCODE = '22023';
            END IF;
            BEGIN
                v_test_date := v_raw_date::DATE;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'matched_upload_date pada material snapshot "%" ("%") bukan tanggal kalender yang valid: %',
                    v_mat_id, v_raw_date, SQLERRM
                    USING ERRCODE = '22023';
            END;
            IF TO_CHAR(v_test_date, 'YYYY-MM-DD') IS DISTINCT FROM v_raw_date THEN
                RAISE EXCEPTION 'matched_upload_date pada material snapshot "%" ("%") bukan tanggal kalender yang valid.',
                    v_mat_id, v_raw_date
                    USING ERRCODE = '22023';
            END IF;
        END IF;

        BEGIN
            v_test_ts := NULLIF(TRIM(COALESCE(v_mat->>'matched_upload_created_at', '')), '')::TIMESTAMPTZ;
            v_test_ts := NULLIF(TRIM(COALESCE(v_mat->>'matched_at', '')), '')::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Format tanggal/waktu pada material snapshot "%" tidak valid: %', v_mat_id, SQLERRM
                USING ERRCODE = '22023';
        END;
    END LOOP;

    -- Pastikan pasangan (worksheet_id, row_order) unik di payload material snapshot
    SELECT (m.val->>'worksheet_id') || ' (row_order=' || ((m.val->>'row_order')::INTEGER)::TEXT || ')'
    INTO v_conflict_id
    FROM jsonb_array_elements(p_material_snapshots) m(val)
    GROUP BY m.val->>'worksheet_id', (m.val->>'row_order')::INTEGER
    HAVING COUNT(*) > 1
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Ditemukan duplikasi pasangan (worksheet_id, row_order) pada material snapshot: %.', v_conflict_id
            USING ERRCODE = '23505';
    END IF;

    -- Validasi struktur materials di dalam worksheets_snapshot dan kesesuaian konten 4 lapisan (WITH ORDINALITY)
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_worksheets_snapshot) s(val)
        WHERE (s.val ? 'materials') AND jsonb_typeof(s.val->'materials') <> 'array'
    ) THEN
        RAISE EXCEPTION 'Field "materials" pada setiap item worksheets_snapshot harus berupa JSON array.'
            USING ERRCODE = '22023';
    END IF;

    -- Validasi ketat tipe JSON, nilai, konsistensi, dan tanggal kalender pada setiap item
    -- worksheets_snapshot[*] dan worksheets_snapshot[*].materials[*] (simetris dengan p_material_snapshots)
    FOR v_ws IN SELECT value FROM jsonb_array_elements(p_worksheets_snapshot)
    LOOP
        v_ws_id := COALESCE(v_ws->>'id', '<NULL>');

        IF (v_ws ? 'matchedUploadDate') AND jsonb_typeof(v_ws->'matchedUploadDate') NOT IN ('null', 'string') THEN
            RAISE EXCEPTION 'matchedUploadDate pada worksheets_snapshot ("%") harus bernilai NULL atau teks ISO YYYY-MM-DD.', v_ws_id
                USING ERRCODE = '22023';
        END IF;

        v_raw_date := NULLIF(TRIM(COALESCE(v_ws->>'matchedUploadDate', '')), '');
        IF v_raw_date IS NOT NULL THEN
            IF v_raw_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
                RAISE EXCEPTION 'Format matchedUploadDate pada worksheets_snapshot "%" ("%") tidak valid. Wajib berformat ISO YYYY-MM-DD.',
                    v_ws_id, v_raw_date
                    USING ERRCODE = '22023';
            END IF;
            BEGIN
                v_test_date := v_raw_date::DATE;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'matchedUploadDate pada worksheets_snapshot "%" ("%") bukan tanggal kalender yang valid: %',
                    v_ws_id, v_raw_date, SQLERRM
                    USING ERRCODE = '22023';
            END;
            IF TO_CHAR(v_test_date, 'YYYY-MM-DD') IS DISTINCT FROM v_raw_date THEN
                RAISE EXCEPTION 'matchedUploadDate pada worksheets_snapshot "%" ("%") bukan tanggal kalender yang valid.',
                    v_ws_id, v_raw_date
                    USING ERRCODE = '22023';
            END IF;
        END IF;

        FOR v_mat IN SELECT value FROM jsonb_array_elements(COALESCE(v_ws->'materials', '[]'::JSONB))
        LOOP
            IF jsonb_typeof(v_mat) <> 'object' THEN
                RAISE EXCEPTION 'Setiap elemen material pada worksheets_snapshot "%" harus berupa JSON object.', v_ws_id
                    USING ERRCODE = '22023';
            END IF;

            -- Validasi strict receivedQty: NULL atau JSON number >= 0 (tolak string/boolean/array/object)
            IF NOT (v_mat ? 'receivedQty') OR jsonb_typeof(v_mat->'receivedQty') = 'null' THEN
                v_mat_received_qty := NULL;
            ELSIF jsonb_typeof(v_mat->'receivedQty') <> 'number' THEN
                RAISE EXCEPTION 'receivedQty material "%" pada worksheets_snapshot "%" harus bernilai NULL atau JSON number (bukan string/boolean/array/object).',
                    COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                    USING ERRCODE = '22023';
            ELSE
                v_mat_received_qty := (v_mat->>'receivedQty')::NUMERIC;
                IF v_mat_received_qty < 0 OR v_mat_received_qty > 999999999999.99 THEN
                    RAISE EXCEPTION 'receivedQty material "%" pada worksheets_snapshot "%" tidak boleh bernilai negatif atau melebihi batas.',
                        COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                        USING ERRCODE = '22023';
                END IF;
            END IF;

            -- Validasi strict status: NULL atau JSON string ('READY' / 'BELUM READY')
            IF NOT (v_mat ? 'status') OR jsonb_typeof(v_mat->'status') = 'null' THEN
                v_mat_status := NULL;
            ELSIF jsonb_typeof(v_mat->'status') <> 'string' THEN
                RAISE EXCEPTION 'status material "%" pada worksheets_snapshot "%" harus bernilai NULL atau teks READY / BELUM READY.',
                    COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                    USING ERRCODE = '22023';
            ELSE
                v_mat_status := v_mat->>'status';
                IF TRIM(v_mat_status) = '' THEN
                    RAISE EXCEPTION 'status material "%" pada worksheets_snapshot "%" tidak boleh berupa string kosong.',
                        COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                        USING ERRCODE = '22023';
                END IF;
                IF v_mat_status NOT IN ('READY', 'BELUM READY') THEN
                    RAISE EXCEPTION 'status material "%" pada worksheets_snapshot "%" tidak valid ("%"). Nilai yang diizinkan hanya NULL, READY, atau BELUM READY.',
                        COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id, v_mat_status
                        USING ERRCODE = '22023';
                END IF;
            END IF;

            -- Validasi strict isFoundInMasterData: NULL (opsional) atau JSON boolean (tolak string/angka/array/object)
            IF NOT (v_mat ? 'isFoundInMasterData') OR jsonb_typeof(v_mat->'isFoundInMasterData') = 'null' THEN
                v_mat_is_found := NULL;
            ELSIF jsonb_typeof(v_mat->'isFoundInMasterData') <> 'boolean' THEN
                RAISE EXCEPTION 'isFoundInMasterData material "%" pada worksheets_snapshot "%" harus bernilai NULL atau JSON boolean (bukan string/angka/array/object).',
                    COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                    USING ERRCODE = '22023';
            ELSE
                v_mat_is_found := (v_mat->>'isFoundInMasterData')::BOOLEAN;
            END IF;

            -- Aturan konsistensi identik dengan p_material_snapshots
            IF v_mat_is_found IS TRUE AND (v_mat_received_qty IS NULL OR v_mat_status IS NULL) THEN
                RAISE EXCEPTION 'Material "%" pada worksheets_snapshot "%" dengan isFoundInMasterData = TRUE wajib memiliki receivedQty dan status.',
                    COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                    USING ERRCODE = '22023';
            END IF;

            IF v_mat_is_found IS FALSE AND (v_mat_received_qty IS NOT NULL OR v_mat_status IS NOT NULL) THEN
                RAISE EXCEPTION 'Material "%" pada worksheets_snapshot "%" dengan isFoundInMasterData = FALSE wajib memiliki receivedQty = NULL dan status = NULL.',
                    COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                    USING ERRCODE = '22023';
            END IF;

            IF (v_mat_received_qty IS NULL) <> (v_mat_status IS NULL) THEN
                RAISE EXCEPTION 'Inkonsistensi material "%" pada worksheets_snapshot "%": receivedQty dan status harus sama-sama terisi atau sama-sama NULL.',
                    COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                    USING ERRCODE = '22023';
            END IF;

            IF (v_mat ? 'matchedUploadDate') AND jsonb_typeof(v_mat->'matchedUploadDate') NOT IN ('null', 'string') THEN
                RAISE EXCEPTION 'matchedUploadDate material "%" pada worksheets_snapshot "%" harus bernilai NULL atau teks ISO YYYY-MM-DD.',
                    COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id
                    USING ERRCODE = '22023';
            END IF;

            v_raw_date := NULLIF(TRIM(COALESCE(v_mat->>'matchedUploadDate', '')), '');
            IF v_raw_date IS NOT NULL THEN
                IF v_raw_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
                    RAISE EXCEPTION 'Format matchedUploadDate material "%" pada worksheets_snapshot "%" ("%") tidak valid. Wajib berformat ISO YYYY-MM-DD.',
                        COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id, v_raw_date
                        USING ERRCODE = '22023';
                END IF;
                BEGIN
                    v_test_date := v_raw_date::DATE;
                EXCEPTION WHEN OTHERS THEN
                    RAISE EXCEPTION 'matchedUploadDate material "%" pada worksheets_snapshot "%" ("%") bukan tanggal kalender yang valid: %',
                        COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id, v_raw_date, SQLERRM
                        USING ERRCODE = '22023';
                END;
                IF TO_CHAR(v_test_date, 'YYYY-MM-DD') IS DISTINCT FROM v_raw_date THEN
                    RAISE EXCEPTION 'matchedUploadDate material "%" pada worksheets_snapshot "%" ("%") bukan tanggal kalender yang valid.',
                        COALESCE(v_mat->>'materialCode', '<NULL>'), v_ws_id, v_raw_date
                        USING ERRCODE = '22023';
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    -- Bandingkan Worksheet Layer 2 (p_worksheets_snapshot) vs Layer 3 (p_worksheets) per posisi
    BEGIN
        SELECT
            'posisi ke-' || COALESCE(s.ord, w.ord)::TEXT
            || ' (snapshot_id=' || COALESCE(s.val->>'id', '<NULL>')
            || ', normalized_id=' || COALESCE(w.val->>'id', '<NULL>') || ')'
        INTO v_mismatch_detail
        FROM jsonb_array_elements(p_worksheets_snapshot) WITH ORDINALITY AS s(val, ord)
        FULL OUTER JOIN jsonb_array_elements(p_worksheets) WITH ORDINALITY AS w(val, ord)
            ON s.ord = w.ord
        WHERE s.val IS NULL
           OR w.val IS NULL
           OR (w.val->>'id') IS DISTINCT FROM (v_schedule_prefix || TRIM(COALESCE(s.val->>'id', '')))
           OR TRIM(COALESCE(w.val->>'file_name', '')) IS DISTINCT FROM TRIM(COALESCE(s.val->>'fileName', ''))
           OR TRIM(COALESCE(w.val->>'or_number', '')) IS DISTINCT FROM TRIM(COALESCE(s.val->>'orNumber', ''))
           OR TRIM(COALESCE(w.val->>'style', '')) IS DISTINCT FROM TRIM(COALESCE(s.val->>'style', ''))
           OR ROUND(COALESCE(NULLIF(TRIM(COALESCE(w.val->>'target', '')), ''), '0')::NUMERIC, 2)
              IS DISTINCT FROM ROUND(COALESCE(NULLIF(TRIM(COALESCE(s.val->>'target', '')), ''), '0')::NUMERIC, 2)
           OR NULLIF(TRIM(COALESCE(w.val->>'matched_upload_id', '')), '')
              IS DISTINCT FROM NULLIF(TRIM(COALESCE(s.val->>'matchedUploadId', '')), '')
           OR NULLIF(TRIM(COALESCE(w.val->>'matched_upload_time', '')), '')
              IS DISTINCT FROM NULLIF(TRIM(COALESCE(s.val->>'matchedUploadTime', '')), '')
           OR NULLIF(TRIM(COALESCE(w.val->>'matched_upload_date', '')), '')::DATE
              IS DISTINCT FROM NULLIF(TRIM(COALESCE(s.val->>'matchedUploadDate', '')), '')::DATE
           OR (
               NULLIF(TRIM(COALESCE(w.val->>'matched_upload_created_at', '')), '')::TIMESTAMPTZ
               IS DISTINCT FROM NULLIF(TRIM(COALESCE(s.val->>'matchedUploadCreatedAt', '')), '')::TIMESTAMPTZ
           )
           OR (
               NULLIF(TRIM(COALESCE(w.val->>'last_synced_at', '')), '')::TIMESTAMPTZ
               IS DISTINCT FROM NULLIF(TRIM(COALESCE(s.val->>'lastSyncedAt', '')), '')::TIMESTAMPTZ
           )
           OR (
               NULLIF(TRIM(COALESCE(s.val->>'uploadedAt', '')), '') IS NOT NULL
               AND NULLIF(TRIM(COALESCE(w.val->>'uploaded_at', '')), '')::TIMESTAMPTZ
                   IS DISTINCT FROM (s.val->>'uploadedAt')::TIMESTAMPTZ
           )
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Gagal membandingkan Worksheet antara worksheets_snapshot dan p_worksheets: %', SQLERRM
            USING ERRCODE = '22023';
    END;

    IF FOUND THEN
        RAISE EXCEPTION 'Inkonsistensi Layer 2 & Layer 3 (Worksheet) pada %.', v_mismatch_detail
            USING ERRCODE = '22023';
    END IF;

    -- Bandingkan Material Layer 2 (worksheets_snapshot.materials) vs Layer 4 (p_material_snapshots)
    -- Mempertahankan kode material duplikat dan urutan baris asli (row_order = mat_ord - 1).
    BEGIN
        WITH expected_materials AS (
            SELECT
                (v_schedule_prefix || TRIM(ws.val->>'id')) AS expected_worksheet_id,
                TRIM(ws.val->>'orNumber') AS expected_or_number,
                TRIM(ws.val->>'style') AS expected_style,
                NULLIF(TRIM(COALESCE(ws.val->>'matchedUploadId', '')), '') AS ws_matched_upload_id,
                NULLIF(TRIM(COALESCE(ws.val->>'lastSyncedAt', '')), '') AS ws_last_synced_at,
                (mat_ord - 1)::INTEGER AS expected_row_order,
                (v_schedule_prefix || TRIM(ws.val->>'id') || '__' || (mat_ord - 1)::TEXT) AS expected_mat_id,
                mat.val AS snap_mat
            FROM jsonb_array_elements(p_worksheets_snapshot) WITH ORDINALITY AS ws(val, ws_ord)
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ws.val->'materials', '[]'::JSONB)) WITH ORDINALITY AS mat(val, mat_ord)
        ),
        actual_materials AS (
            SELECT
                m.val AS norm_mat
            FROM jsonb_array_elements(p_material_snapshots) m(val)
        )
        SELECT
            'worksheet_id=' || COALESCE(e.expected_worksheet_id, a.norm_mat->>'worksheet_id', '<NULL>')
            || ', row_order=' || COALESCE(e.expected_row_order::TEXT, a.norm_mat->>'row_order', '<NULL>')
            || ', material_code=' || COALESCE(e.snap_mat->>'materialCode', a.norm_mat->>'material_code', '<NULL>')
        INTO v_mismatch_detail
        FROM expected_materials e
        FULL OUTER JOIN actual_materials a
            ON e.expected_worksheet_id = (a.norm_mat->>'worksheet_id')
           AND e.expected_row_order = (a.norm_mat->>'row_order')::INTEGER
        WHERE e.snap_mat IS NULL
           OR a.norm_mat IS NULL
           OR e.expected_mat_id IS DISTINCT FROM (a.norm_mat->>'id')
           OR e.expected_or_number IS DISTINCT FROM TRIM(COALESCE(a.norm_mat->>'or_number', ''))
           OR e.expected_style IS DISTINCT FROM TRIM(COALESCE(a.norm_mat->>'style', ''))
           OR TRIM(COALESCE(e.snap_mat->>'materialCode', '')) IS DISTINCT FROM TRIM(COALESCE(a.norm_mat->>'material_code', ''))
           OR TRIM(COALESCE(e.snap_mat->>'materialName', '')) IS DISTINCT FROM TRIM(COALESCE(a.norm_mat->>'material_name', ''))
           OR TRIM(COALESCE(e.snap_mat->>'unit', '')) IS DISTINCT FROM TRIM(COALESCE(a.norm_mat->>'unit', ''))
           OR ROUND(COALESCE(NULLIF(TRIM(COALESCE(e.snap_mat->>'total', '')), ''), '0')::NUMERIC, 2)
              IS DISTINCT FROM ROUND(COALESCE(NULLIF(TRIM(COALESCE(a.norm_mat->>'pdf_total', '')), ''), '0')::NUMERIC, 2)
           OR (
               (e.snap_mat->'receivedQty' IS NULL OR jsonb_typeof(e.snap_mat->'receivedQty') = 'null')
               <>
               (a.norm_mat->'received_qty' IS NULL OR jsonb_typeof(a.norm_mat->'received_qty') = 'null')
           )
           OR (
               e.snap_mat->'receivedQty' IS NOT NULL
               AND jsonb_typeof(e.snap_mat->'receivedQty') <> 'null'
               AND ROUND((e.snap_mat->>'receivedQty')::NUMERIC, 2)
                   IS DISTINCT FROM ROUND((a.norm_mat->>'received_qty')::NUMERIC, 2)
           )
           OR (e.snap_mat->>'status') IS DISTINCT FROM (a.norm_mat->>'status')
           OR (
               (e.snap_mat ? 'isFoundInMasterData')
               AND jsonb_typeof(e.snap_mat->'isFoundInMasterData') = 'boolean'
               AND (
                   NOT (a.norm_mat ? 'is_found_in_master_data')
                   OR jsonb_typeof(a.norm_mat->'is_found_in_master_data') <> 'boolean'
                   OR (e.snap_mat->>'isFoundInMasterData')::BOOLEAN
                       IS DISTINCT FROM (a.norm_mat->>'is_found_in_master_data')::BOOLEAN
               )
           )
           OR COALESCE(NULLIF(TRIM(COALESCE(e.snap_mat->>'matchedUploadId', '')), ''), e.ws_matched_upload_id)
              IS DISTINCT FROM NULLIF(TRIM(COALESCE(a.norm_mat->>'matched_upload_id', '')), '')
           OR NULLIF(TRIM(COALESCE(a.norm_mat->>'matched_upload_date', '')), '')::DATE
              IS DISTINCT FROM NULLIF(TRIM(COALESCE(e.snap_mat->>'matchedUploadDate', '')), '')::DATE
           OR NULLIF(TRIM(COALESCE(e.snap_mat->>'matchedUploadTime', '')), '')
              IS DISTINCT FROM NULLIF(TRIM(COALESCE(a.norm_mat->>'matched_upload_time', '')), '')
           OR (
               NULLIF(TRIM(COALESCE(e.snap_mat->>'matchedUploadCreatedAt', '')), '')::TIMESTAMPTZ
               IS DISTINCT FROM NULLIF(TRIM(COALESCE(a.norm_mat->>'matched_upload_created_at', '')), '')::TIMESTAMPTZ
           )
           OR (
               NULLIF(TRIM(COALESCE(e.snap_mat->>'matchedAt', '')), '') IS NOT NULL
               AND NULLIF(TRIM(COALESCE(a.norm_mat->>'matched_at', '')), '')::TIMESTAMPTZ
                   IS DISTINCT FROM (e.snap_mat->>'matchedAt')::TIMESTAMPTZ
           )
           OR (
               NULLIF(TRIM(COALESCE(e.snap_mat->>'matchedAt', '')), '') IS NULL
               AND e.ws_last_synced_at IS NOT NULL
               AND NULLIF(TRIM(COALESCE(a.norm_mat->>'matched_at', '')), '')::TIMESTAMPTZ
                   IS DISTINCT FROM e.ws_last_synced_at::TIMESTAMPTZ
           )
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Gagal membandingkan Material Snapshot antara worksheets_snapshot dan p_material_snapshots: %', SQLERRM
            USING ERRCODE = '22023';
    END;

    IF FOUND THEN
        RAISE EXCEPTION 'Inkonsistensi Layer 2 & Layer 4 (Material Snapshot) pada %.', v_mismatch_detail
            USING ERRCODE = '22023';
    END IF;

    -- Kumpulkan daftar ID baru untuk validasi kepemilikan DB dan pembersihan baris usang
    IF v_ws_count > 0 THEN
        SELECT COALESCE(ARRAY_AGG(w.value->>'id'), ARRAY[]::TEXT[])
        INTO v_new_ws_ids
        FROM jsonb_array_elements(p_worksheets) w;

        -- Tolak jika ID Worksheet sudah dimiliki oleh schedule_id lain di database
        SELECT w.id, w.schedule_id
        INTO v_conflict_id, v_conflict_schedule_id
        FROM public.production_schedule_worksheets w
        WHERE w.id = ANY(v_new_ws_ids)
          AND w.schedule_id IS DISTINCT FROM p_schedule_id
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION 'Konflik kepemilikan: Worksheet ID "%" sudah dimiliki oleh jadwal lain (%).',
                v_conflict_id, v_conflict_schedule_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_mat_count > 0 THEN
        SELECT COALESCE(ARRAY_AGG(m.value->>'id'), ARRAY[]::TEXT[])
        INTO v_new_mat_ids
        FROM jsonb_array_elements(p_material_snapshots) m;

        -- Tolak jika ID Material Snapshot sudah dimiliki oleh schedule_id lain di database
        SELECT ms.id, ms.schedule_id
        INTO v_conflict_id, v_conflict_schedule_id
        FROM public.production_schedule_material_snapshots ms
        WHERE (
            ms.id = ANY(v_new_mat_ids)
            OR ms.worksheet_id = ANY(v_new_ws_ids)
        )
          AND ms.schedule_id IS DISTINCT FROM p_schedule_id
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION 'Konflik kepemilikan: Material Snapshot ID "%" sudah dimiliki oleh jadwal lain (%).',
                v_conflict_id, v_conflict_schedule_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- --------------------------------------------------------------------------
    -- FASE 2: SIMPAN DATA PENGGANTI TERLEBIH DAHULU (DALAM TRANSAKSI YANG SAMA)
    -- Tidak mengubah schedule_id saat ON CONFLICT, menjaga ownership guard WHERE,
    -- serta memverifikasi ROW_COUNT dan kepemilikan pasca-UPSERT.
    -- --------------------------------------------------------------------------
    IF v_ws_count > 0 THEN
        INSERT INTO public.production_schedule_worksheets (
            id,
            schedule_id,
            file_name,
            or_number,
            style,
            target,
            matched_upload_id,
            matched_upload_date,
            matched_upload_time,
            matched_upload_created_at,
            last_synced_at,
            uploaded_at
        )
        SELECT
            w.value->>'id',
            p_schedule_id,
            TRIM(w.value->>'file_name'),
            TRIM(w.value->>'or_number'),
            TRIM(w.value->>'style'),
            ROUND(COALESCE(NULLIF(TRIM(COALESCE(w.value->>'target', '')), ''), '0')::NUMERIC, 2),
            NULLIF(TRIM(COALESCE(w.value->>'matched_upload_id', '')), ''),
            NULLIF(TRIM(COALESCE(w.value->>'matched_upload_date', '')), '')::DATE,
            NULLIF(TRIM(COALESCE(w.value->>'matched_upload_time', '')), ''),
            NULLIF(TRIM(COALESCE(w.value->>'matched_upload_created_at', '')), '')::TIMESTAMPTZ,
            NULLIF(TRIM(COALESCE(w.value->>'last_synced_at', '')), '')::TIMESTAMPTZ,
            COALESCE(NULLIF(TRIM(COALESCE(w.value->>'uploaded_at', '')), '')::TIMESTAMPTZ, NOW())
        FROM jsonb_array_elements(p_worksheets) w
        ON CONFLICT (id) DO UPDATE SET
            file_name = EXCLUDED.file_name,
            or_number = EXCLUDED.or_number,
            style = EXCLUDED.style,
            target = EXCLUDED.target,
            matched_upload_id = EXCLUDED.matched_upload_id,
            matched_upload_date = EXCLUDED.matched_upload_date,
            matched_upload_time = EXCLUDED.matched_upload_time,
            matched_upload_created_at = EXCLUDED.matched_upload_created_at,
            last_synced_at = EXCLUDED.last_synced_at,
            uploaded_at = EXCLUDED.uploaded_at
        WHERE public.production_schedule_worksheets.schedule_id = p_schedule_id;

        GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
        IF v_affected_rows <> v_ws_count THEN
            RAISE EXCEPTION 'UPSERT Worksheet ditolak oleh ownership guard: diharapkan % baris tersimpan, aktual %.',
                v_ws_count, v_affected_rows
                USING ERRCODE = '42501';
        END IF;

        SELECT COUNT(*)
        INTO v_verified_count
        FROM public.production_schedule_worksheets w
        WHERE w.schedule_id = p_schedule_id
          AND w.id = ANY(v_new_ws_ids);

        IF v_verified_count <> v_ws_count THEN
            RAISE EXCEPTION 'Verifikasi pasca-UPSERT Worksheet gagal: diharapkan % baris milik jadwal %, ditemukan %.',
                v_ws_count, p_schedule_id, v_verified_count
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_mat_count > 0 THEN
        INSERT INTO public.production_schedule_material_snapshots (
            id,
            schedule_id,
            worksheet_id,
            row_order,
            or_number,
            style,
            material_code,
            material_name,
            unit,
            pdf_total,
            received_qty,
            status,
            is_found_in_master_data,
            matched_upload_id,
            matched_upload_date,
            matched_upload_time,
            matched_upload_created_at,
            matched_at
        )
        SELECT
            m.value->>'id',
            p_schedule_id,
            m.value->>'worksheet_id',
            (m.value->>'row_order')::INTEGER,
            TRIM(m.value->>'or_number'),
            TRIM(m.value->>'style'),
            TRIM(m.value->>'material_code'),
            TRIM(m.value->>'material_name'),
            TRIM(m.value->>'unit'),
            ROUND(COALESCE(NULLIF(TRIM(COALESCE(m.value->>'pdf_total', '')), ''), '0')::NUMERIC, 2),
            CASE
                WHEN NOT (m.value ? 'received_qty') OR jsonb_typeof(m.value->'received_qty') = 'null'
                    THEN NULL
                ELSE ROUND((m.value->>'received_qty')::NUMERIC, 2)
            END,
            CASE
                WHEN NOT (m.value ? 'status') OR jsonb_typeof(m.value->'status') = 'null'
                    THEN NULL
                ELSE m.value->>'status'
            END,
            CASE
                WHEN (m.value ? 'is_found_in_master_data')
                     AND jsonb_typeof(m.value->'is_found_in_master_data') = 'boolean'
                    THEN (m.value->>'is_found_in_master_data')::BOOLEAN
                ELSE (m.value ? 'received_qty') AND jsonb_typeof(m.value->'received_qty') <> 'null'
            END,
            NULLIF(TRIM(COALESCE(m.value->>'matched_upload_id', '')), ''),
            NULLIF(TRIM(COALESCE(m.value->>'matched_upload_date', '')), '')::DATE,
            NULLIF(TRIM(COALESCE(m.value->>'matched_upload_time', '')), ''),
            NULLIF(TRIM(COALESCE(m.value->>'matched_upload_created_at', '')), '')::TIMESTAMPTZ,
            COALESCE(NULLIF(TRIM(COALESCE(m.value->>'matched_at', '')), '')::TIMESTAMPTZ, NOW())
        FROM jsonb_array_elements(p_material_snapshots) m
        ON CONFLICT (id) DO UPDATE SET
            worksheet_id = EXCLUDED.worksheet_id,
            row_order = EXCLUDED.row_order,
            or_number = EXCLUDED.or_number,
            style = EXCLUDED.style,
            material_code = EXCLUDED.material_code,
            material_name = EXCLUDED.material_name,
            unit = EXCLUDED.unit,
            pdf_total = EXCLUDED.pdf_total,
            received_qty = EXCLUDED.received_qty,
            status = EXCLUDED.status,
            is_found_in_master_data = EXCLUDED.is_found_in_master_data,
            matched_upload_id = EXCLUDED.matched_upload_id,
            matched_upload_date = EXCLUDED.matched_upload_date,
            matched_upload_time = EXCLUDED.matched_upload_time,
            matched_upload_created_at = EXCLUDED.matched_upload_created_at,
            matched_at = EXCLUDED.matched_at
        WHERE public.production_schedule_material_snapshots.schedule_id = p_schedule_id;

        GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
        IF v_affected_rows <> v_mat_count THEN
            RAISE EXCEPTION 'UPSERT Material Snapshot ditolak oleh ownership guard: diharapkan % baris tersimpan, aktual %.',
                v_mat_count, v_affected_rows
                USING ERRCODE = '42501';
        END IF;

        SELECT COUNT(*)
        INTO v_verified_count
        FROM public.production_schedule_material_snapshots ms
        WHERE ms.schedule_id = p_schedule_id
          AND ms.id = ANY(v_new_mat_ids);

        IF v_verified_count <> v_mat_count THEN
            RAISE EXCEPTION 'Verifikasi pasca-UPSERT Material Snapshot gagal: diharapkan % baris milik jadwal %, ditemukan %.',
                v_mat_count, p_schedule_id, v_verified_count
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- --------------------------------------------------------------------------
    -- FASE 3: BERSIHKAN BARIS LAMA YANG SUDAH TIDAK TERPAKAI
    -- Hanya dieksekusi setelah seluruh upsert pengganti dan verifikasi berhasil.
    -- --------------------------------------------------------------------------
    DELETE FROM public.production_schedule_material_snapshots
    WHERE schedule_id = p_schedule_id
      AND (
          cardinality(v_new_mat_ids) = 0
          OR NOT (id = ANY(v_new_mat_ids))
      );

    DELETE FROM public.production_schedule_worksheets
    WHERE schedule_id = p_schedule_id
      AND (
          cardinality(v_new_ws_ids) = 0
          OR NOT (id = ANY(v_new_ws_ids))
      );

    SELECT COUNT(*)
    INTO v_verified_count
    FROM public.production_schedule_worksheets
    WHERE schedule_id = p_schedule_id;

    IF v_verified_count <> v_ws_count THEN
        RAISE EXCEPTION 'Verifikasi akhir jumlah Worksheet milik jadwal % gagal (% <> %).',
            p_schedule_id, v_verified_count, v_ws_count
            USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*)
    INTO v_verified_count
    FROM public.production_schedule_material_snapshots
    WHERE schedule_id = p_schedule_id;

    IF v_verified_count <> v_mat_count THEN
        RAISE EXCEPTION 'Verifikasi akhir jumlah Material Snapshot milik jadwal % gagal (% <> %).',
            p_schedule_id, v_verified_count, v_mat_count
            USING ERRCODE = '42501';
    END IF;

    -- --------------------------------------------------------------------------
    -- FASE 4: PERBARUI LAPISAN 1 (notes) & LAPISAN 2 (worksheets_snapshot)
    -- Konsisten dengan tabel normalized dalam transaksi yang sama.
    -- --------------------------------------------------------------------------
    UPDATE public.production_schedules
    SET
        notes = p_notes,
        worksheets_snapshot = p_worksheets_snapshot,
        updated_at = NOW()
    WHERE id = p_schedule_id;

    GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
    IF v_affected_rows <> 1 THEN
        RAISE EXCEPTION 'Gagal memperbarui notes & worksheets_snapshot pada jadwal % (baris terpengaruh: %).',
            p_schedule_id, v_affected_rows
            USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'schedule_id', p_schedule_id,
        'worksheets_count', v_ws_count,
        'material_snapshots_count', v_mat_count
    );
END;
$$;

-- Hak eksekusi minimum yang dibutuhkan aplikasi (anon key tanpa login & authenticated)
REVOKE ALL ON FUNCTION public.sync_production_schedule_snapshots(UUID, TEXT, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_production_schedule_snapshots(UUID, TEXT, JSONB, JSONB, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.sync_production_schedule_snapshots(UUID, TEXT, JSONB, JSONB, JSONB) TO authenticated;

COMMIT;
