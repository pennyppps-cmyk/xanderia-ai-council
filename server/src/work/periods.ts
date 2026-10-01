import { addDays, isWorkingDay, type WorkCalendar } from '../crew/calendar.js';

/**
 * Periods of a routine (a week, a month or a quarter) and "the Nth working day" inside one.
 * Dates are 'YYYY-MM-DD' in Kuala Lumpur time, as everywhere in the crew calendar.
 */
export type Frequency = 'weekly' | 'monthly' | 'quarterly';

export interface Period {
  key: string; // 2026-10, 2026-Q4, 2026-W41
  label: string; // October 2026, Q4 2026, week of 5 Oct 2026
  start: string;
  end: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

/** ISO week number and its year (the week belongs to the year of its Thursday). */
function isoWeek(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // the Thursday of this week
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400_000 + 1) / 7);
  return { year, week };
}

export function periodOf(date: string, frequency: Frequency): Period {
  const [y, m] = date.split('-').map(Number);
  if (frequency === 'monthly') {
    return { key: date.slice(0, 7), label: `${MONTHS[m - 1]} ${y}`, start: `${date.slice(0, 7)}-01`, end: lastDayOfMonth(y, m - 1) };
  }
  if (frequency === 'quarterly') {
    const q = Math.floor((m - 1) / 3);
    const start = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    return { key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y}`, start, end: lastDayOfMonth(y, q * 3 + 2) };
  }
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(date, -weekday);
  const { year, week } = isoWeek(date);
  const [, sm, sd] = start.split('-').map(Number);
  return { key: `${year}-W${String(week).padStart(2, '0')}`, label: `week of ${sd} ${MONTHS_SHORT[sm - 1]} ${start.slice(0, 4)}`, start, end: addDays(start, 6) };
}

/** Working days of the period, in order. */
export function workingDays(p: Period, cal: WorkCalendar) {
  const out: string[] = [];
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) if (isWorkingDay(d, cal)) out.push(d);
  return out;
}

/** The Nth working day of the period (1-based); past the last one, the last one. */
export function nthWorkingDay(p: Period, n: number, cal: WorkCalendar) {
  const days = workingDays(p, cal);
  if (!days.length) return p.end;
  return days[Math.min(Math.max(n, 1), days.length) - 1];
}

/** Is `date` the day a routine with this run day should create its tasks? */
export function isRunDay(date: string, frequency: Frequency, runDay: number, cal: WorkCalendar) {
  return nthWorkingDay(periodOf(date, frequency), runDay, cal) === date;
}
