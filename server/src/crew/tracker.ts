import { klParts, workingDaysBetween, type WorkCalendar } from './calendar.js';

export interface TrackerTimings {
  /** Remind the owner if the task is not acknowledged after this many working days. */
  ackReminderDays: number;
  /** Remind the owner this many working days before the due date. */
  dueReminderDaysBefore: number;
  /** Propose escalation to the manager after this many working days overdue. */
  escalateAfterDays: number;
  escalationEnabled: boolean;
}

export const DEFAULT_TIMINGS: TrackerTimings = {
  ackReminderDays: 1,
  dueReminderDaysBefore: 1,
  escalateAfterDays: 3,
  escalationEnabled: true,
};

export interface TrackedTask {
  status: string;
  owner_type: 'human' | 'agent';
  sent_at: Date | null;
  acknowledged_at: Date | null;
  due_date: string | null;
  ack_reminded_at: Date | null;
  due_reminded_at: Date | null;
  nudged_at: Date | null;
  escalation_state: 'none' | 'pending' | 'sent' | 'declined';
  snoozed_until: Date | null;
  has_manager: boolean;
}

export type TrackerAction = 'ack_reminder' | 'due_reminder' | 'nudge_requester' | 'propose_escalation';

const OPEN = new Set(['sent', 'accepted', 'in_progress', 'blocked']);

/** What the Tracker should do for one task right now. Pure: the caller performs the actions. */
export function trackerActions(t: TrackedTask, now: Date, cal: WorkCalendar, timings: TrackerTimings): TrackerAction[] {
  if (t.owner_type !== 'human' || !OPEN.has(t.status) || !t.sent_at) return [];
  if (t.snoozed_until && t.snoozed_until > now) return [];
  const today = klParts(now).date;
  const actions: TrackerAction[] = [];

  if (t.status === 'sent' && !t.acknowledged_at && !t.ack_reminded_at) {
    if (workingDaysBetween(klParts(t.sent_at).date, today, cal) >= timings.ackReminderDays) actions.push('ack_reminder');
  }

  if (t.due_date) {
    const remindOn = backWorkingDays(t.due_date, timings.dueReminderDaysBefore, cal);
    if (!t.due_reminded_at && today >= remindOn && today <= t.due_date && !actions.includes('ack_reminder')) {
      actions.push('due_reminder');
    }
    if (today > t.due_date) {
      if (!t.nudged_at) actions.push('nudge_requester');
      const overdue = workingDaysBetween(t.due_date, today, cal);
      if (timings.escalationEnabled && t.has_manager && t.escalation_state === 'none' && overdue >= timings.escalateAfterDays) {
        actions.push('propose_escalation');
      }
    }
  }
  return actions;
}

function backWorkingDays(date: string, n: number, cal: WorkCalendar) {
  let d = date;
  let left = n;
  while (left > 0) {
    const prev = new Date(`${d}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    d = prev.toISOString().slice(0, 10);
    if (!cal.weekend.includes(prev.getUTCDay()) && !cal.holidays.has(d)) left--;
  }
  return d;
}
