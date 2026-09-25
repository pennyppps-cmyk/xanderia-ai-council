/**
 * Owner resolution: map the Dispatcher's owner_role to people in the staff directory.
 * People and email addresses only ever come from the directory; if nothing matches,
 * the task is left unassigned for the requester to decide.
 */
export interface DirectoryEntry {
  id: string;
  name: string;
  position: string;
  email: string;
  department_id: string | null;
  manager_email?: string | null;
}

export type Resolution =
  | { resolution: 'resolved'; directoryId: string; candidates: DirectoryEntry[] }
  | { resolution: 'choose'; directoryId: null; candidates: DirectoryEntry[] }
  | { resolution: 'unassigned'; directoryId: null; candidates: [] };

const STOP = new Set(['of', 'and', 'the', 'for', 'a', 'an', 'to', 'in', '&', 'dept', 'department', 'team']);

export function normaliseRole(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string) {
  return new Set(normaliseRole(s).split(' ').filter((t) => t && !STOP.has(t)));
}

function similarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function resolveOwner(role: string, directory: DirectoryEntry[], departmentId?: string | null): Resolution {
  const target = normaliseRole(role);
  if (!target) return { resolution: 'unassigned', directoryId: null, candidates: [] };

  const pick = (list: DirectoryEntry[]): Resolution => {
    if (list.length === 1) return { resolution: 'resolved', directoryId: list[0].id, candidates: list };
    // Several people hold the role: prefer the one in the plan's department, if exactly one is.
    const sameDept = departmentId ? list.filter((d) => d.department_id === departmentId) : [];
    if (sameDept.length === 1) return { resolution: 'resolved', directoryId: sameDept[0].id, candidates: list };
    return { resolution: 'choose', directoryId: null, candidates: list.slice(0, 8) };
  };

  const exact = directory.filter((d) => normaliseRole(d.position) === target);
  if (exact.length) return pick(exact);

  const scored = directory
    .map((d) => ({ d, s: similarity(role, d.position) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { resolution: 'unassigned', directoryId: null, candidates: [] };
  // A close fuzzy match is only proposed automatically when it is the single clear candidate.
  if (scored.length === 1 && scored[0].s >= 0.67) {
    return { resolution: 'resolved', directoryId: scored[0].d.id, candidates: [scored[0].d] };
  }
  return { resolution: 'choose', directoryId: null, candidates: scored.slice(0, 8).map((x) => x.d) };
}

export interface Collaborator {
  id: string;
  name: string;
  position: string;
  email: string;
  /** Why this person: "works on step 2" or the position the Dispatcher asked for. */
  reason: string;
}

/**
 * Who a task owner should work with: the owners of the steps this task depends on, then people
 * matching the positions the Dispatcher suggested. Only clear matches from the staff directory are
 * used (one person, or one in the plan's department); never the owner themself; at most 3.
 */
export function suggestCollaborators(
  workWith: string[],
  dependsOn: Array<{ seq: number; person: DirectoryEntry | null }>,
  directory: DirectoryEntry[],
  departmentId: string | null | undefined,
  ownerId: string | null,
): Collaborator[] {
  const out: Collaborator[] = [];
  const add = (d: DirectoryEntry, reason: string) => {
    if (d.id === ownerId || out.some((c) => c.id === d.id) || out.length >= 3) return;
    out.push({ id: d.id, name: d.name, position: d.position, email: d.email, reason });
  };
  for (const dep of dependsOn) if (dep.person) add(dep.person, `does step ${dep.seq}, which this task depends on`);
  for (const role of workWith) {
    const r = resolveOwner(role, directory, departmentId);
    const person = r.directoryId ? r.candidates.find((c) => c.id === r.directoryId) : null;
    if (person) add(person, `as ${role}`);
  }
  return out;
}
