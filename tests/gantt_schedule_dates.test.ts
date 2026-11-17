import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateGanttBarSpan,
  compareCalendarDates,
  DEFAULT_PRODUCTION_LINES,
  doDateRangesOverlap,
  doesScheduleOverlapMonth,
  getDaysInCalendarMonth,
  getGanttRowHeightPx,
  groupSchedulesForGanttBoard,
  isFinishBeforeStart,
  layoutGanttLineSchedules,
  parseCalendarDateParts,
  UNASSIGNED_PRODUCTION_LINE_LABEL,
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

function makeSchedule(
  id: string,
  orNumber: string,
  productionDate: string,
  finishDate: string
): ProductionSchedule {
  return {
    id,
    orNumber,
    style: `Style ${orNumber}`,
    productionLine: 'Line 1',
    productionDate,
    finishDate,
    target: 1000,
    status: 'Terjadwal',
  };
}

test('Lane Case 1: Three sequential non-overlapping schedules share a single lane (1 lane)', () => {
  const schedules = [
    makeSchedule('3', 'OR-C', '2026-12-21', '2026-12-30'),
    makeSchedule('1', 'OR-A', '2026-12-01', '2026-12-10'),
    makeSchedule('2', 'OR-B', '2026-12-11', '2026-12-20'),
  ];

  const layout = layoutGanttLineSchedules(schedules, { year: 2026, month0: 11, daysInMonth: 31 });
  assert.equal(layout.laneCount, 1);
  assert.equal(layout.rowHeightPx, getGanttRowHeightPx(1));
  assert.deepEqual(
    layout.items.map((item) => ({
      or: item.schedule.orNumber,
      laneIndex: item.laneIndex,
      startDay: item.barSpan.startDay,
      endDay: item.barSpan.endDay,
    })),
    [
      { or: 'OR-A', laneIndex: 0, startDay: 1, endDay: 10 },
      { or: 'OR-B', laneIndex: 0, startDay: 11, endDay: 20 },
      { or: 'OR-C', laneIndex: 0, startDay: 21, endDay: 30 },
    ]
  );
});

test('Lane Case 2: Two overlapping schedules (including same-day inclusive boundary) use 2 lanes', () => {
  // Multi-day overlap: Dec 1-15 & Dec 10-20
  const overlapLayout = layoutGanttLineSchedules(
    [
      makeSchedule('1', 'OR-A', '2026-12-01', '2026-12-15'),
      makeSchedule('2', 'OR-B', '2026-12-10', '2026-12-20'),
    ],
    { year: 2026, month0: 11, daysInMonth: 31 }
  );
  assert.equal(overlapLayout.laneCount, 2);
  assert.equal(overlapLayout.items[0].laneIndex, 0);
  assert.equal(overlapLayout.items[1].laneIndex, 1);
  assert.equal(overlapLayout.rowHeightPx, getGanttRowHeightPx(2));

  // Inclusive same-day boundary: ends on Dec 10, next starts on Dec 10 -> must NOT share lane
  const sameDayLayout = layoutGanttLineSchedules(
    [
      makeSchedule('1', 'OR-A', '2026-12-01', '2026-12-10'),
      makeSchedule('2', 'OR-B', '2026-12-10', '2026-12-20'),
    ],
    { year: 2026, month0: 11, daysInMonth: 31 }
  );
  assert.equal(sameDayLayout.laneCount, 2);
  assert.equal(sameDayLayout.items[0].laneIndex, 0);
  assert.equal(sameDayLayout.items[1].laneIndex, 1);
});

test('Lane Case 3: Three schedules with two overlapping use minimum 2 lanes', () => {
  const layout = layoutGanttLineSchedules(
    [
      makeSchedule('1', 'OR-A', '2026-12-01', '2026-12-15'),
      makeSchedule('2', 'OR-B', '2026-12-10', '2026-12-20'),
      makeSchedule('3', 'OR-C', '2026-12-21', '2026-12-30'),
    ],
    { year: 2026, month0: 11, daysInMonth: 31 }
  );

  assert.equal(layout.laneCount, 2);
  assert.deepEqual(
    layout.items.map((i) => ({ or: i.schedule.orNumber, lane: i.laneIndex })),
    [
      { or: 'OR-A', lane: 0 },
      { or: 'OR-B', lane: 1 },
      { or: 'OR-C', lane: 0 },
    ]
  );
});

test('Lane Case 4: Freed lane is reused by subsequent non-overlapping schedules', () => {
  // OR-A (1-10) -> Lane 0
  // OR-B (5-22) -> Lane 1
  // OR-C (11-15) -> Lane 0 becomes free after day 10 -> reuses Lane 0
  // OR-D (16-25) -> Lane 0 becomes free after day 15 -> reuses Lane 0
  // OR-E (18-28) -> Overlaps both Lane 0 (16-25) and Lane 1 (5-22) -> Lane 2
  const layout = layoutGanttLineSchedules(
    [
      makeSchedule('1', 'OR-A', '2026-12-01', '2026-12-10'),
      makeSchedule('2', 'OR-B', '2026-12-05', '2026-12-22'),
      makeSchedule('3', 'OR-C', '2026-12-11', '2026-12-15'),
      makeSchedule('4', 'OR-D', '2026-12-16', '2026-12-25'),
      makeSchedule('5', 'OR-E', '2026-12-18', '2026-12-28'),
    ],
    { year: 2026, month0: 11, daysInMonth: 31 }
  );

  assert.equal(layout.laneCount, 3);
  assert.deepEqual(
    layout.items.map((i) => ({ or: i.schedule.orNumber, lane: i.laneIndex })),
    [
      { or: 'OR-A', lane: 0 },
      { or: 'OR-B', lane: 1 },
      { or: 'OR-C', lane: 0 },
      { or: 'OR-D', lane: 0 },
      { or: 'OR-E', lane: 2 },
    ]
  );
});

test('Lane Case 5: Cross-month schedules preserve clipped horizontal spans and optimal lanes', () => {
  const schedules = [
    makeSchedule('1', 'OR-CROSS', '2026-11-20', '2026-12-10'),
    makeSchedule('2', 'OR-DEC-SEQ', '2026-12-11', '2026-12-20'),
    makeSchedule('3', 'OR-DEC-OVL', '2026-12-08', '2026-12-18'),
  ];

  const novLayout = layoutGanttLineSchedules(schedules, { year: 2026, month0: 10, daysInMonth: 30 });
  assert.equal(novLayout.laneCount, 1);
  assert.equal(novLayout.items.length, 1);
  assert.equal(novLayout.items[0].schedule.orNumber, 'OR-CROSS');
  assert.equal(novLayout.items[0].barSpan.startDay, 20);
  assert.equal(novLayout.items[0].barSpan.endDay, 30);
  approxEqual(novLayout.items[0].barSpan.leftPct, (19 / 31) * 100);
  approxEqual(novLayout.items[0].barSpan.widthPct, (11 / 31) * 100);

  const decLayout = layoutGanttLineSchedules(schedules, { year: 2026, month0: 11, daysInMonth: 31 });
  assert.equal(decLayout.laneCount, 2);
  assert.deepEqual(
    decLayout.items.map((i) => ({
      or: i.schedule.orNumber,
      lane: i.laneIndex,
      startDay: i.barSpan.startDay,
      endDay: i.barSpan.endDay,
    })),
    [
      { or: 'OR-CROSS', lane: 0, startDay: 1, endDay: 10 },
      { or: 'OR-DEC-OVL', lane: 1, startDay: 8, endDay: 18 },
      { or: 'OR-DEC-SEQ', lane: 0, startDay: 11, endDay: 20 },
    ]
  );
  approxEqual(decLayout.items[0].barSpan.leftPct, 0);
  approxEqual(decLayout.items[0].barSpan.widthPct, (10 / 31) * 100);
});

test('Lane Case 6: Production line row height scales strictly with actual laneCount', () => {
  const empty = layoutGanttLineSchedules([], { year: 2026, month0: 11, daysInMonth: 31 });
  const oneLane = layoutGanttLineSchedules(
    [
      makeSchedule('1', 'OR-1', '2026-12-01', '2026-12-10'),
      makeSchedule('2', 'OR-2', '2026-12-11', '2026-12-20'),
    ],
    { year: 2026, month0: 11, daysInMonth: 31 }
  );
  const twoLanes = layoutGanttLineSchedules(
    [
      makeSchedule('1', 'OR-1', '2026-12-01', '2026-12-15'),
      makeSchedule('2', 'OR-2', '2026-12-10', '2026-12-20'),
    ],
    { year: 2026, month0: 11, daysInMonth: 31 }
  );
  const threeLanes = layoutGanttLineSchedules(
    [
      makeSchedule('1', 'OR-1', '2026-12-01', '2026-12-15'),
      makeSchedule('2', 'OR-2', '2026-12-05', '2026-12-18'),
      makeSchedule('3', 'OR-3', '2026-12-10', '2026-12-20'),
    ],
    { year: 2026, month0: 11, daysInMonth: 31 }
  );

  assert.equal(empty.laneCount, 0);
  assert.equal(empty.rowHeightPx, 64);
  assert.equal(oneLane.laneCount, 1);
  assert.equal(oneLane.rowHeightPx, 64);
  assert.equal(twoLanes.laneCount, 2);
  assert.equal(twoLanes.rowHeightPx, 106);
  assert.equal(threeLanes.laneCount, 3);
  assert.equal(threeLanes.rowHeightPx, 148);
  assert.ok(oneLane.rowHeightPx < twoLanes.rowHeightPx);
  assert.ok(twoLanes.rowHeightPx < threeLanes.rowHeightPx);
});

test('Line Grouping: groupSchedulesForGanttBoard groups per Line Produksi, sorts naturally, packs lanes per Line, and isolates unassigned into Belum Ditentukan', () => {
  const schedules: ProductionSchedule[] = [
    {
      id: 'l10-1',
      orNumber: 'OR-L10',
      style: 'Style L10',
      productionLine: 'Line 10',
      productionDate: '2026-11-02',
      finishDate: '2026-11-08',
      target: 500,
    },
    {
      id: 'l1-1',
      orNumber: 'OR-L1A',
      style: 'Style L1A',
      productionLine: 'Line 1',
      productionDate: '2026-11-01',
      finishDate: '2026-11-05',
      target: 1000,
    },
    {
      id: 'l1-2',
      orNumber: 'OR-L1B',
      style: 'Style L1B',
      productionLine: 'Line 1',
      productionDate: '2026-11-04', // Overlaps OR-L1A on Line 1 -> lane 1
      finishDate: '2026-11-09',
      target: 1000,
    },
    {
      id: 'l1-3',
      orNumber: 'OR-L1C',
      style: 'Style L1C',
      productionLine: 'Line 1',
      productionDate: '2026-11-10', // Non-overlapping after 01-05 -> reuses lane 0
      finishDate: '2026-11-15',
      target: 1000,
    },
    {
      id: 'l3-1',
      orNumber: 'OR-L3',
      style: 'Style L3',
      productionLine: 'Line 3',
      productionDate: '2026-11-03',
      finishDate: '2026-11-12',
      target: 700,
    },
    {
      id: 'un-1',
      orNumber: 'OR-EXCEL-1',
      style: 'Style Excel 1',
      productionLine: '',
      productionDate: '2026-11-01',
      finishDate: '2026-11-10',
      target: 800,
    },
    {
      id: 'un-2',
      orNumber: 'OR-LEGACY',
      style: 'Style Legacy',
      productionLine: 'Produksi', // Legacy placeholder normalized into unassigned bucket
      productionDate: '2026-11-11',
      finishDate: '2026-11-20',
      target: 600,
    },
  ];

  const groups = groupSchedulesForGanttBoard(schedules, {
    year: 2026,
    month0: 10,
    daysInMonth: 30,
  });

  // Always includes all 5 fixed lines in canonical order, plus any custom lines, then Belum Ditentukan
  assert.deepEqual(
    groups.map((g) => g.lineLabel),
    ['Line 1', 'Line 3', 'Line 4', 'Line 5', 'Line 7', 'Line 10', UNASSIGNED_PRODUCTION_LINE_LABEL]
  );

  // Line 1 has 2 lanes (L1A+L1C share lane 0, L1B on lane 1)
  assert.equal(groups[0].layout.laneCount, 2);
  assert.deepEqual(
    groups[0].layout.items.map((i) => ({ or: i.schedule.orNumber, lane: i.laneIndex })),
    [
      { or: 'OR-L1A', lane: 0 },
      { or: 'OR-L1B', lane: 1 },
      { or: 'OR-L1C', lane: 0 },
    ]
  );

  // Line 3 has 1 lane, empty fixed lines (Line 4, 5, 7) have 0 lanes, Line 10 has 1 lane
  assert.equal(groups[1].layout.laneCount, 1);
  assert.equal(groups[2].layout.laneCount, 0);
  assert.equal(groups[3].layout.laneCount, 0);
  assert.equal(groups[4].layout.laneCount, 0);
  assert.equal(groups[5].layout.laneCount, 1);

  // Unassigned schedules share lane 0 because Nov 1-10 and Nov 11-20 do not overlap
  const unassignedGroup = groups[6];
  assert.equal(unassignedGroup.isUnassigned, true);
  assert.equal(unassignedGroup.layout.laneCount, 1);
  assert.equal(unassignedGroup.layout.items.length, 2);

  // When all schedules have real lines, Belum Ditentukan row is omitted while all 5 fixed lines stay
  const onlyAssigned = groupSchedulesForGanttBoard(
    schedules.filter((s) => s.id.startsWith('l')),
    { year: 2026, month0: 10, daysInMonth: 30 }
  );
  assert.equal(onlyAssigned.some((g) => g.isUnassigned), false);
  assert.deepEqual(
    onlyAssigned.map((g) => g.lineLabel),
    ['Line 1', 'Line 3', 'Line 4', 'Line 5', 'Line 7', 'Line 10']
  );
});

test('Fixed 5 Production Lines: always displays Line 1, Line 3, Line 4, Line 5, Line 7 regardless of empty/single-line/month-switch states', () => {
  const expectedFixed = ['Line 1', 'Line 3', 'Line 4', 'Line 5', 'Line 7'];
  assert.deepEqual([...DEFAULT_PRODUCTION_LINES], expectedFixed);

  const novParams = { year: 2026, month0: 10, daysInMonth: 30 };
  const decParams = { year: 2026, month0: 11, daysInMonth: 31 };

  // 1. Only Line 1 has a schedule -> all 5 lines still appear
  const onlyLine1 = groupSchedulesForGanttBoard(
    [
      {
        id: 's1',
        orNumber: 'OR-1',
        style: 'Jacket',
        productionLine: 'Line 1',
        productionDate: '2026-11-02',
        finishDate: '2026-11-06',
        target: 500,
      },
    ],
    novParams
  );
  assert.deepEqual(onlyLine1.map((g) => g.lineLabel), expectedFixed);
  assert.equal(onlyLine1[0].layout.items.length, 1);
  assert.equal(onlyLine1[1].layout.items.length, 0);
  assert.equal(onlyLine1[2].layout.items.length, 0);
  assert.equal(onlyLine1[3].layout.items.length, 0);
  assert.equal(onlyLine1[4].layout.items.length, 0);

  // 2. Only Line 3 has a schedule -> all 5 lines still appear
  const onlyLine3 = groupSchedulesForGanttBoard(
    [
      {
        id: 's3',
        orNumber: 'OR-3',
        style: 'Hoodie',
        productionLine: 'Line 3',
        productionDate: '2026-11-10',
        finishDate: '2026-11-14',
        target: 700,
      },
    ],
    novParams
  );
  assert.deepEqual(onlyLine3.map((g) => g.lineLabel), expectedFixed);
  assert.equal(onlyLine3[0].layout.items.length, 0);
  assert.equal(onlyLine3[1].layout.items.length, 1);

  // 3. No schedules at all -> all 5 lines still appear with 64px minimum row height
  const noSchedules = groupSchedulesForGanttBoard([], novParams);
  assert.deepEqual(noSchedules.map((g) => g.lineLabel), expectedFixed);
  for (const g of noSchedules) {
    assert.equal(g.layout.items.length, 0);
    assert.equal(g.layout.laneCount, 0);
    assert.equal(g.layout.rowHeightPx, 64);
  }

  // 4. All 5 lines populated (including lowercase 'line 4') -> each enters its exact fixed line
  const allFive = groupSchedulesForGanttBoard(
    [
      { id: 'f7', orNumber: 'OR-7', style: 'S7', productionLine: 'Line 7', productionDate: '2026-11-20', finishDate: '2026-11-24', target: 100 },
      { id: 'f4', orNumber: 'OR-4', style: 'S4', productionLine: 'line 4', productionDate: '2026-11-15', finishDate: '2026-11-18', target: 100 },
      { id: 'f1', orNumber: 'OR-1', style: 'S1', productionLine: 'Line 1', productionDate: '2026-11-01', finishDate: '2026-11-05', target: 100 },
      { id: 'f5', orNumber: 'OR-5', style: 'S5', productionLine: 'Line 5', productionDate: '2026-11-06', finishDate: '2026-11-10', target: 100 },
      { id: 'f3', orNumber: 'OR-3', style: 'S3', productionLine: 'Line 3', productionDate: '2026-11-11', finishDate: '2026-11-14', target: 100 },
    ],
    novParams
  );
  assert.deepEqual(allFive.map((g) => g.lineLabel), expectedFixed);
  assert.deepEqual(
    allFive.map((g) => g.layout.items[0]?.schedule.orNumber),
    ['OR-1', 'OR-3', 'OR-4', 'OR-5', 'OR-7']
  );

  // 5. Unassigned schedule goes to 'Belum Ditentukan' after Line 7, never auto-placed into 5 lines
  const withUnassigned = groupSchedulesForGanttBoard(
    [
      { id: 'u1', orNumber: 'OR-U1', style: 'Unassigned', productionLine: '', productionDate: '2026-11-05', finishDate: '2026-11-08', target: 300 },
      { id: 'u2', orNumber: 'OR-U2', style: 'Legacy', productionLine: 'Produksi', productionDate: '2026-11-12', finishDate: '2026-11-15', target: 400 },
    ],
    novParams
  );
  assert.deepEqual(withUnassigned.map((g) => g.lineLabel), [...expectedFixed, UNASSIGNED_PRODUCTION_LINE_LABEL]);
  for (let i = 0; i < 5; i++) {
    assert.equal(withUnassigned[i].layout.items.length, 0);
  }
  assert.equal(withUnassigned[5].isUnassigned, true);
  assert.equal(withUnassigned[5].layout.items.length, 2);

  // 6. Switching to December 2026 (where Nov schedules don't overlap) -> all 5 fixed lines remain visible
  const switchedMonth = groupSchedulesForGanttBoard(
    [
      { id: 'm1', orNumber: 'OR-NOV', style: 'Nov Only', productionLine: 'Line 1', productionDate: '2026-11-01', finishDate: '2026-11-10', target: 500 },
    ],
    decParams
  );
  assert.deepEqual(switchedMonth.map((g) => g.lineLabel), expectedFixed);
  for (const g of switchedMonth) {
    assert.equal(g.layout.items.length, 0);
  }
});
