import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, type WorkCalendar } from '../src/crew/calendar.js';
import { arrearsTasks, breachQuestion, DEFAULT_LIMITS, deductionTasks, portfolioBreaches } from '../src/work/data.js';
import { currentQuarter, goalQuestion, metricProgress } from '../src/work/goals.js';
import { matchOwner, weekdayDeadline } from '../src/work/meetings.js';
import { isRunDay, nthWorkingDay, periodOf } from '../src/work/periods.js';
import { pickOwner, readyToRelease, type StaffEntry } from '../src/work/plans.js';
import { groupWeek, weekEmail } from '../src/work/weekly.js';
import { isOverloaded, suggestAlternative, type Load } from '../src/work/workload.js';

const cal: WorkCalendar = { ...DEFAULT_CALENDAR, holidays: new Set(['2026-10-20']) }; // Deepavali (example)

describe('routine periods', () => {
  it('finds the month, quarter and ISO week of a date', () => {
    expect(periodOf('2026-10-14', 'monthly')).toMatchObject({ key: '2026-10', label: 'October 2026', start: '2026-10-01', end: '2026-10-31' });
    expect(periodOf('2026-11-30', 'quarterly')).toMatchObject({ key: '2026-Q4', start: '2026-10-01', end: '2026-12-31' });
    expect(periodOf('2026-10-14', 'weekly')).toMatchObject({ key: '2026-W42', start: '2026-10-12', end: '2026-10-18' });
    // 1 January 2027 is a Friday: it belongs to the last ISO week of 2026.
    expect(periodOf('2027-01-01', 'weekly').key).toBe('2026-W53');
  });

  it('counts working days, skipping weekends and holidays', () => {
    const oct = periodOf('2026-10-01', 'monthly');
    expect(nthWorkingDay(oct, 1, cal)).toBe('2026-10-01'); // Thursday
    expect(nthWorkingDay(oct, 3, cal)).toBe('2026-10-05'); // Thu, Fri, then Monday
    expect(nthWorkingDay(oct, 14, cal)).toBe('2026-10-21'); // the 20th is a holiday
    expect(nthWorkingDay(oct, 99, cal)).toBe('2026-10-30'); // past the end → the last working day
  });

  it('knows the run day', () => {
    expect(isRunDay('2026-11-02', 'monthly', 1, cal)).toBe(true); // 1 Nov is a Sunday
    expect(isRunDay('2026-11-01', 'monthly', 1, cal)).toBe(false);
    expect(isRunDay('2026-10-12', 'weekly', 1, cal)).toBe(true);
  });
});

describe('routine dependencies', () => {
  const t = (seq: number, status: string, depends_on: number[] = [], approved = true) => ({ id: `t${seq}`, seq, status, approved, depends_on });

  it('sends a waiting step only once everything it depends on is done', () => {
    expect(readyToRelease([t(1, 'sent'), t(2, 'draft', [1]), t(3, 'draft')])).toEqual(['t3']);
    expect(readyToRelease([t(1, 'done'), t(2, 'draft', [1]), t(3, 'draft', [1, 2])])).toEqual(['t2']);
    expect(readyToRelease([t(1, 'cancelled'), t(2, 'draft', [1])])).toEqual(['t2']);
    expect(readyToRelease([t(1, 'done'), t(2, 'draft', [1], false)])).toEqual([]); // not approved
  });
});

const staff = (over: Partial<StaffEntry> & { id: string; name: string }): StaffEntry => ({
  position: 'Collections Officer',
  email: `${over.id}@xanderia.com.my`,
  department_id: 'cc',
  manager_email: null,
  away_until: null,
  backup_id: null,
  ...over,
});

describe('owners on leave', () => {
  const people = [staff({ id: 'aina', name: 'Aina Rahman', away_until: '2026-10-16', backup_id: 'farid' }), staff({ id: 'farid', name: 'Farid Ali' })];
  it('gives the task to the backup while the owner is away', () => {
    expect(pickOwner('aina', '2026-10-15', people)).toEqual({ id: 'farid', note: 'Standing in for Aina Rahman, who is away until 2026-10-16.' });
    expect(pickOwner('aina', '2026-10-19', people)).toEqual({ id: 'aina', note: null });
    expect(pickOwner('farid', '2026-10-15', people)).toEqual({ id: 'farid', note: null });
  });
});

describe('tasks from data', () => {
  const b = (n: number, bal: number) => ({ accounts: n, balance: bal });
  const branch = (name: string, cur: number, d30: number, d60: number) => ({
    name,
    accounts: cur + d30 + d60,
    balance: 0,
    buckets: { Current: b(cur, cur * 1000), '1-30': b(d30, d30 * 1000), '31-60': b(d60, d60 * 1000), '61-90': b(0, 0), '91-180': b(0, 0), '181+': b(0, 0) },
  });

  it('makes one task per branch in arrears, largest first, with figures only', () => {
    const tasks = arrearsTasks([branch('KL', 100, 5, 1), branch('JB', 50, 20, 4), branch('SA', 80, 0, 0)], '2026-10-05');
    expect(tasks.map((t) => t.title)).toEqual(['Arrears follow-up: JB', 'Arrears follow-up: KL']);
    expect(tasks[0].description).toContain('24 accounts in arrears at JB, RM 24,000.00');
    expect(tasks[0].description).toContain('1-30: 20 (RM 20,000.00)');
    expect(tasks[0].ownerRole).toBe('Branch Manager JB');
  });

  it('groups deduction exceptions by kind and lists account numbers only when matched on them', () => {
    const r = {
      matchedOn: 'account' as const,
      counts: { missing: 2, short: 1, over: 0, unknown: 0 },
      exceptions: [
        { kind: 'missing' as const, key: 'L001', difference: -300 },
        { kind: 'missing' as const, key: 'L002', difference: -250.5 },
        { kind: 'short' as const, key: 'L003', difference: -40 },
      ],
    };
    const tasks = deductionTasks(r, '2026-10-05');
    expect(tasks.map((t) => t.title)).toEqual(['Loans with no salary deduction this month (2)', 'Loans deducted short this month (1)']);
    expect(tasks[0].description).toContain('RM 550.50');
    expect(tasks[0].description).toContain('Accounts: L001, L002.');
    const byIc = deductionTasks({ ...r, matchedOn: 'ic' }, '2026-10-05');
    expect(byIc[0].description).not.toContain('L001'); // IC numbers never go into an email
  });

  it('checks the portfolio against the limits', () => {
    const s = { nplRatio: 0.062, par: { par30: 0.1 }, byBranch: [{ name: 'JB', balance: 5e6, nplRatio: 0.09 }, { name: 'KL', balance: 9e6, nplRatio: 0.04 }] };
    const breaches = portfolioBreaches(s, { ...DEFAULT_LIMITS, enabled: true });
    expect(breaches).toEqual(['NPL ratio is 6.2%, above the 5% limit', 'Branch JB: NPL ratio 9.0%, above the 8% branch limit']);
    expect(breachQuestion('2026-09', breaches, '| x |')).toContain('- Branch JB: NPL ratio 9.0%');
  });
});

describe('meeting owners', () => {
  const everyone = [
    staff({ id: 'a1', name: 'Aina Rahman', position: 'Head of Collections' }),
    staff({ id: 'a2', name: 'Aina Sofea', position: 'Finance Executive' }),
    staff({ id: 'f1', name: 'Farid Ali', position: 'IT Manager' }),
  ];
  it('prefers the attendee with that name, then a unique name, then the role', () => {
    expect(matchOwner('Aina', [everyone[1]], everyone, null)).toBe('a2'); // the Aina who was in the room
    expect(matchOwner('Aina', [], everyone, null)).toBeNull(); // two Ainas and nobody in the room: ask
    expect(matchOwner('Farid', [], everyone, null)).toBe('f1');
    expect(matchOwner('IT Manager', [], everyone, null)).toBe('f1');
    expect(matchOwner('', [], everyone, null)).toBeNull();
  });

  it('works out weekday deadlines from the meeting date (the model gets them wrong)', () => {
    // Meeting on Monday 5 October 2026.
    expect(weekdayDeadline('by Friday', '2026-10-05')).toBe('2026-10-09');
    expect(weekdayDeadline('this Friday', '2026-10-05')).toBe('2026-10-09');
    expect(weekdayDeadline('by next Friday', '2026-10-05')).toBe('2026-10-16');
    expect(weekdayDeadline('Jumaat depan', '2026-10-05')).toBe('2026-10-16');
    expect(weekdayDeadline('next Monday', '2026-10-08')).toBe('2026-10-12'); // said on a Thursday
    expect(weekdayDeadline('12 Oct', '2026-10-05')).toBeNull();
    expect(weekdayDeadline('', '2026-10-05')).toBeNull();
  });
});

describe('workload', () => {
  const l = (id: string, open: number, overdue: number, over: Partial<Load> = {}): Load => ({
    id,
    name: id,
    position: 'Collections Officer',
    department_id: 'cc',
    open,
    overdue,
    due_this_week: 0,
    away_until: null,
    backup_id: null,
    ...over,
  });
  const limits = { open: 8, overdue: 3 };

  it('flags overload and suggests the least loaded colleague who is in', () => {
    const team = [l('aina', 9, 1), l('farid', 2, 0), l('siti', 1, 0, { away_until: '2026-12-01' }), l('ravi', 4, 0, { position: 'Finance Executive' })];
    expect(isOverloaded(team[0], limits)).toBe(true);
    expect(isOverloaded(l('x', 2, 3), limits)).toBe(true);
    expect(suggestAlternative(team[0], team, limits, '2026-10-01')?.id).toBe('farid'); // siti is away
    expect(suggestAlternative(l('z', 9, 0, { position: 'Nobody else' }), team, limits, '2026-10-01')?.id).toBe('farid'); // same department
  });
});

describe('weekly emails', () => {
  const t = (id: string, due: string | null, status = 'sent') => ({ id, title: `Task ${id}`, due, status, plan_title: 'Plan' });
  it('orders the week: overdue, due this week, stuck, then a few later ones', () => {
    const g = groupWeek([t('late', '2026-09-28'), t('fri', '2026-10-02'), t('help', '2026-10-01', 'blocked'), t('nov', '2026-11-10'), t('none', null)], '2026-09-30');
    expect(g.overdue.map((x) => x.id)).toEqual(['late']);
    expect(g.thisWeek.map((x) => x.id)).toEqual(['fri']);
    expect(g.stuck.map((x) => x.id)).toEqual(['help']);
    expect(g.later.map((x) => x.id)).toEqual(['nov', 'none']);
  });

  it('puts one-click links in the email and escapes titles', () => {
    const g = groupWeek([{ id: '00000000-0000-0000-0000-000000000001', title: 'Check <script> & file', due: '2026-10-01', status: 'sent', plan_title: 'P' }], '2026-09-30');
    const e = weekEmail('Aina Rahman', g, 'checkin');
    expect(e.subject).toContain('Friday check-in');
    expect(e.html).toContain('Check &lt;script&gt; &amp; file');
    expect(e.text).toMatch(/On track: .*\/api\/t\/.*\?a=start/);
    expect(e.html).toContain('Hi Aina,');
  });
});

describe('goals', () => {
  it('measures progress towards a target that goes up or down', () => {
    expect(metricProgress(24, 18, 21)).toBe(50); // roll rate coming down
    expect(metricProgress(100, 200, 250)).toBe(100);
    expect(metricProgress(24, 18, 26)).toBe(0);
    expect(metricProgress(null, 18, 20)).toBeNull();
  });

  it('knows the quarter in KL time and writes the planning question', () => {
    expect(currentQuarter(new Date('2026-09-30T20:00:00Z'))).toBe('2026-Q3'); // the caller passes KL-shifted time
    const q = goalQuestion({ title: 'Cut early arrears', description: '', quarter: '2026-Q4', metric: '1-30 → 31-60 roll rate', unit: '%', baseline: '24', target: '18', current: null }, 'Credit & Collections');
    expect(q).toContain('from 24 % to 18 % by the end of 2026-Q4');
    expect(q).toContain('milestones');
  });
});
