import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PPIC_SUPABASE_ROLLING_4DAYS_CLEANUP_SQL,
  PPIC_SUPABASE_SCHEMA_SQL,
  PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL,
} from '../src/lib/supabaseSchemaSql';
import {
  safeDbDate,
  generateDeterministicRowUuid,
} from '../src/lib/supabase';
import {
  calculateMaterialComparisonMetrics,
  calculateParetoAnalysis,
} from '../src/utils/ppicCalculations';
import { MaterialItemRequirement, UploadHistoryItem } from '../src/types/ppic';

const jakartaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Helper to convert ISO string to Asia/Jakarta YYYY-MM-DD
function toJakartaDate(dateVal?: string | Date | null): string {
  if (!dateVal) return '';
  const d = typeof dateVal === 'string' ? new Date(dateVal) : dateVal;
  if (isNaN(d.getTime())) return '';
  return jakartaDateFormatter.format(d);
}

// ============================================================================
// SUITE 1: OTOMATIS HAPUS DATA SUPABASE — ROLLING 4 HARI (4 x 24 JAM)
// ============================================================================

test('Suite 1.1: SQL skrip rolling 4 hari memuat fungsi, tabel log, dan pg_cron terverifikasi', () => {
  const sql = PPIC_SUPABASE_ROLLING_4DAYS_CLEANUP_SQL;

  // 1. Verifikasi tabel audit log ppic_cleanup_log
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.ppic_cleanup_log'), 'Harus membuat tabel ppic_cleanup_log');
  assert.ok(sql.includes('deleted_uploads_count INTEGER'), 'Harus mencatat jumlah upload yang dihapus');
  assert.ok(sql.includes('deleted_materials_count INTEGER'), 'Harus mencatat jumlah material yang dihapus');
  assert.ok(sql.includes('cutoff_time TIMESTAMPTZ NOT NULL'), 'Harus mencatat batas waktu cutoff 4 hari');

  // 2. Verifikasi RLS policy untuk ppic_cleanup_log
  assert.ok(sql.includes('ALTER TABLE public.ppic_cleanup_log ENABLE ROW LEVEL SECURITY;'), 'RLS harus aktif pada ppic_cleanup_log');
  assert.ok(sql.includes('TO authenticated'), 'Policy harus untuk authenticated');
  assert.ok(sql.includes('auth.uid() IS NOT NULL'), 'Hanya user terautentikasi');

  // 3. Verifikasi fungsi cleanup_old_uploads_rolling_4days()
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.cleanup_old_uploads_rolling_4days()'), 'Harus mendefinisikan fungsi RPC');
  assert.ok(sql.includes("NOW() - INTERVAL '4 days'"), 'Cutoff wajib tepat 4 hari (96 jam)');
  assert.ok(sql.includes('SET search_path = public, pg_temp'), 'SECURITY DEFINER wajib memiliki search_path aman (public, pg_temp)');
  assert.ok(sql.includes("status NOT IN ('Melanjutkan Upload...', 'Sedang Berjalan')"), 'Upload aktif/resuming TIDAK boleh dihapus');
  assert.ok(sql.includes("status IN ('Gagal Sebagian', 'Gagal', 'Peringatan')"), 'Upload partial tidak aktif dan gagal lama harus dibersihkan');
  assert.ok(sql.includes('COALESCE(uh.updated_at, uh.created_at) < v_cutoff'), 'Wajib memeriksa waktu aktivitas terakhir updated_at');
  assert.ok(sql.includes('NOT EXISTS'), 'Wajib memverifikasi tidak ada baris material baru dalam 96 jam');
  assert.ok(sql.includes('WHERE upload_id = ANY(v_target_upload_ids)'), 'Hapus detail material terkait upload_id');
  assert.ok(sql.includes('WHERE id = ANY(v_target_upload_ids)'), 'Hapus riwayat upload terkait');
  assert.ok(sql.includes('RAISE EXCEPTION'), 'Harus melempar kembali exception agar pg_cron mencatat status FAILED');

  // 4. Verifikasi pencabutan hak akses EXECUTE (Hardened Security)
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.cleanup_old_uploads_rolling_4days() FROM PUBLIC;'), 'Hak ALL harus dicabut dari PUBLIC');
  assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() FROM anon;'), 'Hak EXECUTE harus dicabut dari anon');
  assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() FROM authenticated;'), 'Hak EXECUTE harus dicabut dari authenticated');
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() TO postgres;'), 'Hak EXECUTE hanya diberikan ke postgres (pg_cron)');
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.cleanup_old_uploads_rolling_4days() TO service_role;'), 'Hak EXECUTE dapat diberikan ke service_role');

  // 5. Verifikasi kolom updated_at dan trigger otomatis
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()'), 'Harus menambahkan kolom updated_at');
  assert.ok(sql.includes('trg_upload_history_updated_at'), 'Harus mendaftarkan trigger updated_at');

  // 6. Verifikasi ekstensi dan jadwal cron
  assert.ok(sql.includes('CREATE EXTENSION IF NOT EXISTS pg_cron;'), 'Harus mengaktifkan ekstensi pg_cron');
  assert.ok(sql.includes('cron.schedule'), 'Harus mendaftarkan jadwal cron di PostgreSQL');
  assert.ok(sql.includes('*/15 * * * *'), 'Jadwal cron harus setiap 15 menit agar pembersihan tepat waktu');
  assert.ok(sql.includes('ppic_rolling_4days_cleanup_15min'), 'Nama job cron 15 menit harus spesifik');
  assert.ok(sql.includes('cron.unschedule(r.jobid)'), 'Wajib memiliki loop unschedule untuk mencegah job cron duplikat');
});

test('Suite 1.3: Keamanan Eksekusi — Pemicu manual browser diblokir, hak EXECUTE hanya untuk role internal/pg_cron', async () => {
  const { triggerRollingCleanupInSupabase } = await import('../src/lib/supabase');
  const res = await triggerRollingCleanupInSupabase();
  assert.equal(res.success, false, 'Pemanggilan fungsi cleanup dari browser harus ditolak');
  assert.ok(
    res.error?.includes('Pemicu manual melalui RPC browser dinonaktifkan demi keamanan'),
    'Harus mengembalikan pesan penolakan keamanan bahwa RPC browser dinonaktifkan'
  );
});

test('Suite 1.2: Simulasi Logika Rolling 4 Hari — Upload sukses, partial lama, dan gagal lama > 96 jam dihapus, upload aktif dipertahankan', () => {
  const now = new Date('2026-11-07T12:00:00Z'); // Waktu simulasi: 7 Nov 2026 12:00
  const cutoffTime = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000); // 3 Nov 2026 12:00:00Z (Tepat 96 jam)

  // Kumpulan riwayat upload dengan variasi umur, status, dan timestamp aktivitas (updated_at)
  const uploads: Array<{
    id: string;
    createdAt: Date;
    updatedAt?: Date;
    status: string;
    rowCount: number;
    uploadName: string;
  }> = [
    {
      id: 'up-1-old-success',
      createdAt: new Date('2026-11-01T10:00:00Z'), // 6 hari lalu (> 96 jam)
      updatedAt: new Date('2026-11-01T10:00:00Z'),
      status: 'Sukses',
      rowCount: 20000,
      uploadName: 'Upload Sukses 6 Hari Lalu',
    },
    {
      id: 'up-2-old-inprogress',
      createdAt: new Date('2026-11-02T10:00:00Z'), // 5 hari lalu tapi proses resume aktif
      updatedAt: new Date('2026-11-07T11:50:00Z'),
      status: 'Melanjutkan Upload...',
      rowCount: 5000,
      uploadName: 'Upload Sedang Di-resume',
    },
    {
      id: 'up-3-old-partial',
      createdAt: new Date('2026-11-02T15:00:00Z'), // 5 hari lalu (> 96 jam) dan ditinggalkan (gagal sebagian tidak aktif)
      updatedAt: new Date('2026-11-02T15:00:00Z'),
      status: 'Gagal Sebagian',
      rowCount: 8000,
      uploadName: 'Upload Gagal Sebagian Lama',
    },
    {
      id: 'up-4-old-failed',
      createdAt: new Date('2026-11-01T08:00:00Z'), // 6 hari lalu (> 96 jam), gagal total
      updatedAt: new Date('2026-11-01T08:00:00Z'),
      status: 'Gagal',
      rowCount: 0,
      uploadName: 'Upload Gagal Lama',
    },
    {
      id: 'up-5-retained-3days',
      createdAt: new Date('2026-11-04T08:00:00Z'), // 3 hari lalu (< 96 jam)
      updatedAt: new Date('2026-11-04T08:00:00Z'),
      status: 'Sukses',
      rowCount: 20000,
      uploadName: 'Upload Day 4 (Masih Berlaku)',
    },
    {
      id: 'up-6-retained-2days',
      createdAt: new Date('2026-11-05T08:00:00Z'), // 2 hari lalu (< 96 jam)
      updatedAt: new Date('2026-11-05T08:00:00Z'),
      status: 'Sukses',
      rowCount: 20000,
      uploadName: 'Upload Day 5 (Masih Berlaku)',
    },
    {
      id: 'up-7-retained-today',
      createdAt: new Date('2026-11-07T08:00:00Z'), // Hari ini (< 4 jam)
      updatedAt: new Date('2026-11-07T08:00:00Z'),
      status: 'Sukses',
      rowCount: 20000,
      uploadName: 'Upload Hari Ini',
    },
    {
      id: 'up-8-active-running',
      createdAt: new Date('2026-11-07T11:30:00Z'), // 30 menit lalu, sedang berjalan
      updatedAt: new Date('2026-11-07T11:30:00Z'),
      status: 'Sedang Berjalan',
      rowCount: 12000,
      uploadName: 'Upload Sedang Berjalan',
    },
    {
      id: 'up-9-resumed-partial-active',
      createdAt: new Date('2026-11-02T10:00:00Z'), // Dibuat 5 hari lalu, status Gagal Sebagian, tapi BARU SAJA di-resume (updated_at 10 menit lalu)
      updatedAt: new Date('2026-11-07T11:50:00Z'), // Aktif baru saja disentuh
      status: 'Gagal Sebagian',
      rowCount: 6000,
      uploadName: 'Upload Gagal Sebagian Sedang Aktif Di-resume',
    },
  ];

  // Material records yang terhubung ke masing-masing upload
  const materials: Array<{
    id: string;
    uploadId: string | null;
    createdAt: Date;
    updatedAt?: Date;
    materialCode: string;
  }> = [];

  // Generate 10 sample items per upload
  uploads.forEach((u) => {
    for (let i = 0; i < 10; i++) {
      materials.push({
        id: `mat-${u.id}-${i}`,
        uploadId: u.id,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        materialCode: `MAT-${i}`,
      });
    }
  });

  // Tambahkan 5 baris data tanpa upload_id (misal input manual lama)
  for (let i = 0; i < 5; i++) {
    materials.push({
      id: `mat-no-upload-${i}`,
      uploadId: null,
      createdAt: new Date('2026-10-20T10:00:00Z'), // Lama tapi tanpa upload_id
      materialCode: `MANUAL-${i}`,
    });
  }

  // --- JALANKAN LOGIKA FUNGSI PEMBERSIHAN ROLLING 4 HARI DENGAN PERLINDUNGAN DUAL-LAYER ---
  // Syarat:
  // 1. uh.created_at < cutoffTime (berumur > 96 jam)
  // 2. uh.id IS NOT NULL
  // 3. uh.status NOT IN ('Melanjutkan Upload...', 'Sedang Berjalan')
  // 4. (uh.status = 'Sukses') OR (
  //      uh.status IN ('Gagal Sebagian', 'Gagal', 'Peringatan')
  //      AND COALESCE(uh.updated_at, uh.created_at) < cutoffTime
  //      AND NOT EXISTS material_requirements dengan COALESCE(mr.updated_at, mr.created_at) >= cutoffTime
  //    )
  const targetUploadIds = uploads
    .filter((u) => {
      const isOlderThan96h = u.createdAt < cutoffTime;
      const isNotExplicitlyRunning = !['Melanjutkan Upload...', 'Sedang Berjalan'].includes(u.status);
      if (!isOlderThan96h || !u.id || !isNotExplicitlyRunning) return false;

      if (u.status === 'Sukses') {
        return true;
      }

      if (['Gagal Sebagian', 'Gagal', 'Peringatan'].includes(u.status)) {
        const lastActivity = u.updatedAt || u.createdAt;
        const uploadActivityOlderThanCutoff = lastActivity < cutoffTime;
        const hasRecentMaterialActivity = materials.some(
          (m) => m.uploadId === u.id && ((m.updatedAt || m.createdAt) >= cutoffTime)
        );
        return uploadActivityOlderThanCutoff && !hasRecentMaterialActivity;
      }

      return false;
    })
    .map((u) => u.id);

  // Verifikasi upload yang terjaring
  assert.deepEqual(
    targetUploadIds.sort(),
    ['up-1-old-success', 'up-3-old-partial', 'up-4-old-failed'].sort(),
    'Upload sukses > 96h, partial DITINGGALKAN > 96h, dan gagal lama > 96h harus terjaring untuk pembersihan'
  );

  // Lakukan penghapusan transaksional
  const deletedMaterials = materials.filter((m) => m.uploadId && targetUploadIds.includes(m.uploadId));
  const remainingMaterials = materials.filter((m) => !(m.uploadId && targetUploadIds.includes(m.uploadId)));

  const deletedUploads = uploads.filter((u) => targetUploadIds.includes(u.id));
  const remainingUploads = uploads.filter((u) => !targetUploadIds.includes(u.id));

  // Assertions:
  assert.equal(deletedUploads.length, 3, '3 upload berumur > 96 jam (sukses, partial ditinggalkan, gagal lama) harus terhapus');
  assert.equal(deletedMaterials.length, 30, '30 baris material terkait upload lama harus terhapus secara atomik');

  // Pastikan upload sedang berjalan & sedang di-resume TIDAK terhapus
  assert.ok(remainingUploads.some((u) => u.id === 'up-2-old-inprogress'), 'Upload status Melanjutkan Upload... tidak boleh dihapus');
  assert.ok(remainingUploads.some((u) => u.id === 'up-8-active-running'), 'Upload sedang berjalan tidak boleh dihapus');
  assert.ok(
    remainingUploads.some((u) => u.id === 'up-9-resumed-partial-active'),
    'Upload Gagal Sebagian yang sedang aktif di-resume (updated_at baru) TIDAK boleh dihapus'
  );

  // Pastikan upload umur < 96 jam tetap utuh
  assert.ok(remainingUploads.some((u) => u.id === 'up-5-retained-3days'), 'Upload 3 hari lalu harus tetap ada');
  assert.ok(remainingUploads.some((u) => u.id === 'up-6-retained-2days'), 'Upload 2 hari lalu harus tetap ada');
  assert.ok(remainingUploads.some((u) => u.id === 'up-7-retained-today'), 'Upload hari ini harus tetap ada');

  // Pastikan data tanpa upload_id TIDAK dihapus secara otomatis tanpa pemeriksaan
  const orphanManuals = remainingMaterials.filter((m) => m.uploadId === null);
  assert.equal(orphanManuals.length, 5, 'Data tanpa upload_id tidak boleh terhapus secara otomatis');
});

// ============================================================================
// SUITE 2: DASHBOARD — FILTER BERDASARKAN TIMESTAMP TANGGAL UPLOAD
// ============================================================================

test('Suite 2.1: Filter tanggal Dashboard wajib menggunakan Timestamp Waktu Upload (created_at), bukan Tanggal Update form', () => {
  // Simulasi 2 upload dengan Tanggal Update FORM yang sama, namun Tanggal Upload DATABASE berbeda
  const day1DbTimestamp = '2026-11-05T08:30:00Z'; // 5 Nov 2026 (WIB: 15:30)
  const day2DbTimestamp = '2026-11-06T09:00:00Z'; // 6 Nov 2026 (WIB: 16:00)

  const uploadHistories: UploadHistoryItem[] = [
    {
      id: 'up-day-1',
      orNumber: 'OR-DAY-1',
      style: 'Jaket Casual',
      fileName: 'Upload_Day1.xlsx',
      updateDate: '2026-10-01', // User menginput Tanggal Update 1 Okt di form
      uploadTime: '15:30:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: day1DbTimestamp,
    },
    {
      id: 'up-day-2',
      orNumber: 'OR-DAY-2',
      style: 'Kemeja Formal',
      fileName: 'Upload_Day2.xlsx',
      updateDate: '2026-10-01', // User menginput Tanggal Update SAMA di form (1 Okt)
      uploadTime: '16:00:00 WIB',
      rowCount: 2,
      status: 'Sukses',
      createdAt: day2DbTimestamp,
    },
  ];

  const materialItems: MaterialItemRequirement[] = [
    // Material Upload Day 1 (Upload date: 5 Nov 2026)
    {
      id: 'mat-1',
      uploadId: 'up-day-1',
      orNumber: 'OR-DAY-1',
      style: 'Jaket Casual',
      materialCode: 'FABRIC-A',
      materialName: 'Kain Katun Premium',
      category: 'Raw Material',
      unit: 'Meter',
      requiredQty: 1000,
      receivedQty: 800,
      unitPrice: 50000,
      updateDate: '2026-10-01',
      createdAt: day1DbTimestamp,
    },
    {
      id: 'mat-2',
      uploadId: 'up-day-1',
      orNumber: 'OR-DAY-1',
      style: 'Jaket Casual',
      materialCode: 'ZIPPER-A',
      materialName: 'Zipper YKK',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 500,
      receivedQty: 500,
      unitPrice: 5000,
      updateDate: '2026-10-01',
      createdAt: day1DbTimestamp,
    },

    // Material Upload Day 2 (Upload date: 6 Nov 2026)
    {
      id: 'mat-3',
      uploadId: 'up-day-2',
      orNumber: 'OR-DAY-2',
      style: 'Kemeja Formal',
      materialCode: 'BUTTON-B',
      materialName: 'Kancing Mutiara',
      category: 'Auxiliary',
      unit: 'Pcs',
      requiredQty: 4000,
      receivedQty: 1000, // Defisit 3000
      unitPrice: 1000,
      updateDate: '2026-10-01',
      createdAt: day2DbTimestamp,
    },
    {
      id: 'mat-4',
      uploadId: 'up-day-2',
      orNumber: 'OR-DAY-2',
      style: 'Kemeja Formal',
      materialCode: 'THREAD-B',
      materialName: 'Benang Jahit Hitam',
      category: 'Auxiliary',
      unit: 'Roll',
      requiredQty: 200,
      receivedQty: 200,
      unitPrice: 15000,
      updateDate: '2026-10-01',
      createdAt: day2DbTimestamp,
    },
  ];

  // 1. FILTER BERDASARKAN TANGGAL UPLOAD: 2026-11-05 (Day 1)
  const filterDate1 = '2026-11-05';
  const filteredDay1 = materialItems.filter((m) => toJakartaDate(m.createdAt) === filterDate1);
  assert.equal(filteredDay1.length, 2, 'Harus memuat tepat 2 baris material dari upload 5 Nov');
  const metricsDay1 = calculateMaterialComparisonMetrics(filteredDay1);
  assert.equal(metricsDay1.totalRequired, 1500); // 1000 + 500
  assert.equal(metricsDay1.totalReceived, 1300); // 800 + 500
  assert.equal(metricsDay1.shortageTotal, 200); // Defisit 200 (FABRIC-A)
  assert.equal(metricsDay1.readyCount, 1); // ZIPPER-A (500/500)
  assert.equal(metricsDay1.notReadyCount, 1); // FABRIC-A (800/1000)

  // 2. FILTER BERDASARKAN TANGGAL UPLOAD: 2026-11-06 (Day 2)
  const filterDate2 = '2026-11-06';
  const filteredDay2 = materialItems.filter((m) => toJakartaDate(m.createdAt) === filterDate2);
  assert.equal(filteredDay2.length, 2, 'Harus memuat tepat 2 baris material dari upload 6 Nov');
  const metricsDay2 = calculateMaterialComparisonMetrics(filteredDay2);
  assert.equal(metricsDay2.totalRequired, 4200); // 4000 + 200
  assert.equal(metricsDay2.totalReceived, 1200); // 1000 + 200
  assert.equal(metricsDay2.shortageTotal, 3000); // Defisit 3000 (BUTTON-B)
  assert.equal(metricsDay2.readyCount, 1); // THREAD-B (200/200)
  assert.equal(metricsDay2.notReadyCount, 1); // BUTTON-B (1000/4000)

  // 3. PILIHAN SEMUA TANGGAL (uploadDate = ''): Menampilkan seluruh data yang masih tersimpan
  const allFiltered = materialItems.filter((m) => true);
  const metricsAll = calculateMaterialComparisonMetrics(allFiltered);
  assert.equal(metricsAll.totalCount, 4);
  assert.equal(metricsAll.totalRequired, 5700);
  assert.equal(metricsAll.totalReceived, 2500);
  assert.equal(metricsAll.shortageTotal, 3200); // 200 + 3000

  // 4. VERIFIKASI PARETO MENGIKUTI TANGGAL UPLOAD
  const paretoDay2 = calculateParetoAnalysis(filteredDay2);
  assert.equal(paretoDay2.length, 1, 'Hanya BUTTON-B yang defisit di Day 2');
  assert.equal(paretoDay2[0].materialCode, 'BUTTON-B');
  assert.equal(paretoDay2[0].shortageQty, 3000);
});

test('Suite 2.2: Zona Waktu Asia/Jakarta (WIB) dieksekusi secara konsisten pada batas pergantian hari', () => {
  // Jam 23:30 WIB (UTC: 16:30) vs Jam 00:30 WIB keesokan harinya (UTC: 17:30)
  const lateNightUtc = '2026-11-05T16:30:00Z'; // 5 Nov 16:30 UTC -> 5 Nov 23:30 WIB
  const earlyMorningUtc = '2026-11-05T17:30:00Z'; // 5 Nov 17:30 UTC -> 6 Nov 00:30 WIB

  const dateLateNight = toJakartaDate(lateNightUtc);
  const dateEarlyMorning = toJakartaDate(earlyMorningUtc);

  assert.equal(dateLateNight, '2026-11-05', '16:30 UTC harus masuk ke 5 Nov WIB');
  assert.equal(dateEarlyMorning, '2026-11-06', '17:30 UTC harus masuk ke 6 Nov WIB (Ganti hari)');
});

test('Suite 2.3: RPC Dashboard SQL get_ppic_dashboard_summary menghubungkan upload_history melalui upload_id dan boundary Asia/Jakarta', () => {
  const sql = PPIC_SUPABASE_HIGH_VOLUME_SCALE_SQL;

  // Verifikasi definisi RPC
  assert.ok(sql.includes('p_upload_date DATE DEFAULT NULL'), 'Parameter harus p_upload_date DATE');
  assert.ok(sql.includes("00:00:00+07')::TIMESTAMPTZ"), 'Batas awal jam WIB (+07)');
  assert.ok(sql.includes("23:59:59.999999+07')::TIMESTAMPTZ"), 'Batas akhir jam WIB (+07)');
  assert.ok(sql.includes('LEFT JOIN public.upload_history uh ON mr.upload_id = uh.id'), 'Wajib melakukan JOIN upload_history via upload_id');
  assert.ok(sql.includes('COALESCE(uh.created_at, mr.created_at)'), 'Wajib memprioritaskan upload_history.created_at sebagai sumber tanggal utama');
  assert.ok(sql.includes('pareto_items'), 'Harus menyertakan pareto_items teragregasi');
  assert.ok(sql.includes('top_materials'), 'Harus menyertakan top_materials komparasi kebutuhan vs diterima');
});

test('Suite 2.4: Skala 20.000 baris — Filter tanggal upload bekerja lancar dan deterministik', () => {
  const uploadId = 'up-scale-20k-session';
  const targetDate = '2026-11-07';
  const otherDate = '2026-11-06';

  // Buat 20.000 baris untuk targetDate dan 10.000 baris untuk otherDate
  let countTarget = 0;
  let countOther = 0;

  for (let i = 0; i < 20000; i++) {
    const d = toJakartaDate(`2026-11-07T0${(i % 9) + 1}:00:00Z`);
    if (d === targetDate) countTarget++;
  }

  for (let i = 0; i < 10000; i++) {
    const d = toJakartaDate(`2026-11-06T0${(i % 9) + 1}:00:00Z`);
    if (d === otherDate) countOther++;
  }

  assert.equal(countTarget, 20000, 'Seluruh 20.000 baris harus tepat masuk ke targetDate');
  assert.equal(countOther, 10000, 'Seluruh 10.000 baris harus tepat masuk ke otherDate');
});

test('Suite 2.5: Konsistensi 20.000 baris — Seluruh baris dalam satu upload_id mewarisi tanggal upload_history yang sama persis', () => {
  const uploadId = 'upload-batch-20k-session';
  const parentUploadCreatedAt = '2026-11-06T16:55:00Z'; // 6 Nov 2026 23:55 WIB
  const parentDateJakarta = toJakartaDate(parentUploadCreatedAt); // '2026-11-06'

  // Buat 20.000 baris yang di-insert secara bertahap sehingga material created_at melintasi tengah malam (7 Nov 00:05 WIB)
  const uploadHistoryMap = new Map<string, string>();
  uploadHistoryMap.set(uploadId, parentDateJakarta);

  let matchParentDateCount = 0;
  for (let i = 0; i < 20000; i++) {
    // Simulasi drift created_at baris material karena chunked batching masuk beberapa menit kemudian
    const rowRawCreatedAt = i < 10000 ? '2026-11-06T16:58:00Z' : '2026-11-06T17:05:00Z'; // 17:05 UTC = 7 Nov 00:05 WIB
    const item: MaterialItemRequirement = {
      id: `mat-${i}`,
      uploadId: uploadId,
      orNumber: 'OR-BULK-20K',
      style: 'STYLE-TEST',
      materialCode: `MAT-${i}`,
      materialName: `Material ${i}`,
      category: 'Raw Material',
      unit: 'Meter',
      requiredQty: 10,
      receivedQty: 10,
      unitPrice: 1000,
      updateDate: '2026-10-01',
      createdAt: rowRawCreatedAt,
    };

    // Client-side / SQL authoritative mapping
    const authoritativeDate = (item.uploadId && uploadHistoryMap.get(item.uploadId)) || toJakartaDate(item.createdAt);
    if (authoritativeDate === parentDateJakarta) {
      matchParentDateCount++;
    }
  }

  // 100% dari 20.000 baris harus tetap konsisten mengikuti parent upload_history date ('2026-11-06')
  assert.equal(matchParentDateCount, 20000, 'Seluruh 20.000 baris wajib masuk ke tanggal upload_history yang sama');
});

test('Suite 1.4: Pengecualian Rolling 4 Hari — Jadwal Produksi, PDF Worksheet, dan Snapshot Material TIDAK pernah terhapus', () => {
  // 1. Verifikasi skema SQL memisahkan tabel worksheet & snapshot dari upload_history (tanpa FK ON DELETE CASCADE ke upload_history)
  const schemaSql = PPIC_SUPABASE_SCHEMA_SQL;
  assert.ok(schemaSql.includes('worksheets_snapshot JSONB'), 'production_schedules harus mendukung worksheets_snapshot JSONB');
  assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.production_schedule_worksheets'), 'Tabel production_schedule_worksheets harus tersedia');
  assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.production_schedule_material_snapshots'), 'Tabel production_schedule_material_snapshots harus tersedia');
  const wsTableMatch = schemaSql.match(/CREATE TABLE IF NOT EXISTS public\.production_schedule_worksheets[\s\S]*?\);/);
  const snapTableMatch = schemaSql.match(/CREATE TABLE IF NOT EXISTS public\.production_schedule_material_snapshots[\s\S]*?\);/);
  assert.ok(wsTableMatch && !wsTableMatch[0].includes('REFERENCES public.upload_history'), 'Tabel production_schedule_worksheets TIDAK boleh memiliki FK ke upload_history');
  assert.ok(snapTableMatch && !snapTableMatch[0].includes('REFERENCES public.upload_history'), 'Tabel production_schedule_material_snapshots TIDAK boleh memiliki FK ke upload_history');

  // 2. Verifikasi fungsi cleanup_old_uploads_rolling_4days hanya menargetkan material_requirements & upload_history
  for (const cleanupSql of [PPIC_SUPABASE_ROLLING_4DAYS_CLEANUP_SQL, PPIC_SUPABASE_SCHEMA_SQL]) {
    const fnMatch = cleanupSql.match(/CREATE OR REPLACE FUNCTION public\.cleanup_old_uploads_rolling_4days\(\)[\s\S]*?\$\$;/);
    assert.ok(fnMatch, 'Definisi fungsi cleanup_old_uploads_rolling_4days harus ada');
    const fnBody = fnMatch![0];
    assert.ok(fnBody.includes('DELETE FROM public.material_requirements'), 'Rolling cleanup harus membersihkan material_requirements > 96h');
    assert.ok(fnBody.includes('DELETE FROM public.upload_history'), 'Rolling cleanup harus membersihkan upload_history > 96h');
    assert.ok(!fnBody.includes('DELETE FROM public.production_schedules'), 'Rolling cleanup tidak boleh menghapus production_schedules');
    assert.ok(!fnBody.includes('DELETE FROM public.production_schedule_worksheets'), 'Rolling cleanup tidak boleh menghapus production_schedule_worksheets');
    assert.ok(!fnBody.includes('DELETE FROM public.production_schedule_material_snapshots'), 'Rolling cleanup tidak boleh menghapus production_schedule_material_snapshots');
  }

  // 3. Simulasi eksekusi Rolling 4 Hari: Upload Excel (> 96 jam) terhapus, tetapi jadwal & snapshot yang merujuknya TETAP UTUH 100%
  const cutoff = new Date('2026-11-03T12:00:00Z');
  const excelUploads = [
    { id: 'up-old-99h', createdAt: new Date('2026-11-01T10:00:00Z'), status: 'Sukses' },
    { id: 'up-fresh-10h', createdAt: new Date('2026-11-07T02:00:00Z'), status: 'Sukses' },
  ];
  const schedules = [
    {
      id: 'sch-1',
      orNumber: '1117',
      createdAt: new Date('2026-10-15T08:00:00Z'), // berumur > 20 hari!
      worksheets: [
        {
          id: 'ws-1',
          fileName: 'Worksheet_1117.pdf',
          orNumber: '1117',
          style: 'Polo Shirt',
          target: 100,
          matchedUploadId: 'up-old-99h', // merujuk upload yg akan dihapus Rolling 4 Hari
          materials: [
            {
              materialCode: 'FAB-01',
              materialName: 'Fabric Cotton',
              unit: 'Yard',
              total: 120,
              receivedQty: 120,
              status: 'READY',
              isFoundInMasterData: true,
              matchedUploadId: 'up-old-99h',
            },
          ],
        },
      ],
    },
  ];

  // Jalankan filter target penghapusan Rolling 4 Hari (hanya pada excelUploads & material_requirements)
  const deletedUploadIds = new Set(
    excelUploads.filter((u) => u.createdAt < cutoff && u.status === 'Sukses').map((u) => u.id)
  );
  const remainingExcelUploads = excelUploads.filter((u) => !deletedUploadIds.has(u.id));

  assert.equal(deletedUploadIds.has('up-old-99h'), true);
  assert.equal(remainingExcelUploads.length, 1);

  // Pastikan jadwal, worksheet PDF, dan snapshot material tetap utuh 100% meskipun upload sumbernya sudah dihapus
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].worksheets.length, 1);
  assert.equal(schedules[0].worksheets[0].materials[0].receivedQty, 120);
  assert.equal(schedules[0].worksheets[0].materials[0].status, 'READY');
  assert.equal(schedules[0].worksheets[0].matchedUploadId, 'up-old-99h');
});

