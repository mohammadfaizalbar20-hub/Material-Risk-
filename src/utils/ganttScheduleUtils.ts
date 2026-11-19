import { ProductionSchedule } from '../types/ppic';
import { formatPpicNumber } from './excelMaterialParser';

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

export const GANTT_ZOOM_LEVELS = [50, 75, 100, 125, 150] as const;
export type GanttZoomLevel = (typeof GANTT_ZOOM_LEVELS)[number];
export const DEFAULT_GANTT_ZOOM: GanttZoomLevel = 100;
export const GANTT_STICKY_LINE_COL_WIDTH_PX = 180;
export const GANTT_BASE_DAY_COL_WIDTH_PX = 48;

export function getGanttDayColumnWidthPx(zoomPercent: GanttZoomLevel): number {
  return Math.round((GANTT_BASE_DAY_COL_WIDTH_PX * zoomPercent) / 100);
}

export function getGanttBoardWidthPx(zoomPercent: GanttZoomLevel): number {
  return GANTT_STICKY_LINE_COL_WIDTH_PX + TOTAL_GRID_COLUMNS * getGanttDayColumnWidthPx(zoomPercent);
}

export function getNextGanttZoomLevel(
  current: GanttZoomLevel,
  direction: 'in' | 'out'
): GanttZoomLevel {
  const idx = GANTT_ZOOM_LEVELS.indexOf(current);
  const safeIdx = idx === -1 ? GANTT_ZOOM_LEVELS.indexOf(DEFAULT_GANTT_ZOOM) : idx;
  if (direction === 'in') {
    return GANTT_ZOOM_LEVELS[Math.min(GANTT_ZOOM_LEVELS.length - 1, safeIdx + 1)];
  }
  return GANTT_ZOOM_LEVELS[Math.max(0, safeIdx - 1)];
}

/**
 * Computes the horizontal scrollLeft after changing zoom so the date currently
 * centered in the visible date viewport stays anchored in view.
 */
export function computeZoomPreservedScrollLeft(params: {
  currentScrollLeft: number;
  clientWidth: number;
  prevZoom: GanttZoomLevel;
  nextZoom: GanttZoomLevel;
}): number {
  const { currentScrollLeft, clientWidth, prevZoom, nextZoom } = params;
  if (currentScrollLeft <= 0 || prevZoom === nextZoom) {
    return 0;
  }
  const prevColWidth = getGanttDayColumnWidthPx(prevZoom);
  const nextColWidth = getGanttDayColumnWidthPx(nextZoom);
  const visibleDateWidth = Math.max(0, clientWidth - GANTT_STICKY_LINE_COL_WIDTH_PX);
  const centerDatePos = (currentScrollLeft + visibleDateWidth / 2) / prevColWidth;
  const maxNextScroll = Math.max(0, getGanttBoardWidthPx(nextZoom) - clientWidth);
  const targetScroll = Math.round(centerDatePos * nextColWidth - visibleDateWidth / 2);
  return Math.max(0, Math.min(maxNextScroll, targetScroll));
}

/**
 * Computes horizontal scrollLeft so a target day (1..31) is centered within
 * the visible date viewport (to the right of the sticky Line Produksi column).
 */
export function computeScrollLeftForDay(params: {
  day: number;
  clientWidth: number;
  zoomPercent: GanttZoomLevel;
}): number {
  const { day, clientWidth, zoomPercent } = params;
  const clampedDay = Math.max(1, Math.min(TOTAL_GRID_COLUMNS, Math.floor(day)));
  const colWidth = getGanttDayColumnWidthPx(zoomPercent);
  const visibleDateWidth = Math.max(0, clientWidth - GANTT_STICKY_LINE_COL_WIDTH_PX);
  const dayCenterOffset = (clampedDay - 0.5) * colWidth;
  const maxScroll = Math.max(0, getGanttBoardWidthPx(zoomPercent) - clientWidth);
  const targetScroll = Math.round(dayCenterOffset - visibleDateWidth / 2);
  return Math.max(0, Math.min(maxScroll, targetScroll));
}

export interface GanttEscState {
  isGanttFullscreen: boolean;
  hasConfirmDelete: boolean;
  hasEditModal: boolean;
  hasDetailModal: boolean;
  hasConflictModal: boolean;
}

export type GanttEscAction =
  | 'close_confirm_delete'
  | 'close_edit_modal'
  | 'close_detail_modal'
  | 'close_conflict_modal'
  | 'exit_fullscreen'
  | 'noop';

/**
 * Resolves the highest-priority Escape key action so open modals/dialogs
 * always close before exiting Gantt Full Screen mode.
 */
export function resolveGanttEscAction(state: GanttEscState): GanttEscAction {
  if (state.hasConfirmDelete) return 'close_confirm_delete';
  if (state.hasEditModal) return 'close_edit_modal';
  if (state.hasDetailModal) return 'close_detail_modal';
  if (state.hasConflictModal) return 'close_conflict_modal';
  if (state.isGanttFullscreen) return 'exit_fullscreen';
  return 'noop';
}


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

export const DEFAULT_PRODUCTION_LINES = [
  'Line 1',
  'Line 3',
  'Line 4',
  'Line 5',
  'Line 7',
] as const;

const DEFAULT_PRODUCTION_LINE_ORDER = new Map<string, number>(
  DEFAULT_PRODUCTION_LINES.map((line, index) => [line.toLowerCase(), index])
);

export const UNASSIGNED_PRODUCTION_LINE_LABEL = 'Belum Ditentukan';
const LEGACY_PLACEHOLDER_LINES = new Set(['produksi', '-', 'belum ditentukan']);

/**
 * Returns true if the productionLine is blank or a legacy placeholder ('Produksi', '-').
 */
export function isUnassignedProductionLine(line: string | null | undefined): boolean {
  const trimmed = String(line || '').trim();
  if (!trimmed) return true;
  return LEGACY_PLACEHOLDER_LINES.has(trimmed.toLowerCase());
}

/**
 * Returns the trimmed real Production Line (e.g. 'Line 1'), or '' if unassigned / legacy 'Produksi'.
 */
export function normalizeAssignedProductionLine(line: string | null | undefined): string {
  const trimmed = String(line || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) return '';
  if (LEGACY_PLACEHOLDER_LINES.has(trimmed.toLowerCase())) return '';
  return trimmed;
}

export function getDisplayProductionLineLabel(line: string | null | undefined): string {
  return normalizeAssignedProductionLine(line) || UNASSIGNED_PRODUCTION_LINE_LABEL;
}

export interface GanttLineGroup<
  T extends Pick<ProductionSchedule, 'id' | 'productionDate' | 'finishDate' | 'productionLine'> = ProductionSchedule
> {
  lineKey: string;
  lineLabel: string;
  isUnassigned: boolean;
  schedules: T[];
  layout: GanttLineLayout<T>;
}

/**
 * Groups schedules by their assigned Production Line and computes non-overlapping lane layouts
 * independently per Line row for the viewed calendar month.
 * Always includes the 5 fixed Production Lines (Line 1, Line 3, Line 4, Line 5, Line 7)
 * even when they have no schedules in the active month.
 * Unassigned schedules (blank or legacy 'Produksi') are placed in a final 'Belum Ditentukan' row.
 */
export function groupSchedulesForGanttBoard<
  T extends Pick<ProductionSchedule, 'id' | 'productionDate' | 'finishDate' | 'productionLine'>
>(
  schedules: T[],
  params: {
    year: number;
    month0: number;
    daysInMonth?: number;
  }
): Array<GanttLineGroup<T>> {
  const buckets = new Map<
    string,
    { lineLabel: string; isUnassigned: boolean; schedules: T[] }
  >();

  // Always seed the 5 fixed Production Lines so empty lines remain visible on the board
  for (const fixedLine of DEFAULT_PRODUCTION_LINES) {
    buckets.set(fixedLine.toLowerCase(), {
      lineLabel: fixedLine,
      isUnassigned: false,
      schedules: [],
    });
  }

  for (const sch of schedules) {
    const assigned = normalizeAssignedProductionLine(sch.productionLine);
    const isUnassigned = assigned.length === 0;
    const key = isUnassigned ? '__UNASSIGNED__' : assigned.toLowerCase();
    const label = isUnassigned ? UNASSIGNED_PRODUCTION_LINE_LABEL : assigned;

    const existing = buckets.get(key);
    if (existing) {
      existing.schedules.push(sch);
    } else {
      buckets.set(key, {
        lineLabel: label,
        isUnassigned,
        schedules: [sch],
      });
    }
  }

  const groups: Array<GanttLineGroup<T>> = Array.from(buckets.entries()).map(([lineKey, bucket]) => ({
    lineKey,
    lineLabel: bucket.lineLabel,
    isUnassigned: bucket.isUnassigned,
    schedules: bucket.schedules,
    layout: layoutGanttLineSchedules(bucket.schedules, params),
  }));

  groups.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) {
      return a.isUnassigned ? 1 : -1;
    }
    const fixedIdxA = DEFAULT_PRODUCTION_LINE_ORDER.get(a.lineKey);
    const fixedIdxB = DEFAULT_PRODUCTION_LINE_ORDER.get(b.lineKey);
    if (fixedIdxA !== undefined && fixedIdxB !== undefined) {
      return fixedIdxA - fixedIdxB;
    }
    if (fixedIdxA !== undefined) return -1;
    if (fixedIdxB !== undefined) return 1;
    return a.lineLabel.localeCompare(b.lineLabel, 'id', { numeric: true, sensitivity: 'base' });
  });

  return groups;
}

export type GanttBarDensity = 'compact' | 'standard' | 'wide';

export interface GanttBarDisplayMeta {
  orNumber: string;
  orDisplay: string;
  whNumber: string;
  style: string;
  targetFormatted: string;
  targetUnit: string;
  targetDisplay: string;
  barWidthPx: number;
  density: GanttBarDensity;
  tooltipText: string;
}

/**
 * Resolves the 4 exact display fields for a Gantt schedule bar without modifying
 * or fabricating stored data:
 * - No. OR strictly from schedule.orNumber
 * - No. WH strictly from stored worksheetNo (WH/MO/...), never derived from orNumber
 * - Style strictly from schedule.style
 * - Target + unit strictly from schedule.target (preserving decimals) and stored targetUnit (fallback 'unit')
 */
export function resolveGanttBarDisplayMeta(params: {
  schedule: Pick<ProductionSchedule, 'orNumber' | 'style' | 'target' | 'targetUnit' | 'productionDate' | 'finishDate' | 'worksheets'>;
  durationDays: number;
  dayColWidthPx: number;
  lineLabel: string;
  hasConflict?: boolean;
}): GanttBarDisplayMeta {
  const { schedule, durationDays, dayColWidthPx, lineLabel, hasConflict } = params;

  const orNumber = String(schedule.orNumber || '').trim() || '-';
  const orDisplay =
    orNumber === '-'
      ? 'OR -'
      : /^OR\b/i.test(orNumber)
        ? orNumber
        : `OR ${orNumber}`;

  const rawWh = schedule.worksheets
    ?.find((w) => typeof w.worksheetNo === 'string' && w.worksheetNo.trim().length > 0)
    ?.worksheetNo?.trim();
  const whNumber = rawWh || '-';

  const style = String(schedule.style || '').trim() || '-';

  const targetFormatted = formatPpicNumber(schedule.target);
  const storedUnit =
    String(schedule.targetUnit || '').trim() ||
    schedule.worksheets
      ?.find((w) => typeof w.targetUnit === 'string' && w.targetUnit.trim().length > 0)
      ?.targetUnit?.trim() ||
    '';
  const targetUnit = storedUnit || 'unit';
  const targetDisplay = `${targetFormatted} ${targetUnit}`;

  const barWidthPx = Math.max(0, Math.round(durationDays * dayColWidthPx));
  const density: GanttBarDensity =
    barWidthPx >= 210 ? 'wide' : barWidthPx >= 110 ? 'standard' : 'compact';

  const tooltipLines = [
    `No. OR: ${orNumber}`,
    `No. WH: ${whNumber}`,
    `Style: ${style}`,
    `Target: ${targetDisplay}`,
    `Line: ${lineLabel} | ${schedule.productionDate} s/d ${schedule.finishDate}`,
  ];
  if (hasConflict) {
    tooltipLines.push('Status: Bentrok jadwal pada Line yang sama');
  }

  return {
    orNumber,
    orDisplay,
    whNumber,
    style,
    targetFormatted,
    targetUnit,
    targetDisplay,
    barWidthPx,
    density,
    tooltipText: tooltipLines.join('\n'),
  };
}

