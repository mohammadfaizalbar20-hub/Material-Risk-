import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductionSchedule } from '../src/types/ppic';
import { isValidUuid, generateUuid } from '../src/utils/uuid';
import {
  ScheduleRemoteGateway,
  createScheduleWithPersistence,
  updateScheduleWithPersistence,
  deleteScheduleWithPersistence,
} from '../src/utils/scheduleCrudLogic';
import { mapModelToDbSchedule } from '../src/lib/supabase';

const sampleBaseInput: Omit<ProductionSchedule, 'id'> = {
  orNumber: 'OR-2026-901',
  style: 'Jacket Taslan Stage 2A',
  productionLine: 'Line 1',
  productionDate: '2026-11-10',
  finishDate: '2026-11-14',
  target: 1500,
  status: 'Terjadwal',
};

function createFakeSupabaseDb(initial: ProductionSchedule[] = []) {
  const rows = new Map<string, ProductionSchedule>(initial.map((s) => [s.id, { ...s }]));
  let insertCalls = 0;
  let updateCalls = 0;
  let deleteCalls = 0;

  let failInsert: string | null = null;
  let failUpdate: string | null = null;
  let failDelete: string | null = null;

  const gateway: ScheduleRemoteGateway = {
    isConfigured: true,
    async createSchedule(schedule) {
      insertCalls++;
      if (failInsert) return { success: false, error: failInsert };
      if (!isValidUuid(schedule.id)) {
        return { success: false, error: 'Invalid UUID for INSERT' };
      }
      if (rows.has(schedule.id)) {
        return { success: false, error: 'duplicate key value violates unique constraint' };
      }
      rows.set(schedule.id, { ...schedule });
      return { success: true, id: schedule.id };
    },
    async updateSchedule(schedule) {
      updateCalls++;
      if (failUpdate) return { success: false, error: failUpdate };
      if (!isValidUuid(schedule.id)) {
        return { success: false, error: 'Invalid UUID for UPDATE' };
      }
      if (!rows.has(schedule.id)) {
        return { success: false, error: '0 rows updated' };
      }
      rows.set(schedule.id, { ...schedule });
      return { success: true, id: schedule.id };
    },
    async deleteSchedule(id) {
      deleteCalls++;
      if (failDelete) return { success: false, error: failDelete };
      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid UUID for DELETE' };
      }
      if (!rows.has(id)) {
        return { success: false, error: '0 rows deleted' };
      }
      rows.delete(id);
      return { success: true };
    },
  };

  return {
    rows,
    gateway,
    getCounts: () => ({ insertCalls, updateCalls, deleteCalls }),
    setFailInsert: (msg: string | null) => {
      failInsert = msg;
    },
    setFailUpdate: (msg: string | null) => {
      failUpdate = msg;
    },
    setFailDelete: (msg: string | null) => {
      failDelete = msg;
    },
  };
}

test('1 & 2. Create schedule generates valid RFC4122 UUID identical between client state and Supabase', async () => {
  const db = createFakeSupabaseDb();
  const res = await createScheduleWithPersistence([], sampleBaseInput, db.gateway);

  assert.equal(res.success, true);
  assert.ok(res.schedule);
  assert.equal(isValidUuid(res.schedule.id), true);
  assert.equal(res.schedule.id.startsWith('sch-'), false);
  assert.equal(res.schedules.length, 1);
  assert.equal(db.rows.size, 1);
  assert.ok(db.rows.has(res.schedule.id));
  assert.equal(db.getCounts().insertCalls, 1);
});

test('3. Edit and Manual Refresh preserve existing UUID via UPDATE and never create duplicate rows', async () => {
  const db = createFakeSupabaseDb();
  const created = await createScheduleWithPersistence([], sampleBaseInput, db.gateway);
  assert.equal(created.success, true);
  const id = created.schedule!.id;

  const edited = await updateScheduleWithPersistence(
    created.schedules,
    id,
    { style: 'Jacket Taslan Updated', target: 1800 },
    db.gateway
  );

  assert.equal(edited.success, true);
  assert.equal(edited.schedule?.id, id);
  assert.equal(edited.schedules.length, 1);
  assert.equal(db.rows.size, 1);
  assert.equal(db.rows.get(id)?.style, 'Jacket Taslan Updated');
  assert.equal(db.getCounts().insertCalls, 1);
  assert.equal(db.getCounts().updateCalls, 1);

  // Simulate Manual Refresh updating worksheets only
  const refreshed = await updateScheduleWithPersistence(
    edited.schedules,
    id,
    {
      worksheets: [
        {
          id: 'ws-1',
          fileName: 'WS.pdf',
          orNumber: '901',
          style: 'Jacket Taslan Updated',
          target: 1800,
          materials: [],
          uploadedAt: '2026-11-12T10:00:00.000Z',
        },
      ],
    },
    db.gateway
  );

  assert.equal(refreshed.success, true);
  assert.equal(refreshed.schedule?.id, id);
  assert.equal(refreshed.schedules.length, 1);
  assert.equal(db.rows.size, 1);
  assert.equal(db.getCounts().insertCalls, 1);
  assert.equal(db.getCounts().updateCalls, 2);
});

test('4. Delete removes only the targeted schedule and preserves other schedules', async () => {
  const id1 = generateUuid();
  const id2 = generateUuid();
  const sch1: ProductionSchedule = { ...sampleBaseInput, id: id1, orNumber: 'OR-1' };
  const sch2: ProductionSchedule = { ...sampleBaseInput, id: id2, orNumber: 'OR-2' };

  const db = createFakeSupabaseDb([sch1, sch2]);
  const deleted = await deleteScheduleWithPersistence([sch1, sch2], id1, db.gateway);

  assert.equal(deleted.success, true);
  assert.equal(deleted.schedules.length, 1);
  assert.equal(deleted.schedules[0].id, id2);
  assert.equal(db.rows.size, 1);
  assert.equal(db.rows.has(id1), false);
  assert.equal(db.rows.has(id2), true);
});

test('5. Simulated Supabase failures (INSERT, UPDATE, DELETE) block local state mutation and return error', async () => {
  const existingId = generateUuid();
  const existing: ProductionSchedule = { ...sampleBaseInput, id: existingId };
  const db = createFakeSupabaseDb([existing]);

  // INSERT fails
  db.setFailInsert('RLS policy rejected INSERT');
  const draftId = generateUuid();
  const createFail = await createScheduleWithPersistence([existing], { ...sampleBaseInput, id: draftId }, db.gateway);
  assert.equal(createFail.success, false);
  assert.match(createFail.error || '', /RLS policy rejected INSERT/);
  assert.equal(createFail.schedules.length, 1);
  assert.equal(db.rows.size, 1);

  // Retry create with same draftId succeeds without duplicate
  db.setFailInsert(null);
  const createRetry = await createScheduleWithPersistence(
    createFail.schedules,
    { ...sampleBaseInput, id: draftId },
    db.gateway
  );
  assert.equal(createRetry.success, true);
  assert.equal(createRetry.schedule?.id, draftId);
  assert.equal(createRetry.schedules.length, 2);
  assert.equal(db.rows.size, 2);

  // UPDATE fails -> local state stays untouched
  db.setFailUpdate('Network timeout on UPDATE');
  const updateFail = await updateScheduleWithPersistence(
    createRetry.schedules,
    existingId,
    { target: 9999 },
    db.gateway
  );
  assert.equal(updateFail.success, false);
  assert.match(updateFail.error || '', /Network timeout on UPDATE/);
  assert.equal(updateFail.schedules.find((s) => s.id === existingId)?.target, 1500);
  assert.equal(db.rows.get(existingId)?.target, 1500);

  // DELETE fails -> schedule remains in local state
  db.setFailDelete('Permission denied on DELETE');
  const deleteFail = await deleteScheduleWithPersistence(createRetry.schedules, existingId, db.gateway);
  assert.equal(deleteFail.success, false);
  assert.match(deleteFail.error || '', /Permission denied on DELETE/);
  assert.equal(deleteFail.schedules.length, 2);
  assert.equal(db.rows.has(existingId), true);
});

test('6. Legacy sch-... IDs are protected from speculative Supabase writes/deletes when configured', async () => {
  const legacy: ProductionSchedule = { ...sampleBaseInput, id: 'sch-101' };
  const db = createFakeSupabaseDb();

  const editRes = await updateScheduleWithPersistence([legacy], 'sch-101', { target: 2000 }, db.gateway);
  assert.equal(editRes.success, false);
  assert.match(editRes.error || '', /sch-101/);
  assert.equal(editRes.schedules[0].target, 1500);

  const deleteRes = await deleteScheduleWithPersistence([legacy], 'sch-101', db.gateway);
  assert.equal(deleteRes.success, false);
  assert.match(deleteRes.error || '', /sch-101/);
  assert.equal(deleteRes.schedules.length, 1);

  // Zero Supabase calls were issued for legacy ID
  assert.deepEqual(db.getCounts(), { insertCalls: 0, updateCalls: 0, deleteCalls: 0 });
});

test('7. Offline/local-only mode creates UUID for new schedules and still supports edit/delete on legacy sch-... demo data', async () => {
  const offlineGateway: ScheduleRemoteGateway = {
    isConfigured: false,
    async createSchedule() {
      throw new Error('Should not call remote in offline mode');
    },
    async updateSchedule() {
      throw new Error('Should not call remote in offline mode');
    },
    async deleteSchedule() {
      throw new Error('Should not call remote in offline mode');
    },
  };

  const legacy: ProductionSchedule = { ...sampleBaseInput, id: 'sch-101' };
  const created = await createScheduleWithPersistence([legacy], sampleBaseInput, offlineGateway);
  assert.equal(created.success, true);
  assert.equal(isValidUuid(created.schedule?.id), true);
  assert.equal(created.schedules.length, 2);

  const editedLegacy = await updateScheduleWithPersistence(created.schedules, 'sch-101', { target: 2200 }, offlineGateway);
  assert.equal(editedLegacy.success, true);
  assert.equal(editedLegacy.schedules.find((s) => s.id === 'sch-101')?.target, 2200);

  const deletedLegacy = await deleteScheduleWithPersistence(editedLegacy.schedules, 'sch-101', offlineGateway);
  assert.equal(deletedLegacy.success, true);
  assert.equal(deletedLegacy.schedules.length, 1);
  assert.equal(isValidUuid(deletedLegacy.schedules[0].id), true);
});

test('8. mapModelToDbSchedule rejects non-UUID strings (including long sch-... IDs) and coerces target to integer', () => {
  const longLegacyId = 'sch-12345678901234567890123456789012';
  const mappedLegacy = mapModelToDbSchedule({
    ...sampleBaseInput,
    id: longLegacyId,
    target: 74.6,
  });
  assert.equal(mappedLegacy.id, undefined);
  assert.equal(mappedLegacy.target, 75);

  const validId = generateUuid();
  const mappedValid = mapModelToDbSchedule({
    ...sampleBaseInput,
    id: validId,
    target: 120.4,
  });
  assert.equal(mappedValid.id, validId);
  assert.equal(mappedValid.target, 120);
});
