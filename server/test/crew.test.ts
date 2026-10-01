import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  isBusinessHours,
  klInstant,
  nextBusinessMoment,
  workingDaysBetween,
  type WorkCalendar,
} from '../src/crew/calendar.js';
import { parseCsv } from '../src/crew/csv.js';
import { allowedRecipient, buildTaskEmail } from '../src/crew/email.js';
import { resolveOwner, type DirectoryEntry } from '../src/crew/resolve.js';
import { signTaskToken, verifyTaskToken } from '../src/crew/tokens.js';
import { DEFAULT_TIMINGS, trackerActions, type TrackedTask } from '../src/crew/tracker.js';

// 2026-09-25 is a Friday; 2026-09-26/27 the weekend.
const cal: WorkCalendar = { holidays: new Set(['2026-09-30']), weekend: [0, 6], startHour: 9, endHour: 18 };

describe('Malaysian working-day calendar', () => {
  it('skips weekends and public holidays', () => {
    expect(addWorkingDays('2026-09-25', 1, cal)).toBe('2026-09-28'); // Fri + 1 → Mon
    expect(addWorkingDays('2026-09-29', 1, cal)).toBe('2026-10-01'); // Tue + 1 skips the 30th holiday
    expect(addWorkingDays('2026-09-26', 0, cal)).toBe('2026-09-28'); // Saturday rolls to Monday
    expect(workingDaysBetween('2026-09-25', '2026-10-02', cal)).toBe(4); // Mon, Tue, Thu, Fri
  });

  it('honours Kedah/Kelantan/Terengganu-style Friday-Saturday weekends', () => {
    const east = { ...cal, weekend: [5, 6] };
    expect(addWorkingDays('2026-09-24', 1, east)).toBe('2026-09-27'); // Thu + 1 → Sun
  });

  it('only sends inside business hours and defers to the next window', () => {
    expect(isBusinessHours(klInstant('2026-09-25', 10), cal)).toBe(true);
    expect(isBusinessHours(klInstant('2026-09-25', 19), cal)).toBe(false);
    expect(isBusinessHours(klInstant('2026-09-26', 10), cal)).toBe(false);
    expect(nextBusinessMoment(klInstant('2026-09-25', 19), cal).toISOString()).toBe(klInstant('2026-09-28', 9).toISOString());
    expect(nextBusinessMoment(klInstant('2026-09-28', 7), cal).toISOString()).toBe(klInstant('2026-09-28', 9).toISOString());
  });
});

const dir: DirectoryEntry[] = [
  { id: '1', name: 'Nur Ain', position: 'Collections Manager', email: 'ain@xanderia.com.my', department_id: 'cc' },
  { id: '2', name: 'Ravi Kumar', position: 'Credit Analyst', email: 'ravi@xanderia.com.my', department_id: 'cc' },
  { id: '3', name: 'Mei Ling', position: 'Credit Analyst', email: 'mei@xanderia.com.my', department_id: 'fin' },
  { id: '4', name: 'Hafiz', position: 'Head of Credit', email: 'hafiz@xanderia.com.my', department_id: 'cc' },
];

describe('owner resolution (never invents people)', () => {
  it('resolves an exact single match', () => {
    expect(resolveOwner('collections manager', dir)).toMatchObject({ resolution: 'resolved', directoryId: '1' });
  });

  it('asks the requester to choose when several people hold the role', () => {
    const r = resolveOwner('Credit Analyst', dir);
    expect(r.resolution).toBe('choose');
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['2', '3']);
  });

  it("prefers the plan's department when that makes it unambiguous", () => {
    expect(resolveOwner('Credit Analyst', dir, 'fin')).toMatchObject({ resolution: 'resolved', directoryId: '3' });
  });

  it('marks unknown roles unassigned instead of guessing', () => {
    expect(resolveOwner('Chief Marketing Officer', dir)).toEqual({ resolution: 'unassigned', directoryId: null, candidates: [] });
    expect(resolveOwner('', dir).resolution).toBe('unassigned');
  });

  it('only ever returns directory entries', () => {
    for (const role of ['Head of Credit', 'Credit', 'Collections', 'Manager of Collections']) {
      for (const c of resolveOwner(role, dir).candidates) expect(dir).toContain(c);
    }
  });
});

describe('signed task links', () => {
  it('verifies, rejects tampering and expiry', () => {
    const tok = signTaskToken('task-1', 'secret', 1, Date.parse('2026-09-25T00:00:00Z'));
    expect(verifyTaskToken(tok, 'secret', Date.parse('2026-09-25T12:00:00Z'))).toEqual({ taskId: 'task-1' });
    expect(verifyTaskToken(tok, 'other-secret', Date.parse('2026-09-25T12:00:00Z'))).toBeNull();
    expect(verifyTaskToken(tok.slice(0, -2) + 'AA', 'secret', Date.parse('2026-09-25T12:00:00Z'))).toBeNull();
    expect(verifyTaskToken(tok, 'secret', Date.parse('2026-09-27T00:00:00Z'))).toBeNull();
    expect(verifyTaskToken('garbage', 'secret')).toBeNull();
  });
});

describe('task emails (acceptance: no IC or account numbers)', () => {
  const base = {
    ownerName: 'Ain',
    title: 'Call customer 880212-10-5566 about account 1234 5678 9012',
    body: 'Please contact the borrower (IC 880212105566, acct 5550001112223) and Encik Razak on 012-3456789.',
    dueDate: '2026-10-01',
    requesterName: 'Andrew Chong',
    planTitle: 'Collections pilot for IC 900101-14-5678',
    links: { accept: 'https://x/a', help: 'https://x/h', done: 'https://x/d', cant: 'https://x/c', open: 'https://x/o' },
  };

  for (const kind of ['task', 'reminder', 'escalation'] as const) {
    it(`strips identifiers from a ${kind} email`, () => {
      const e = buildTaskEmail({ ...base, kind, assigneeName: 'Ain' });
      const all = `${e.subject}\n${e.text}\n${e.html}`;
      expect(all).not.toMatch(/\d{6}[\s-]?\d{2}[\s-]?\d{4}/); // IC
      expect(all).not.toMatch(/\d(?:[\s-]?\d){7,}/); // account / phone
      expect(all).not.toContain('Razak');
    });
  }

  it('includes the one-click links and escapes HTML', () => {
    const e = buildTaskEmail({ ...base, kind: 'task', title: 'Fix <script> tag', body: 'Hello <b>there</b>' });
    expect(e.text).toContain('Accept: https://x/a');
    expect(e.html).toContain('href="https://x/c"');
    expect(e.html).not.toContain('<script>');
    expect(e.html).not.toContain('<b>there</b>');
  });

  it('reads as a proper letter: addressed by name, the task clearly stated, then how to respond', () => {
    const e = buildTaskEmail({
      ...base,
      kind: 'task',
      ownerName: 'Aina Rahman',
      title: 'Draft the SMS reminder script',
      whatToDo: 'Write a two-line SMS reminder in BM and English for 1-30 DPD customers and send it to Compliance.',
      body: 'The pilot starts in January, so the script needs Compliance approval first.',
      planTitle: 'SMS reminder pilot',
    });
    expect(e.subject).toBe('Task assigned to you: Draft the SMS reminder script (due Thursday, 1 October 2026)');
    expect(e.text.startsWith('Dear Aina Rahman,\n\nAndrew Chong has assigned you the following task, as part of "SMS reminder pilot".')).toBe(true);
    expect(e.text).toContain('WHAT YOU NEED TO DO\nWrite a two-line SMS reminder');
    expect(e.text).toContain('The pilot starts in January');
    expect(e.text).toContain('Regards,\nAndrew Chong');
    expect(e.html).toContain('Dear Aina Rahman,');
    expect(e.html).toContain('WHAT YOU NEED TO DO');
  });

  it('does not repeat the task when the note is the same text', () => {
    const e = buildTaskEmail({ ...base, kind: 'task', ownerName: 'Aina', title: 'Check the file', whatToDo: 'Check the Angkasa file.', body: 'Check the Angkasa file.' });
    expect(e.text.match(/Check the Angkasa file\./g)).toHaveLength(1);
  });

  it('reminders and escalations say why they are sent', () => {
    const r = buildTaskEmail({ ...base, kind: 'reminder', ownerName: 'Aina', title: 'Check the file', whatToDo: 'x', body: '', reminderNote: 'We have not yet heard whether you can take it on.' });
    expect(r.text).toContain('This is a reminder about the task below, assigned to you by Andrew Chong. We have not yet heard');
    const x = buildTaskEmail({ ...base, kind: 'escalation', ownerName: 'Aina', assigneeName: 'Aina', title: 'Check the file', body: '' });
    expect(x.text.startsWith('Dear Sir/Madam,')).toBe(true);
    expect(x.text).toContain('assigned to Aina, is overdue');
  });

  it('allows internal domains only', () => {
    expect(allowedRecipient('ain@xanderia.com.my', ['xanderia.com.my'])).toBe(true);
    expect(allowedRecipient('AIN@Xanderia.com.my', ['@xanderia.com.my'])).toBe(true);
    expect(allowedRecipient('ain@gmail.com', ['xanderia.com.my'])).toBe(false);
    expect(allowedRecipient('ain@xanderia.com.my.evil.com', ['xanderia.com.my'])).toBe(false);
  });
});

describe('Tracker schedule (acceptance: reminder + requester nudge; shortened timer)', () => {
  const task = (over: Partial<TrackedTask> = {}): TrackedTask => ({
    status: 'sent',
    owner_type: 'human',
    sent_at: klInstant('2026-09-24', 10), // Thursday
    acknowledged_at: null,
    due_date: '2026-10-02',
    ack_reminded_at: null,
    due_reminded_at: null,
    nudged_at: null,
    escalation_state: 'none',
    snoozed_until: null,
    has_manager: true,
    ...over,
  });

  it('reminds the owner after 1 working day without acknowledgement', () => {
    expect(trackerActions(task(), klInstant('2026-09-24', 16), cal, DEFAULT_TIMINGS)).toEqual([]);
    expect(trackerActions(task(), klInstant('2026-09-25', 10), cal, DEFAULT_TIMINGS)).toEqual(['ack_reminder']);
    expect(trackerActions(task({ ack_reminded_at: new Date() }), klInstant('2026-09-25', 10), cal, DEFAULT_TIMINGS)).toEqual([]);
  });

  it('reminds 1 working day before the due date', () => {
    const t = task({ status: 'accepted', acknowledged_at: new Date() });
    expect(trackerActions(t, klInstant('2026-10-01', 10), cal, DEFAULT_TIMINGS)).toEqual(['due_reminder']);
  });

  it('nudges the requester when overdue, and proposes escalation after 3 working days', () => {
    const t = task({ status: 'in_progress', acknowledged_at: new Date(), due_reminded_at: new Date() });
    expect(trackerActions(t, klInstant('2026-10-05', 10), cal, DEFAULT_TIMINGS)).toEqual(['nudge_requester']);
    expect(trackerActions({ ...t, nudged_at: new Date() }, klInstant('2026-10-07', 10), cal, DEFAULT_TIMINGS)).toEqual(['propose_escalation']);
  });

  it('never escalates when disabled, without a manager, or while snoozed', () => {
    const t = task({ status: 'in_progress', acknowledged_at: new Date(), due_reminded_at: new Date(), nudged_at: new Date() });
    const late = klInstant('2026-10-09', 10);
    expect(trackerActions(t, late, cal, { ...DEFAULT_TIMINGS, escalationEnabled: false })).toEqual([]);
    expect(trackerActions({ ...t, has_manager: false }, late, cal, DEFAULT_TIMINGS)).toEqual([]);
    expect(trackerActions({ ...t, snoozed_until: klInstant('2026-10-12', 0) }, late, cal, DEFAULT_TIMINGS)).toEqual([]);
  });

  it('ignores drafts, finished tasks and agent tasks', () => {
    const late = klInstant('2026-10-09', 10);
    for (const over of [{ status: 'draft' }, { status: 'done' }, { owner_type: 'agent' as const }, { sent_at: null }]) {
      expect(trackerActions(task(over), late, cal, DEFAULT_TIMINGS)).toEqual([]);
    }
  });
});

describe('CSV import parser', () => {
  it('handles quotes, commas, CRLF, BOM and semicolon exports', () => {
    expect(parseCsv('﻿name,position,email\r\n"Tan, Ah Kow",Head of Credit,tan@x.my\r\n\r\n')).toEqual([
      ['name', 'position', 'email'],
      ['Tan, Ah Kow', 'Head of Credit', 'tan@x.my'],
    ]);
    expect(parseCsv('name;position\nAin;"Manager ""Collections"""')).toEqual([
      ['name', 'position'],
      ['Ain', 'Manager "Collections"'],
    ]);
  });
});

describe('cleanEmailBody', () => {
  it("strips echoed tags, the model's own greeting and sign-off", async () => {
    const { cleanEmailBody } = await import('../src/crew/email.js');
    const raw = '<document>\nDear Head of Credit,\n\nPlease design the product.\n\nIt matters because X.\n\nBest regards,\nThe Council\n</document>';
    expect(cleanEmailBody(raw)).toBe('Please design the product.\n\nIt matters because X.');
    expect(cleanEmailBody('Hi Ain,\nPlease call.\nTerima kasih')).toBe('Please call.');
  });
});

describe('who to work with', () => {
  it('suggests dependency owners and matching directory positions, never the owner or invented people', async () => {
    const { suggestCollaborators } = await import('../src/crew/resolve.js');
    const { withContacts } = await import('../src/crew/service.js');
    const dir = [
      { id: '1', name: 'Siti Aminah', position: 'HR Manager', email: 'siti@xanderia.com.my', department_id: 'hr' },
      { id: '2', name: 'Kumar Raj', position: 'Finance Manager', email: 'kumar@xanderia.com.my', department_id: 'fin' },
      { id: '3', name: 'Aisyah Tan', position: 'Collections Manager', email: 'aisyah@xanderia.com.my', department_id: 'cc' },
    ];
    const c = suggestCollaborators(['Finance Manager', 'Chief Wizard', 'Collections Manager'], [{ seq: 1, person: dir[0] }], dir, 'cc', '3');
    expect(c.map((x) => x.name)).toEqual(['Siti Aminah', 'Kumar Raj']);
    expect(c[0].reason).toMatch(/step 1/);
    const body = withContacts('Please draft the budget.', c, 'English');
    expect(body).toContain('Who to work with:');
    expect(body).toContain('- Kumar Raj, Finance Manager (kumar@xanderia.com.my): as Finance Manager');
    expect(withContacts('x', [], 'English')).toBe('x');
  });
});
