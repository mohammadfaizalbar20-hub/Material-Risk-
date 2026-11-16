import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateGanttBarSpan,
  compareCalendarDates,
  doDateRangesOverlap,
  doesScheduleOverlapMonth,
  getDaysInCalendarMonth,
  isFinishBeforeStart,
  parseCalendarDateParts,
} from '../src/utils/ganttScheduleUtils';
import { getIndonesianHolidayInfo } from '../src/utils/indonesianHolidays';
import { mapDbScheduleToModel, mapModelToDbSchedule } from '../src/lib/supabase';
import {
  ScheduleRemoteGateway,
  updateScheduleWithPersistence,
} from '../src/utils/scheduleCrudLogic';
import { ProductionSchedule } from '../src/types/ppic';

function approxEqual(actual: number, expected: number, eps = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `Expected ${actual} to be within ${eps} of ${expected}`
  );
}

test('Case 1: Start day 1, Finish day 14 (OR 1023) -> bar stops precisely at day 14, not day 30/31', () => {
  // November 2026 has 30 days (month0 = 10)
  const span = calculateGanttBarSpan({
    productionDate: '2026-11-01',
    finishDate: '2026-11-14',
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });

  assert.ok(span);
  assert.equal(span.startDay, 1);
  assert.equal(span.endDay, 14);
  assert.equal(span.durationDays, 14);
  approxEqual(span.leftPct, 0);
  approxEqual(span.widthPct, (14 / 31) * 100);
  // Ensure right edge is strictly at column 14 boundary (14/31 = 45.16129%), NOT 100%
  approxEqual(span.leftPct + span.widthPct, (14 / 31) * 100);
  assert.ok(span.widthPct < 50);
});

test('Case 2: Start day 5, Finish day 14 -> bar starts at day 5 and stops precisely at day 14', () => {
  const span = calculateGanttBarSpan({
    productionDate: '2026-11-05',
    finishDate: '2026-11-14',
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });

  assert.ok(span);
  assert.equal(span.startDay, 5);
  assert.equal(span.endDay, 14);
  assert.equal(span.durationDays, 10);
  approxEqual(span.leftPct, (4 / 31) * 100);
  approxEqual(span.widthPct, (10 / 31) * 100);
  approxEqual(span.leftPct + span.widthPct, (14 / 31) * 100);
});

test('Case 3: Start day 20, Finish day 30 -> bar spans days 20..30 and stops at day 30', () => {
  const span = calculateGanttBarSpan({
    productionDate: '2026-11-20',
    finishDate: '2026-11-30',
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });

  assert.ok(span);
  assert.equal(span.startDay, 20);
  assert.equal(span.endDay, 30);
  assert.equal(span.durationDays, 11);
  approxEqual(span.leftPct, (19 / 31) * 100);
  approxEqual(span.widthPct, (11 / 31) * 100);
  approxEqual(span.leftPct + span.widthPct, (30 / 31) * 100);
});

test('Case 4: Cross-month schedule (2026-11-20 to 2026-12-10) clips accurately in November and December', () => {
  const novOverlap = doesScheduleOverlapMonth(
    { productionDate: '2026-11-20', finishDate: '2026-12-10' },
    2026,
    10,
    30
  );
  const decOverlap = doesScheduleOverlapMonth(
    { productionDate: '2026-11-20', finishDate: '2026-12-10' },
    2026,
    11,
    31
  );
  const octOverlap = doesScheduleOverlapMonth(
    { productionDate: '2026-11-20', finishDate: '2026-12-10' },
    2026,
    9,
    31
  );

  assert.equal(octOverlap, false);
  assert.equal(novOverlap, true);
  assert.equal(decOverlap, true);

  // In November (30 days): starts at 20, clips to 30
  const novSpan = calculateGanttBarSpan({
    productionDate: '2026-11-20',
    finishDate: '2026-12-10',
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });
  assert.ok(novSpan);
  assert.equal(novSpan.startDay, 20);
  assert.equal(novSpan.endDay, 30);
  assert.equal(novSpan.durationDays, 11);
  approxEqual(novSpan.leftPct, (19 / 31) * 100);
  approxEqual(novSpan.widthPct, (11 / 31) * 100);

  // In December (31 days): starts at 1, stops at 10
  const decSpan = calculateGanttBarSpan({
    productionDate: '2026-11-20',
    finishDate: '2026-12-10',
    year: 2026,
    month0: 11,
    daysInMonth: 31,
  });
  assert.ok(decSpan);
  assert.equal(decSpan.startDay, 1);
  assert.equal(decSpan.endDay, 10);
  assert.equal(decSpan.durationDays, 10);
  approxEqual(decSpan.leftPct, 0);
  approxEqual(decSpan.widthPct, (10 / 31) * 100);

  // Also test schedule starting 2026-12-01 (previously shifted to Nov 30 in negative UTC timezones!)
  const decFirstOverlapInNov = doesScheduleOverlapMonth(
    { productionDate: '2026-12-01', finishDate: '2026-12-14' },
    2026,
    10,
    30
  );
  assert.equal(decFirstOverlapInNov, false);
});

test('Case 5: Editing finishDate updates stored schedule and Gantt bar width immediately', async () => {
  const initialSchedule: ProductionSchedule = {
    id: '11111111-1111-4111-8111-111111111023',
    orNumber: '1023',
    style: 'Casual Polo Shirt',
    productionLine: 'Line 1',
    productionDate: '2026-11-01',
    finishDate: '2026-11-30',
    target: 2000,
    status: 'Terjadwal',
  };

  const remoteRows = new Map<string, ProductionSchedule>([[initialSchedule.id, initialSchedule]]);
  const gateway: ScheduleRemoteGateway = {
    isConfigured: true,
    async createSchedule(s) {
      remoteRows.set(s.id, s);
      return { success: true, id: s.id };
    },
    async updateSchedule(s) {
      remoteRows.set(s.id, s);
      return { success: true, id: s.id };
    },
    async deleteSchedule(id) {
      remoteRows.delete(id);
      return { success: true };
    },
  };

  const beforeSpan = calculateGanttBarSpan({
    productionDate: initialSchedule.productionDate,
    finishDate: initialSchedule.finishDate,
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });
  assert.ok(beforeSpan);
  assert.equal(beforeSpan.endDay, 30);
  assert.equal(beforeSpan.durationDays, 30);

  // Edit finishDate from Nov 30 -> Nov 14
  const updateRes = await updateScheduleWithPersistence(
    [initialSchedule],
    initialSchedule.id,
    { finishDate: '2026-11-14' },
    gateway
  );

  assert.equal(updateRes.success, true);
  assert.equal(updateRes.schedule?.finishDate, '2026-11-14');
  assert.equal(remoteRows.get(initialSchedule.id)?.finishDate, '2026-11-14');

  const afterSpan = calculateGanttBarSpan({
    productionDate: updateRes.schedule!.productionDate,
    finishDate: updateRes.schedule!.finishDate,
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });
  assert.ok(afterSpan);
  assert.equal(afterSpan.startDay, 1);
  assert.equal(afterSpan.endDay, 14);
  assert.equal(afterSpan.durationDays, 14);
  approxEqual(afterSpan.widthPct, (14 / 31) * 100);
});

test('Timezone-safe parsing & Supabase roundtrip preserve exact finishDate without day shift', () => {
  const isoParts = parseCalendarDateParts('2026-11-14T00:00:00.000Z');
  assert.deepEqual(isoParts, { year: 2026, month0: 10, day: 14 });

  const dmyParts = parseCalendarDateParts('14/11/2026');
  assert.deepEqual(dmyParts, { year: 2026, month0: 10, day: 14 });

  const schedule: ProductionSchedule = {
    id: '22222222-2222-4222-8222-222222221023',
    orNumber: '1023',
    style: 'Test Jacket',
    productionLine: 'Line 3',
    productionDate: '2026-11-01',
    finishDate: '2026-11-14',
    target: 1200,
    status: 'Terjadwal',
  };

  const dbRow = mapModelToDbSchedule(schedule);
  assert.equal(dbRow.production_date, '2026-11-01');
  assert.equal(dbRow.finish_date, '2026-11-14');

  const roundtripped = mapDbScheduleToModel(dbRow);
  assert.equal(roundtripped.productionDate, '2026-11-01');
  assert.equal(roundtripped.finishDate, '2026-11-14');

  assert.equal(isFinishBeforeStart('2026-11-14', '2026-11-10'), true);
  assert.equal(isFinishBeforeStart('2026-11-14', '2026-11-14'), false);
  assert.equal(compareCalendarDates('2026-11-14', '2026-11-30') < 0, true);
  assert.equal(doDateRangesOverlap('2026-11-01', '2026-11-14', '2026-11-14', '2026-11-20'), true);
  assert.equal(doDateRangesOverlap('2026-11-01', '2026-11-14', '2026-11-15', '2026-11-20'), false);
});

test('February leap/non-leap months and Indonesian holiday markers remain intact', () => {
  assert.equal(getDaysInCalendarMonth(2026, 1), 28);
  assert.equal(getDaysInCalendarMonth(2024, 1), 29);

  // Sunday marker check (2026-11-01 is Sunday)
  const nov1 = getIndonesianHolidayInfo('2026-11-01');
  assert.equal(nov1.isHoliday, true);
  assert.equal(nov1.type, 'SUNDAY');

  // National holiday marker check (2026-12-25 Hari Raya Natal)
  const dec25 = getIndonesianHolidayInfo('2026-12-25');
  assert.equal(dec25.isHoliday, true);
  assert.equal(dec25.type, 'NATIONAL_HOLIDAY');

  // Cuti bersama marker check (2026-12-24 Cuti Bersama Natal)
  const dec24 = getIndonesianHolidayInfo('2026-12-24');
  assert.equal(dec24.isHoliday, true);
  assert.equal(dec24.type, 'CUTI_BERSAMA');
});
