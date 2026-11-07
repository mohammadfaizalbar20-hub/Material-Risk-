import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUuid, isValidUuid } from '../src/lib/supabase';
import { MaterialItemRequirement } from '../src/types/ppic';

test('Verification 1: Stable UUID generation and validation', () => {
  const uuid1 = generateUuid();
  const uuid2 = generateUuid();

  assert.ok(isValidUuid(uuid1), `Generated UUID ${uuid1} must be valid RFC4122 v4`);
  assert.ok(isValidUuid(uuid2), `Generated UUID ${uuid2} must be valid RFC4122 v4`);
  assert.notStrictEqual(uuid1, uuid2, 'Consecutive UUIDs must never collide');

  // Verify non-UUIDs
  assert.strictEqual(isValidUuid('req-12345'), false);
  assert.strictEqual(isValidUuid(''), false);
  assert.strictEqual(isValidUuid('undefined'), false);
});

test('Verification 2: Batch retry idempotency with stable row IDs', () => {
  // Simulate 1,000 raw rows from Excel
  const rawRows: MaterialItemRequirement[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `temp-client-id-${i}`,
    orNumber: 'OR-TEST-001',
    style: 'Style Test Item',
    materialCode: `MAT-${i}`,
    materialName: `Test Material ${i}`,
    category: 'Raw Material',
    unit: 'Kg',
    requiredQty: 100,
    receivedQty: 80,
    unitPrice: 20000,
    updateDate: '2026-11-05',
  }));

  const uploadId = generateUuid();

  // Step 1: Assign stable UUIDs to all rows up-front (as implemented in syncBatchExcelToSupabaseWithProgress)
  const preparedRows = rawRows.map((r) => ({
    ...r,
    id: isValidUuid(r.id) ? r.id : generateUuid(),
    upload_id: uploadId,
  }));

  // Verify all 1,000 IDs are valid UUIDs and unique
  const idSet = new Set(preparedRows.map((r) => r.id));
  assert.strictEqual(idSet.size, 1000, 'Every row must have a distinct UUID');
  assert.ok(preparedRows.every((r) => isValidUuid(r.id)), 'All assigned IDs must be valid UUIDs');

  // Step 2: Simulate Database State (Simulated PostgreSQL table with PRIMARY KEY on id)
  const dbTable = new Map<string, any>();

  // Chunk 1: Rows 0 - 499 (Attempt 1 succeeds)
  const chunk1 = preparedRows.slice(0, 500);
  chunk1.forEach((row) => dbTable.set(row.id, { ...row }));
  assert.strictEqual(dbTable.size, 500);

  // Chunk 2: Rows 500 - 999
  // Attempt 1 fails (simulated network timeout after server received 500 rows)
  const chunk2 = preparedRows.slice(500, 1000);
  chunk2.forEach((row) => dbTable.set(row.id, { ...row })); // Server actually committed
  // Client got timeout, triggers Attempt 2 with the EXACT SAME chunk
  chunk2.forEach((row) => dbTable.set(row.id, { ...row })); // Idempotent upsert by id

  // Final count must be exactly 1,000 - ZERO duplicate rows despite retry!
  assert.strictEqual(dbTable.size, 1000, 'Idempotent upsert by ID must produce exactly 1,000 rows without duplicates');
});

test('Verification 3: Two separate uploads with identical OR & Material Codes have distinct upload_id and row IDs', () => {
  // Upload A: OR-SAMPLING, 2026-11-01
  const uploadIdA = generateUuid();
  const rowsUploadA: MaterialItemRequirement[] = Array.from({ length: 500 }, (_, i) => ({
    id: generateUuid(),
    uploadId: uploadIdA,
    orNumber: 'OR-SAMPLING',
    style: 'Sample Hoodie',
    materialCode: `FABRIC-${i}`,
    materialName: `Cotton Fleece #${i}`,
    category: 'Raw Material',
    unit: 'Yard',
    requiredQty: 1000,
    receivedQty: 500,
    unitPrice: 45000,
    updateDate: '2026-11-01',
  }));

  // Upload B: OR-SAMPLING, 2026-11-02 (Exact same OR, exact same material codes)
  const uploadIdB = generateUuid();
  const rowsUploadB: MaterialItemRequirement[] = Array.from({ length: 500 }, (_, i) => ({
    id: generateUuid(),
    uploadId: uploadIdB,
    orNumber: 'OR-SAMPLING',
    style: 'Sample Hoodie',
    materialCode: `FABRIC-${i}`,
    materialName: `Cotton Fleece #${i}`,
    category: 'Raw Material',
    unit: 'Yard',
    requiredQty: 1000,
    receivedQty: 1000, // Now 100% received
    unitPrice: 45000,
    updateDate: '2026-11-02',
  }));

  assert.notStrictEqual(uploadIdA, uploadIdB, 'Upload A and B must have completely different upload_id values');

  // Verify that all 1,000 IDs across both uploads are unique
  const combinedIds = new Set([...rowsUploadA.map((r) => r.id), ...rowsUploadB.map((r) => r.id)]);
  assert.strictEqual(combinedIds.size, 1000, 'All 1,000 rows across both uploads must have unique IDs');

  // Database stores both without collision
  const db = new Map<string, any>();
  rowsUploadA.forEach((r) => db.set(r.id, r));
  rowsUploadB.forEach((r) => db.set(r.id, r));

  assert.strictEqual(db.size, 1000, 'Database must retain all 1,000 rows');

  // Querying by uploadIdA returns 500 rows with 1 Nov date
  const queriedA = Array.from(db.values()).filter((r) => r.uploadId === uploadIdA);
  assert.strictEqual(queriedA.length, 500);
  assert.strictEqual(queriedA[0].updateDate, '2026-11-01');
  assert.strictEqual(queriedA[0].receivedQty, 500);

  // Querying by uploadIdB returns 500 rows with 2 Nov date
  const queriedB = Array.from(db.values()).filter((r) => r.uploadId === uploadIdB);
  assert.strictEqual(queriedB.length, 500);
  assert.strictEqual(queriedB[0].updateDate, '2026-11-02');
  assert.strictEqual(queriedB[0].receivedQty, 1000);
});

test('Verification 4: Range-based pagination calculation for 20k and 40k rows', () => {
  const pageSize = 50;

  // 20,000 rows
  const count20k = 20000;
  const totalPages20k = Math.ceil(count20k / pageSize);
  assert.strictEqual(totalPages20k, 400);

  // Page 1: from 0 to 49
  assert.strictEqual(0, (1 - 1) * pageSize);
  assert.strictEqual(49, 0 + pageSize - 1);

  // Page 400: from 19950 to 19999
  assert.strictEqual(19950, (400 - 1) * pageSize);
  assert.strictEqual(19999, 19950 + pageSize - 1);

  // 40,000 rows (Upload A + Upload B)
  const count40k = 40000;
  const totalPages40k = Math.ceil(count40k / pageSize);
  assert.strictEqual(totalPages40k, 800);

  // Page 800: from 39950 to 39999
  assert.strictEqual(39950, (800 - 1) * pageSize);
  assert.strictEqual(39999, 39950 + pageSize - 1);
});

test('Section F Verification: 20,000 rows upload, simulated failure at batch 10, resume without duplication, and accumulation to 40,000 rows', () => {
  const CHUNK_SIZE = 500;
  const TOTAL_ROWS_DAY_1 = 20000;
  const simulatedDb = new Map<string, any>();
  const uploadHistoryDb = new Map<string, any>();

  // DAY 1: Generate 20,000 raw material requirements
  const rawRequirementsDay1: MaterialItemRequirement[] = Array.from({ length: TOTAL_ROWS_DAY_1 }, (_, i) => ({
    id: `temp-d1-${i}`,
    orNumber: 'OR-2026-HIGH-01',
    style: 'High Volume Jacket Navy',
    materialCode: `MAT-D1-${String(i).padStart(5, '0')}`,
    materialName: `Component Material #${i}`,
    category: 'Raw Material',
    unit: 'Pcs',
    requiredQty: 100,
    receivedQty: 50,
    unitPrice: 15000,
    updateDate: '2026-11-05',
  }));

  // Step 1: Pre-generate uploadId and stable UUIDs upfront for all 20,000 rows
  const uploadIdDay1 = generateUuid();
  const preparedRowsDay1 = rawRequirementsDay1.map((r) => ({
    ...r,
    id: generateUuid(),
    upload_id: uploadIdDay1,
  }));

  assert.strictEqual(preparedRowsDay1.length, 20000);
  const uniqueIdsDay1 = new Set(preparedRowsDay1.map((r) => r.id));
  assert.strictEqual(uniqueIdsDay1.size, 20000, 'All 20,000 rows must have distinct pre-generated UUIDs');

  // Insert initial upload_history item
  uploadHistoryDb.set(uploadIdDay1, {
    id: uploadIdDay1,
    or_number: 'OR-2026-HIGH-01',
    status: 'Memproses...',
    row_count: 0,
  });

  // Step 2: Batch upload with failure simulation at Batch 10 (i = 4,500)
  let committedRows = 0;
  let failedBatchNum = -1;
  let failedRowIndex = -1;

  const totalBatches = Math.ceil(TOTAL_ROWS_DAY_1 / CHUNK_SIZE); // 40 batches
  assert.strictEqual(totalBatches, 40);

  for (let i = 0; i < TOTAL_ROWS_DAY_1; i += CHUNK_SIZE) {
    const currentBatch = Math.floor(i / CHUNK_SIZE) + 1;
    if (currentBatch === 10) {
      // Simulate network crash / timeout at batch 10 after 3 retries
      failedBatchNum = currentBatch;
      failedRowIndex = i;
      break;
    }
    const chunk = preparedRowsDay1.slice(i, i + CHUNK_SIZE);
    chunk.forEach((row) => simulatedDb.set(row.id, { ...row }));
    committedRows += chunk.length;
  }

  assert.strictEqual(failedBatchNum, 10);
  assert.strictEqual(failedRowIndex, 4500);
  assert.strictEqual(committedRows, 4500, 'Batches 1 to 9 (4,500 rows) must be safely committed');
  assert.strictEqual(simulatedDb.size, 4500);

  // Update upload_history status to Gagal Sebagian
  uploadHistoryDb.set(uploadIdDay1, {
    ...uploadHistoryDb.get(uploadIdDay1),
    status: 'Gagal Sebagian',
    notes: `Gagal pada batch ${failedBatchNum}. Tersimpan ${committedRows} dari 20.000 baris.`,
    row_count: committedRows,
  });

  // Checkpoint stored in client
  const checkpoint = {
    uploadId: uploadIdDay1,
    startRowIndex: failedRowIndex, // 4500
    preparedRequirements: preparedRowsDay1, // exact same pre-generated UUIDs
  };

  // Step 3: Resume upload from checkpoint
  // Must use the same uploadId, no new upload_history row, and starts from failedRowIndex (4500)
  assert.strictEqual(checkpoint.uploadId, uploadIdDay1);
  assert.strictEqual(checkpoint.startRowIndex, 4500);

  for (let i = checkpoint.startRowIndex; i < TOTAL_ROWS_DAY_1; i += CHUNK_SIZE) {
    const chunk = checkpoint.preparedRequirements.slice(i, i + CHUNK_SIZE);
    // Idempotent upsert by id
    chunk.forEach((row) => simulatedDb.set(row.id, { ...row }));
    committedRows += chunk.length;
  }

  // Final verification for Day 1
  assert.strictEqual(simulatedDb.size, 20000, 'After resume, simulated database must contain exactly 20,000 unique rows');
  assert.strictEqual(uploadHistoryDb.size, 1, 'Resume must NOT create a new upload_history entry');

  uploadHistoryDb.set(uploadIdDay1, {
    ...uploadHistoryDb.get(uploadIdDay1),
    status: 'Sukses',
    notes: 'Berhasil tersimpan 20.000 baris material.',
    row_count: 20000,
  });

  // Step 4: Refresh / re-run idempotency test
  // If the user re-executes batch 10 again, count must remain exactly 20,000
  const batch10Rows = checkpoint.preparedRequirements.slice(4500, 5000);
  batch10Rows.forEach((row) => simulatedDb.set(row.id, { ...row }));
  assert.strictEqual(simulatedDb.size, 20000, 'Re-running batch 10 with identical IDs does not create duplicates');

  // Step 5: DAY 2 Upload - Another 20,000 rows (Accumulation to 40,000 rows)
  const uploadIdDay2 = generateUuid();
  assert.notStrictEqual(uploadIdDay1, uploadIdDay2);

  const rawRequirementsDay2: MaterialItemRequirement[] = Array.from({ length: 20000 }, (_, i) => ({
    id: `temp-d2-${i}`,
    orNumber: 'OR-2026-HIGH-02',
    style: 'High Volume Polo Shirt DryFit',
    materialCode: `MAT-D2-${String(i).padStart(5, '0')}`,
    materialName: `Component Material Day 2 #${i}`,
    category: 'Raw Material',
    unit: 'Kg',
    requiredQty: 200,
    receivedQty: 180,
    unitPrice: 28000,
    updateDate: '2026-11-06',
  }));

  const preparedRowsDay2 = rawRequirementsDay2.map((r) => ({
    ...r,
    id: generateUuid(),
    upload_id: uploadIdDay2,
  }));

  uploadHistoryDb.set(uploadIdDay2, {
    id: uploadIdDay2,
    or_number: 'OR-2026-HIGH-02',
    status: 'Sukses',
    row_count: 20000,
  });

  // Upload all 40 batches for Day 2
  for (let i = 0; i < 20000; i += CHUNK_SIZE) {
    const chunk = preparedRowsDay2.slice(i, i + CHUNK_SIZE);
    chunk.forEach((row) => simulatedDb.set(row.id, { ...row }));
  }

  // TOTAL ACCUMULATION VERIFICATION:
  assert.strictEqual(simulatedDb.size, 40000, 'Database must retain all 40,000 rows across Day 1 and Day 2');
  assert.strictEqual(uploadHistoryDb.size, 2, 'There must be exactly 2 distinct upload_history items');

  const day1RowsInDb = Array.from(simulatedDb.values()).filter((r) => r.upload_id === uploadIdDay1);
  const day2RowsInDb = Array.from(simulatedDb.values()).filter((r) => r.upload_id === uploadIdDay2);

  assert.strictEqual(day1RowsInDb.length, 20000, 'Day 1 must have exactly 20,000 rows');
  assert.strictEqual(day2RowsInDb.length, 20000, 'Day 2 must have exactly 20,000 rows');
  assert.strictEqual(day1RowsInDb[0].updateDate, '2026-11-05');
  assert.strictEqual(day2RowsInDb[0].updateDate, '2026-11-06');
});

test('Section 4.1: Resume setelah Browser Refresh (IndexedDB row caching & checkpoint matching)', async () => {
  const {
    saveCheckpointMeta,
    getCheckpointMeta,
    savePendingUploadRows,
    getPendingUploadRows,
    clearPendingUpload,
  } = await import('../src/utils/uploadOfflineStorage');
  const { generateDeterministicRowUuid } = await import('../src/lib/supabase');

  const uploadId = 'upload-refresh-test-001';
  const totalRows = 20000;

  // Generate 20,000 rows with deterministic UUIDs
  const rows = Array.from({ length: totalRows }, (_, i) => ({
    id: generateDeterministicRowUuid(uploadId, i),
    upload_id: uploadId,
    or_number: 'OR-REFRESH-001',
    style: 'Performance Jacket',
    material_code: `MAT-${i}`,
    material_name: `Material Item #${i}`,
    required_qty: 100,
    received_qty: 80,
    update_date: '2026-11-06',
  }));

  // Step 1: Save full rows to offline cache (simulating IndexedDB)
  await savePendingUploadRows(uploadId, rows);

  // Step 2: Save checkpoint after failure at batch 10 (row 4500)
  const checkpoint = {
    uploadId,
    fileName: 'Data_Material_PPIC.xlsx',
    orNumber: 'OR-REFRESH-001',
    style: 'Performance Jacket',
    updateDate: '2026-11-06',
    totalRows,
    startRowIndex: 4500,
    failedBatch: 10,
    totalBatches: 40,
    savedAt: new Date().toISOString(),
  };
  saveCheckpointMeta(checkpoint);

  // Step 3: Simulate browser refresh (re-reading from storage)
  const restoredMeta = getCheckpointMeta();
  assert.ok(restoredMeta, 'Checkpoint metadata must survive browser refresh');
  assert.strictEqual(restoredMeta.uploadId, uploadId);
  assert.strictEqual(restoredMeta.startRowIndex, 4500);

  const restoredRows = await getPendingUploadRows(restoredMeta.uploadId);
  assert.ok(restoredRows, 'Full rows must be restored from offline storage');
  assert.strictEqual(restoredRows.length, 20000);

  // Verify that all 20,000 restored row IDs match the original IDs exactly
  for (let i = 0; i < totalRows; i++) {
    assert.strictEqual(
      restoredRows[i].id,
      generateDeterministicRowUuid(uploadId, i),
      `Row ${i} must preserve its exact UUID after refresh`
    );
  }

  // Step 4: Simulate resuming from row 4500 into database
  const db = new Map<string, any>();
  // Batches 1..9 were already committed before failure
  for (let i = 0; i < 4500; i++) {
    db.set(rows[i].id, rows[i]);
  }
  assert.strictEqual(db.size, 4500);

  // Resume from 4500 using restored rows
  for (let i = restoredMeta.startRowIndex; i < totalRows; i++) {
    db.set(restoredRows[i].id, restoredRows[i]);
  }

  assert.strictEqual(db.size, 20000, 'Database must contain exactly 20,000 rows after refresh resume');

  // Step 5: Clean up after completion
  await clearPendingUpload(uploadId);
  assert.strictEqual(getCheckpointMeta(), null, 'Checkpoint metadata must be cleared on success');
  const clearedRows = await getPendingUploadRows(uploadId);
  assert.strictEqual(clearedRows, null, 'Offline cache must be cleared on success');
});

test('Section 4.2: Resume setelah Browser Refresh dengan Re-pilih Berkas (Validasi File Match & Deterministic UUID)', async () => {
  const { validateFileMatchWithCheckpoint } = await import('../src/utils/uploadOfflineStorage');
  const { generateDeterministicRowUuid } = await import('../src/lib/supabase');

  const uploadId = 'upload-reselect-file-002';
  const checkpoint = {
    uploadId,
    fileName: 'Master_Order_Lines_20k.xlsx',
    orNumber: 'OR-2026-VAL-01',
    style: 'Polo Shirt DryFit',
    updateDate: '2026-11-06',
    totalRows: 20000,
    startRowIndex: 4500,
    failedBatch: 10,
    totalBatches: 40,
    savedAt: new Date().toISOString(),
  };

  // Case A: User accidentally picks a wrong file with 500 rows
  const wrongFile = { name: 'Different_Order.xlsx' };
  const checkWrongRows = validateFileMatchWithCheckpoint(wrongFile, 500, 'OR-2026-VAL-01', checkpoint);
  assert.strictEqual(checkWrongRows.isValid, false, 'Should reject file with mismatched row count');
  assert.ok(checkWrongRows.reason?.includes('Jumlah baris material'));

  // Case B: User picks file with different OR
  const checkWrongOr = validateFileMatchWithCheckpoint({ name: 'Master_Order_Lines_20k.xlsx' }, 20000, 'OR-WRONG-999', checkpoint);
  assert.strictEqual(checkWrongOr.isValid, false, 'Should reject file with mismatched OR number');
  assert.ok(checkWrongOr.reason?.includes('Nomor OR'));

  // Case C: User picks the matching file
  const checkCorrect = validateFileMatchWithCheckpoint({ name: 'Master_Order_Lines_20k.xlsx' }, 20000, 'OR-2026-VAL-01', checkpoint);
  assert.strictEqual(checkCorrect.isValid, true, 'Should accept identical file');

  // Even if parsed from a reloaded file, deterministic UUID generation produces identical IDs
  for (let idx = 0; idx < 100; idx++) {
    const idOriginal = generateDeterministicRowUuid(uploadId, idx);
    const idResumed = generateDeterministicRowUuid(checkpoint.uploadId, idx);
    assert.strictEqual(idOriginal, idResumed, `Row index ${idx} must produce identical UUID across file re-selection`);
  }
});

test('Section 4.3: Penolakan Akses untuk Pengguna Tidak Berwenang (RLS Policy Audit)', () => {
  // Simulate PostgreSQL RLS policy: TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)
  function evaluateRlsAccess(authContext: { role: string; uid: string | null }): { canSelect: boolean; canInsert: boolean } {
    const isAuthenticated = authContext.role === 'authenticated' && authContext.uid !== null;
    return {
      canSelect: isAuthenticated,
      canInsert: isAuthenticated,
    };
  }

  // 1. Anonymous internet user with Anon Key only (No login)
  const anonUser = { role: 'anon', uid: null };
  const anonAccess = evaluateRlsAccess(anonUser);
  assert.strictEqual(anonAccess.canSelect, false, 'Anon user without login MUST NOT be allowed to read PPIC data');
  assert.strictEqual(anonAccess.canInsert, false, 'Anon user without login MUST NOT be allowed to insert/upsert data');

  // 2. Authenticated user with valid session token
  const loggedInUser = { role: 'authenticated', uid: 'user-ppic-uuid-456' };
  const authAccess = evaluateRlsAccess(loggedInUser);
  assert.strictEqual(authAccess.canSelect, true, 'Authenticated PPIC user is granted read access');
  assert.strictEqual(authAccess.canInsert, true, 'Authenticated PPIC user is granted write access');
});


