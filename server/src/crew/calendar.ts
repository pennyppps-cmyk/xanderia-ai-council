/**
 * Working days and business hours in Malaysia (Asia/Kuala_Lumpur, UTC+8 all year, no DST).
 * Dates are 'YYYY-MM-DD' strings in local (KL) time.
 */
const KL_OFFSET_MS = 8 * 3600_000;

export interface WorkCalendar {
  holidays: Set<string>;
  /** 0 = Sunday … 6 = Saturday. Most states: [0, 6]; Kedah/Kelantan/Terengganu use [5, 6]. */
  weekend: number[];
  startHour: number;
  endHour: number;
}

export const DEFAULT_CALENDAR: WorkCalendar = { holidays: new Set(), weekend: [0, 6], startHour: 9, endHour: 18 };

/** KL-local view of an instant. */
export function klParts(at: Date) {
  const d = new Date(at.getTime() + KL_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** The instant a KL-local date + hour begins. */
export function klInstant(date: string, hour = 0): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + hour * 3600_000 - KL_OFFSET_MS);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function isWorkingDay(date: string, cal: WorkCalendar) {
  return !cal.weekend.includes(weekdayOf(date)) && !cal.holidays.has(date);
}

/** The date n working days after `date` (n = 0 → `date` itself if it is a working day, else the next one). */
export function addWorkingDays(date: string, n: number, cal: WorkCalendar): string {
  let d = date;
  while (!isWorkingDay(d, cal)) d = addDays(d, 1);
  for (let i = 0; i < n; i++) {
    d = addDays(d, 1);
    while (!isWorkingDay(d, cal)) d = addDays(d, 1);
  }
  return d;
}

/** Working days strictly after `from` up to and including `to` (0 if `to` <= `from`). */
export function workingDaysBetween(from: string, to: string, cal: WorkCalendar): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}

export function isBusinessHours(at: Date, cal: WorkCalendar) {
  const p = klParts(at);
  return isWorkingDay(p.date, cal) && p.hour >= cal.startHour && p.hour < cal.endHour;
}

/** `at` if it is within business hours, otherwise the start of the next business window. */
export function nextBusinessMoment(at: Date, cal: WorkCalendar): Date {
  if (isBusinessHours(at, cal)) return at;
  const p = klParts(at);
  let date = p.date;
  if (!isWorkingDay(date, cal) || p.hour >= cal.endHour) date = addWorkingDays(addDays(date, 1), 0, cal);
  return klInstant(date, cal.startHour);
}
