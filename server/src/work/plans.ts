import { writeAudit } from '../audit.js';
import { scrubEmailText } from '../crew/email.js';
import { resolveOwner, type DirectoryEntry } from '../crew/resolve.js';
import { query, tx } from '../db/pool.js';

/**
 * Plans that come from somewhere other than a council verdict: a routine's cycle, a data file
 * (arrears, deductions) or a meeting's action items. They land in the same review → approve →
 * email → Tracker flow as council plans; nothing is sent until the requester launches them
 * (or, for a routine set to launch by itself, until the routine runs).
 */
export interface SourceTask {
  title: string;
  description: string;
  ownerType?: 'human' | 'agent';
  ownerRole?: string;
  directoryId?: string | null;
  dueDate: string;
  dependsOn?: number[];
}

export interface StaffEntry extends DirectoryEntry {
  away_until: string | null;
  backup_id: string | null;
}

export async function loadStaff(): Promise<StaffEntry[]> {
  const { rows } = await query(
    `SELECT id, name, position, email, department_id, manager_email, to_char(away_until, 'YYYY-MM-DD') AS away_until, backup_id
       FROM staff_directory WHERE is_active ORDER BY name`,
  );
  return rows;
}

/**
 * Who does the task: the chosen person, or their backup when they are away on the due date.
 * Returns the note to add to the task when the backup stands in.
 */
export function pickOwner(personId: string, dueDate: string, staff: StaffEntry[]): { id: string; note: string | null } {
  const person = staff.find((s) => s.id === personId);
  if (!person?.away_until || person.away_until < dueDate) return { id: personId, note: null };
  const backup = person.backup_id ? staff.find((s) => s.id === person.backup_id) : undefined;
  if (!backup || (backup.away_until && backup.away_until >= dueDate)) return { id: personId, note: null };
  return { id: backup.id, note: `Standing in for ${person.name}, who is away until ${person.away_until}.` };
}

/** The note under "What you need to do" for routine, data and meeting tasks (the email template says the rest). */
export function taskEmailBody(context: string) {
  return context.trim() ? `Background: ${context.trim()}` : '';
}

export async function createSourcePlan(o: {
  requesterId: string;
  departmentId: string | null;
  title: string;
  source: 'routine' | 'data' | 'meeting';
  sourceId: string | null;
  context: string;
  tasks: SourceTask[];
}) {
  const staff = await loadStaff();
  const title = scrubEmailText(o.title).slice(0, 140);
  const planId = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO action_plans (requester_id, department_id, title, status, source, source_id, context)
       VALUES ($1, $2, $3, 'ready', $4, $5, $6) RETURNING id`,
      [o.requesterId, o.departmentId, title, o.source, o.sourceId, o.context.slice(0, 4000)],
    );
    const id = rows[0].id as string;
    for (const [i, t] of o.tasks.slice(0, 40).entries()) {
      const seq = i + 1;
      const isAgent = t.ownerType === 'agent';
      let directoryId: string | null = null;
      let resolution = isAgent ? 'agent' : 'unassigned';
      let candidates: DirectoryEntry[] = [];
      let note: string | null = null;
      if (isAgent && t.directoryId && staff.some((s) => s.id === t.directoryId)) {
        // The AI drafts it, then it goes to this person once the requester approves the draft.
        directoryId = pickOwner(t.directoryId, t.dueDate, staff).id;
      } else if (!isAgent && t.directoryId && staff.some((s) => s.id === t.directoryId)) {
        const pick = pickOwner(t.directoryId, t.dueDate, staff);
        directoryId = pick.id;
        note = pick.note;
        resolution = 'resolved';
      } else if (!isAgent && t.ownerRole) {
        const r = resolveOwner(t.ownerRole, staff, o.departmentId);
        resolution = r.resolution;
        candidates = r.candidates;
        if (r.directoryId) {
          const pick = pickOwner(r.directoryId, t.dueDate, staff);
          directoryId = pick.id;
          note = pick.note;
        }
      }
      const description = scrubEmailText(note ? `${t.description}\n\n${note}` : t.description).slice(0, 2000);
      const taskTitle = scrubEmailText(t.title).slice(0, 200);
      await c.query(
        `INSERT INTO action_tasks (plan_id, seq, title, description, owner_type, owner_role, directory_id, resolution,
                                   candidates, depends_on, due_date, email_subject, email_body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          seq,
          taskTitle,
          description,
          isAgent ? 'agent' : 'human',
          isAgent ? 'AI Runner' : (t.ownerRole ?? '').slice(0, 120) || null,
          directoryId,
          resolution,
          JSON.stringify(candidates.slice(0, 8).map((d) => ({ id: d.id, name: d.name, position: d.position, email: d.email }))),
          (t.dependsOn ?? []).filter((d) => d >= 1 && d < seq),
          t.dueDate,
          `[Xanderia AI Council] Task for you: ${taskTitle}`,
          taskEmailBody(o.context),
        ],
      );
    }
    return id;
  });
  await writeAudit({ actorUserId: o.requesterId, action: 'action_plan_created', targetType: 'action_plan', targetId: planId, detail: { source: o.source, source_id: o.sourceId, tasks: o.tasks.length } });
  return planId;
}

/**
 * Routine steps wait for the steps they depend on. Given each task's seq, status and
 * dependencies, which approved-but-waiting tasks can now be sent?
 */
export function readyToRelease(tasks: Array<{ id: string; seq: number; status: string; approved: boolean; depends_on: number[] }>) {
  const done = new Set(tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').map((t) => t.seq));
  return tasks.filter((t) => t.approved && t.status === 'draft' && t.depends_on.every((d) => done.has(d))).map((t) => t.id);
}
