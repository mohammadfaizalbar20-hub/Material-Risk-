import { ProductionSchedule } from '../types/ppic';

export interface CalendarDateParts {
  year: number;
  month0: number; // 0-indexed (0 = Jan, 11 = Dec)
  day: number; // 1-indexed (1..31)
}

export interface GanttBarSpan {
  startDay: number;
  endDay: number;
  durationDays: number;
  leftPct: number;
  widthPct: number;
}

const TOTAL_GRID_COLUMNS = 31;

/**
 * Parse a calendar date string without timezone shifts.
 * Supports:
 * - "YYYY-MM-DD"
 * - ISO timestamps starting with "YYYY-MM-DD..."
 * - "DD/MM/YYYY" or "DD-MM-YYYY"
 */
export function parseCalendarDateParts(value: string | null | undefined): CalendarDateParts | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Match YYYY-MM-DD (including ISO timestamps like 2026-11-14T00:00:00Z)
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month1 = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (isValidCalendarDate(year, month1, day)) {
      return { year, month0: month1 - 1, day };
    }
    return null;
  }

  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month1 = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    if (isValidCalendarDate(year, month1, day)) {
      return { year, month0: month1 - 1, day };
    }
    return null;
  }

  return null;
}

function isValidCalendarDate(year: number, month1: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) return false;
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month1 - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month1 - 1 &&
    check.getUTCDate() === day
  );
}

/**
 * Convert CalendarDateParts into a monotonic integer YYYYMMDD for timezone-safe comparisons.
 */
export function toCalendarOrdinal(parts: CalendarDateParts): number {
  return parts.year * 10000 + (parts.month0 + 1) * 100 + parts.day;
}

export function compareCalendarDates(a: string, b: string): number {
  const pa = parseCalendarDateParts(a);
  const pb = parseCalendarDateParts(b);
  if (!pa || !pb) {
    return a.localeCompare(b);
  }
  return toCalendarOrdinal(pa) - toCalendarOrdinal(pb);
}

export function isFinishBeforeStart(productionDate: string, finishDate: string): boolean {
  const start = parseCalendarDateParts(productionDate);
  const finish = parseCalendarDateParts(finishDate);
  if (!start || !finish) return false;
  return toCalendarOrdinal(finish) < toCalendarOrdinal(start);
}

export function doDateRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const sa = parseCalendarDateParts(startA);
  const ea = parseCalendarDateParts(endA);
  const sb = parseCalendarDateParts(startB);
  const eb = parseCalendarDateParts(endB);
  if (!sa || !ea || !sb || !eb) return false;

  const startOrdA = toCalendarOrdinal(sa);
  const endOrdA = Math.max(startOrdA, toCalendarOrdinal(ea));
  const startOrdB = toCalendarOrdinal(sb);
  const endOrdB = Math.max(startOrdB, toCalendarOrdinal(eb));

  return startOrdA <= endOrdB && endOrdA >= startOrdB;
}

export function getDaysInCalendarMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Determine whether a schedule intersects the viewed calendar month.
 */
export function doesScheduleOverlapMonth(
  schedule: Pick<ProductionSchedule, 'productionDate' | 'finishDate'>,
  year: number,
  month0: number,
  daysInMonth: number = getDaysInCalendarMonth(year, month0)
): boolean {
  const sStart = parseCalendarDateParts(schedule.productionDate);
  const sEnd = parseCalendarDateParts(schedule.finishDate);
  if (!sStart || !sEnd) return false;

  const startOrd = toCalendarOrdinal(sStart);
  const endOrd = Math.max(startOrd, toCalendarOrdinal(sEnd));
  const monthStartOrd = toCalendarOrdinal({ year, month0, day: 1 });
  const monthEndOrd = toCalendarOrdinal({ year, month0, day: daysInMonth });

  return startOrd <= monthEndOrd && endOrd >= monthStartOrd;
}

/**
 * Calculate exact Gantt bar startDay, endDay (inclusive), leftPct, and widthPct
 * clipped to the active month on a 31-column grid.
 */
export function calculateGanttBarSpan(params: {
  productionDate: string;
  finishDate: string;
  year: number;
  month0: number;
  daysInMonth?: number;
}): GanttBarSpan | null {
  const { productionDate, finishDate, year, month0 } = params;
  const daysInMonth = params.daysInMonth ?? getDaysInCalendarMonth(year, month0);

  const sStart = parseCalendarDateParts(productionDate);
  const sEnd = parseCalendarDateParts(finishDate);
  if (!sStart || !sEnd) return null;

  const startOrd = toCalendarOrdinal(sStart);
  const rawEndOrd = toCalendarOrdinal(sEnd);
  const endOrd = Math.max(startOrd, rawEndOrd);

  const monthStartOrd = toCalendarOrdinal({ year, month0, day: 1 });
  const monthEndOrd = toCalendarOrdinal({ year, month0, day: daysInMonth });

  if (startOrd > monthEndOrd || endOrd < monthStartOrd) {
    return null;
  }

  const startDay =
    sStart.year === year && sStart.month0 === month0
      ? Math.max(1, Math.min(daysInMonth, sStart.day))
      : 1;

  const endDay =
    sEnd.year === year && sEnd.month0 === month0
      ? Math.max(startDay, Math.min(daysInMonth, sEnd.day))
      : daysInMonth;

  const durationDays = Math.max(1, endDay - startDay + 1);
  const leftPct = ((startDay - 1) / TOTAL_GRID_COLUMNS) * 100;
  const widthPct = (durationDays / TOTAL_GRID_COLUMNS) * 100;

  return {
    startDay,
    endDay,
    durationDays,
    leftPct,
    widthPct,
  };
}

export const GANTT_LANE_HEIGHT_PX = 36;
export const GANTT_LANE_GAP_PX = 6;
export const GANTT_ROW_PADDING_Y_PX = 14;

export interface GanttLaneItem<T extends Pick<ProductionSchedule, 'id' | 'productionDate' | 'finishDate'> = ProductionSchedule> {
  schedule: T;
  barSpan: GanttBarSpan;
  laneIndex: number;
}

export interface GanttLineLayout<T extends Pick<ProductionSchedule, 'id' | 'productionDate' | 'finishDate'> = ProductionSchedule> {
  items: Array<GanttLaneItem<T>>;
  laneCount: number;
  rowHeightPx: number;
}

export function getGanttRowHeightPx(laneCount: number): number {
  const effectiveLanes = Math.max(1, laneCount);
  const contentHeight =
    effectiveLanes * GANTT_LANE_HEIGHT_PX + (effectiveLanes - 1) * GANTT_LANE_GAP_PX;
  return GANTT_ROW_PADDING_Y_PX * 2 + contentHeight;
}

/**
 * Assign schedules on a single Production Line to horizontal lanes using
 * greedy interval partitioning with INCLUSIVE date overlap.
 *
 * Rules:
 * - Non-overlapping schedules share/reuse the lowest free lane index (0, 1, ...).
 * - Inclusive overlap: if schedule A finishes on day D and schedule B starts on day D,
 *   they collide (D < D is false) and are placed on different lanes.
 * - Cross-month schedules are clipped to the active month via calculateGanttBarSpan
 *   before lane assignment, preserving horizontal position and width.
 */
export function layoutGanttLineSchedules<
  T extends Pick<ProductionSchedule, 'id' | 'productionDate' | 'finishDate'>
>(
  schedules: T[],
  params: {
    year: number;
    month0: number;
    daysInMonth?: number;
  }
): GanttLineLayout<T> {
  const { year, month0 } = params;
  const daysInMonth = params.daysInMonth ?? getDaysInCalendarMonth(year, month0);

  const spanned: Array<{ schedule: T; barSpan: GanttBarSpan }> = [];
  for (const schedule of schedules) {
    const barSpan = calculateGanttBarSpan({
      productionDate: schedule.productionDate,
      finishDate: schedule.finishDate,
      year,
      month0,
      daysInMonth,
    });
    if (barSpan) {
      spanned.push({ schedule, barSpan });
    }
  }

  // Sort by clipped startDay asc, then clipped endDay asc, then actual start/finish dates, then id
  spanned.sort((a, b) => {
    if (a.barSpan.startDay !== b.barSpan.startDay) {
      return a.barSpan.startDay - b.barSpan.startDay;
    }
    if (a.barSpan.endDay !== b.barSpan.endDay) {
      return a.barSpan.endDay - b.barSpan.endDay;
    }
    const startCmp = compareCalendarDates(a.schedule.productionDate, b.schedule.productionDate);
    if (startCmp !== 0) return startCmp;
    const endCmp = compareCalendarDates(a.schedule.finishDate, b.schedule.finishDate);
    if (endCmp !== 0) return endCmp;
    return a.schedule.id.localeCompare(b.schedule.id);
  });

  // Track the inclusive last occupied endDay of each lane
  const laneLastEndDays: number[] = [];
  const items: Array<GanttLaneItem<T>> = [];

  for (const entry of spanned) {
    let assignedLane = -1;
    for (let i = 0; i < laneLastEndDays.length; i++) {
      // Strictly '<' enforces inclusive date boundaries:
      // finishing on day 10 and starting on day 10 is treated as overlap (10 < 10 === false).
      if (laneLastEndDays[i] < entry.barSpan.startDay) {
        assignedLane = i;
        laneLastEndDays[i] = entry.barSpan.endDay;
        break;
      }
    }

    if (assignedLane === -1) {
      assignedLane = laneLastEndDays.length;
      laneLastEndDays.push(entry.barSpan.endDay);
    }

    items.push({
      schedule: entry.schedule,
      barSpan: entry.barSpan,
      laneIndex: assignedLane,
    });
  }

  const laneCount = laneLastEndDays.length;
  return {
    items,
    laneCount,
    rowHeightPx: getGanttRowHeightPx(laneCount),
  };
}

