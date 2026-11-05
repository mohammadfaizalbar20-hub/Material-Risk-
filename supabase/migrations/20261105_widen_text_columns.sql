-- ==============================================================================
-- MIGRASI AMAN UNTUK MEMPERBAIKI ERROR "value too long for type character varying(255)"
-- Mengubah seluruh kolom teks menjadi TEXT agar menampung deskripsi Style, OR, 
-- Nama Material, dan Nama File yang panjang tanpa memotong data sedikitpun.
-- Aman dijalankan pada database yang sudah berisi data (non-destruktif).
-- ==============================================================================

-- 1. or_style_relations
ALTER TABLE IF EXISTS public.or_style_relations ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.or_style_relations ALTER COLUMN style TYPE TEXT;

-- 2. upload_history
ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN style TYPE TEXT;
ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN file_name TYPE TEXT;
ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN status TYPE TEXT;
ALTER TABLE IF EXISTS public.upload_history ALTER COLUMN upload_time TYPE TEXT;

-- 3. material_requirements
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN style TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN material_code TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN material_name TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN category TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN unit TYPE TEXT;
ALTER TABLE IF EXISTS public.material_requirements ALTER COLUMN supplier_name TYPE TEXT;

-- 4. production_schedules
ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN or_number TYPE TEXT;
ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN style TYPE TEXT;
ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN production_line TYPE TEXT;
ALTER TABLE IF EXISTS public.production_schedules ALTER COLUMN status TYPE TEXT;

-- 5. master_materials
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN code TYPE TEXT;
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN name TYPE TEXT;
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN category TYPE TEXT;
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN unit TYPE TEXT;
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN supplier_name TYPE TEXT;
ALTER TABLE IF EXISTS public.master_materials ALTER COLUMN default_warehouse TYPE TEXT;

-- 6. warehouse_stock
ALTER TABLE IF EXISTS public.warehouse_stock ALTER COLUMN material_code TYPE TEXT;
ALTER TABLE IF EXISTS public.warehouse_stock ALTER COLUMN warehouse_id TYPE TEXT;
ALTER TABLE IF EXISTS public.warehouse_stock ALTER COLUMN location_rack TYPE TEXT;

-- 7. deletion_history
ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN timestamp TYPE TEXT;
ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN method TYPE TEXT;
ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN method_label TYPE TEXT;
ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN target_value TYPE TEXT;
ALTER TABLE IF EXISTS public.deletion_history ALTER COLUMN operator_user TYPE TEXT;
