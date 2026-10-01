import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { addWorkingDays, klParts } from '../crew/calendar.js';
import { loadCalendar } from '../crew/service.js';
import { query, tx } from '../db/pool.js';
import { getDocQueue } from '../queue/docQueue.js';
import { arrearsTasks, deductionTasks } from '../work/data.js';
import { currentQuarter, listGoals, planGoal } from '../work/goals.js';
import { minutesDocx, type StoredMinutes } from '../work/meetings.js';
import { createSourcePlan } from '../work/plans.js';
import { draftRoutineFromSop, runRoutine } from '../work/routines.js';
import { handOver, isOverloaded, loadWorkload, overloadLimits, suggestAlternative } from '../work/workload.js';
import { transcribe, voiceEnabled } from '../voice/transcribe.js';

/**
 * Work automation: recurring routines, tasks from data, meeting minutes, team workload and
 * quarterly goals. Every plan made here goes through the usual review → approve → email flow.
 */
const Uuid = z.object({ id: z.string().uuid() });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isLead = (req: FastifyRequest) => req.user.role === 'admin' || req.user.role === 'dept_lead';
const forbid = (reply: FastifyReply, msg = 'Department leads and admins only') => reply.code(403).send({ error: msg });

const StepBody = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(1000).default(''),
  owner_type: z.enum(['human', 'agent']).default('human'),
  owner_role: z.string().max(120).default(''),
  directory_id: z.string().uuid().nullable().default(null),
  due_day: z.number().int().min(1).max(60),
  depends_on: z.array(z.number().int().min(1)).max(20).default([]),
});
const RoutineBody = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().max(2000).default(''),
  department_id: z.string().uuid().nullable().default(null),
  frequency: z.enum(['weekly', 'monthly', 'quarterly']),
  run_day: z.number().int().min(1).max(20).default(1),
  auto_launch: z.boolean().default(false),
  active: z.boolean().default(true),
  steps: z.array(StepBody).min(1).max(25),
});

async function routineFor(req: FastifyRequest, id: string) {
  const { rows } = await query(`SELECT * FROM routines WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r) return null;
  const can = req.user.role === 'admin' || r.owner_id === req.user.id || (req.user.role === 'dept_lead' && r.department_id === req.user.department_id);
  return can ? r : null;
}

async function meetingFor(req: FastifyRequest, id: string) {
  const { rows } = await query(`SELECT * FROM meetings WHERE id = $1`, [id]);
  const m = rows[0];
  if (!m) return null;
  const can = req.user.role === 'admin' || m.created_by === req.user.id || (req.user.role === 'dept_lead' && m.department_id === req.user.department_id);
  return can ? m : null;
}

async function saveSteps(c: { query: (text: string, params?: unknown[]) => Promise<unknown> }, routineId: string, steps: z.infer<typeof StepBody>[]) {
  await c.query(`DELETE FROM routine_steps WHERE routine_id = $1`, [routineId]);
  for (const [i, s] of steps.entries()) {
    await c.query(
      `INSERT INTO routine_steps (routine_id, seq, title, description, owner_type, owner_role, directory_id, due_day, depends_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [routineId, i + 1, s.title, s.description, s.owner_type, s.owner_role, s.directory_id, s.due_day, s.depends_on.filter((d) => d <= i)],
    );
  }
}

export default async function workRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  // ── Routines ──
  app.get('/api/routines', auth, async (req) => {
    const { rows } = await query(
      `SELECT r.*, d.name AS department, u.display_name AS owner,
              (SELECT count(*) FROM routine_steps s WHERE s.routine_id = r.id)::int AS steps,
              (SELECT json_build_object('id', p.id, 'title', p.title, 'status', p.status,
                      'total', (SELECT count(*) FROM action_tasks t WHERE t.plan_id = p.id AND t.status <> 'cancelled'),
                      'done', (SELECT count(*) FROM action_tasks t WHERE t.plan_id = p.id AND t.status = 'done'))
                 FROM action_plans p WHERE p.source = 'routine' AND p.source_id = r.id ORDER BY p.created_at DESC LIMIT 1) AS last_plan
         FROM routines r LEFT JOIN departments d ON d.id = r.department_id JOIN users u ON u.id = r.owner_id
        WHERE $1 = 'admin' OR r.owner_id = $2 OR ($1 = 'dept_lead' AND r.department_id = $3)
        ORDER BY r.name`,
      [req.user.role, req.user.id, req.user.department_id],
    );
    return rows;
  });

  app.get('/api/routines/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const r = await routineFor(req, id);
    if (!r) return reply.code(404).send({ error: 'Not found' });
    const { rows: steps } = await query(
      `SELECT s.*, d.name AS owner_name, d.position AS owner_position FROM routine_steps s
         LEFT JOIN staff_directory d ON d.id = s.directory_id WHERE s.routine_id = $1 ORDER BY s.seq`,
      [id],
    );
    const { rows: history } = await query(
      `SELECT p.id, p.title, p.status, p.created_at,
              count(t.id) FILTER (WHERE t.status <> 'cancelled')::int AS total, count(t.id) FILTER (WHERE t.status = 'done')::int AS done,
              count(t.id) FILTER (WHERE t.status IN ('sent','accepted','in_progress','blocked') AND t.due_date < current_date)::int AS overdue
         FROM action_plans p LEFT JOIN action_tasks t ON t.plan_id = p.id
        WHERE p.source = 'routine' AND p.source_id = $1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 24`,
      [id],
    );
    return { ...r, steps, history };
  });

  app.post('/api/routines', auth, async (req, reply) => {
    if (!isLead(req)) return forbid(reply);
    const body = RoutineBody.parse(req.body);
    const id = await tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO routines (name, description, department_id, owner_id, frequency, run_day, auto_launch, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4) RETURNING id`,
        [body.name, body.description, body.department_id ?? req.user.department_id, req.user.id, body.frequency, body.run_day, body.auto_launch, body.active],
      );
      await saveSteps(c, rows[0].id, body.steps);
      return rows[0].id as string;
    });
    await writeAudit({ actorUserId: req.user.id, action: 'routine_created', targetType: 'routine', targetId: id, detail: { name: body.name, steps: body.steps.length } });
    return { id };
  });

  app.put('/api/routines/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await routineFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    const body = RoutineBody.parse(req.body);
    await tx(async (c) => {
      await c.query(
        `UPDATE routines SET name = $2, description = $3, department_id = COALESCE($4, department_id), frequency = $5, run_day = $6,
                auto_launch = $7, active = $8, updated_at = now() WHERE id = $1`,
        [id, body.name, body.description, body.department_id, body.frequency, body.run_day, body.auto_launch, body.active],
      );
      await saveSteps(c, id, body.steps);
    });
    await writeAudit({ actorUserId: req.user.id, action: 'routine_updated', targetType: 'routine', targetId: id, detail: { steps: body.steps.length, auto_launch: body.auto_launch, active: body.active } });
    return { ok: true };
  });

  app.delete('/api/routines/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await routineFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    await query(`DELETE FROM routines WHERE id = $1`, [id]);
    await writeAudit({ actorUserId: req.user.id, action: 'routine_deleted', targetType: 'routine', targetId: id, detail: {} });
    return { ok: true };
  });

  /** Creates this period's tasks now (e.g. to start a new routine mid-month). */
  app.post('/api/routines/:id/run', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await routineFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    const planId = await runRoutine(id, { force });
    if (!planId) return reply.code(409).send({ error: 'This period already has its tasks. Run it again anyway?', already: true });
    await writeAudit({ actorUserId: req.user.id, action: 'routine_run', targetType: 'routine', targetId: id, detail: { plan_id: planId, force } });
    return { planId };
  });

  /** A pasted SOP → a routine draft for the user to check (nothing is saved). */
  app.post('/api/routines/from-sop', auth, async (req, reply) => {
    if (!isLead(req)) return forbid(reply);
    const { text } = z.object({ text: z.string().trim().min(40).max(20_000) }).parse(req.body);
    try {
      return await draftRoutineFromSop(text, req.user.id, req.user.department_id);
    } catch (err) {
      return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
    }
  });

  // ── Tasks from data ──
  app.post('/api/tools/arrears/tasks', auth, async (req) => {
    const body = z
      .object({
        byBranch: z.array(z.object({ name: z.string().max(120), accounts: z.number(), balance: z.number(), buckets: z.record(z.string(), z.object({ accounts: z.number(), balance: z.number() })) })).min(1).max(200),
        dueInDays: z.number().int().min(1).max(30).default(3),
      })
      .parse(req.body);
    const due = addWorkingDays(klParts(new Date()).date, body.dueInDays, await loadCalendar());
    const tasks = arrearsTasks(body.byBranch as never, due);
    if (!tasks.length) throw Object.assign(new Error('No branch has accounts in arrears'), { statusCode: 400 });
    const planId = await createSourcePlan({
      requesterId: req.user.id,
      departmentId: req.user.department_id,
      title: `Arrears follow-up by branch, ${klParts(new Date()).date}`,
      source: 'data',
      sourceId: null,
      context: 'Arrears analysis of the latest collections export.',
      tasks,
    });
    return { planId };
  });

  // Up to 20,000 exceptions: larger than the default 1 MB body.
  app.post('/api/tools/deductions/tasks', { ...auth, bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const Kind = z.enum(['missing', 'short', 'over', 'unknown']);
    const body = z
      .object({
        matchedOn: z.enum(['account', 'ic', 'salaryNo']),
        counts: z.object({ missing: z.number(), short: z.number(), over: z.number(), unknown: z.number() }),
        exceptions: z.array(z.object({ kind: Kind, key: z.string().max(60), difference: z.number() })).max(20_000),
        dueInDays: z.number().int().min(1).max(30).default(3),
      })
      .parse(req.body);
    const due = addWorkingDays(klParts(new Date()).date, body.dueInDays, await loadCalendar());
    const tasks = deductionTasks(body, due);
    if (!tasks.length) throw Object.assign(new Error('There are no exceptions to follow up'), { statusCode: 400 });
    const planId = await createSourcePlan({
      requesterId: req.user.id,
      departmentId: req.user.department_id,
      title: `Salary-deduction exceptions, ${klParts(new Date()).date}`,
      source: 'data',
      sourceId: null,
      context: 'Salary-deduction reconciliation of the loan instalments against the employer / Angkasa file.',
      tasks,
    });
    return { planId };
  });

  // ── Meetings ──
  app.get('/api/meetings', auth, async (req) => {
    const { rows } = await query(
      `SELECT m.id, m.title, to_char(m.held_on, 'YYYY-MM-DD') AS held_on, m.status, m.plan_id, u.display_name AS created_by_name,
              COALESCE(jsonb_array_length(m.minutes->'actions'), 0) AS actions
         FROM meetings m LEFT JOIN users u ON u.id = m.created_by
        WHERE $1 = 'admin' OR m.created_by = $2 OR ($1 = 'dept_lead' AND m.department_id = $3)
        ORDER BY m.held_on DESC, m.created_at DESC LIMIT 100`,
      [req.user.role, req.user.id, req.user.department_id],
    );
    return rows;
  });

  app.get('/api/meetings/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const m = await meetingFor(req, id);
    if (!m) return reply.code(404).send({ error: 'Not found' });
    const { rows: people } = await query(`SELECT id, name, position FROM staff_directory WHERE id = ANY($1::uuid[])`, [m.attendees]);
    return { ...m, held_on: new Date(m.held_on.getTime() + 8 * 3600_000).toISOString().slice(0, 10), attendee_list: people, voice: voiceEnabled() };
  });

  const MeetingBody = z.object({
    title: z.string().trim().min(3).max(200),
    held_on: Day,
    language: z.enum(['en', 'ms']).default('en'),
    attendees: z.array(z.string().uuid()).max(60).default([]),
    notes: z.string().max(60_000).default(''),
  });

  app.post('/api/meetings', auth, async (req) => {
    const b = MeetingBody.parse(req.body);
    const { rows } = await query(
      `INSERT INTO meetings (title, held_on, language, attendees, notes, created_by, department_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [b.title, b.held_on, b.language, b.attendees, b.notes, req.user.id, req.user.department_id],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'meeting_created', targetType: 'meeting', targetId: rows[0].id, detail: { attendees: b.attendees.length } });
    return { id: rows[0].id };
  });

  app.put('/api/meetings/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const m = await meetingFor(req, id);
    if (!m) return reply.code(404).send({ error: 'Not found' });
    const b = MeetingBody.extend({
      minutes: z
        .object({
          summary: z.string().max(5000),
          decisions: z.array(z.string().max(1000)).max(50),
          actions: z.array(z.object({ task: z.string().max(300), owner: z.string().max(120), directory_id: z.string().uuid().nullable(), due_date: Day })).max(40),
          open_points: z.array(z.string().max(1000)).max(50),
        })
        .nullable()
        .optional(),
    }).parse(req.body);
    await query(
      `UPDATE meetings SET title = $2, held_on = $3, language = $4, attendees = $5, notes = $6,
              minutes = CASE WHEN $7::jsonb IS NULL THEN minutes ELSE $7::jsonb END, updated_at = now() WHERE id = $1`,
      [id, b.title, b.held_on, b.language, b.attendees, b.notes, b.minutes ? JSON.stringify(b.minutes) : null],
    );
    return { ok: true };
  });

  app.delete('/api/meetings/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await meetingFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    await query(`DELETE FROM meetings WHERE id = $1`, [id]);
    return { ok: true };
  });

  /** A recording → text for the notes box (on-premises Whisper; the audio is not kept). */
  app.post('/api/meetings/transcribe', auth, async (req, reply) => {
    if (!voiceEnabled()) return reply.code(400).send({ error: 'Voice is not switched on for this server. Type or paste the notes instead.' });
    let audio: { name: string; data: Buffer } | null = null;
    let lang = '';
    for await (const part of req.parts({ limits: { fileSize: 100 * 1024 * 1024 } })) {
      if (part.type === 'file') {
        const f = part as MultipartFile;
        audio = { name: f.filename, data: await f.toBuffer() };
        if (f.file.truncated) return reply.code(413).send({ error: 'The recording must be smaller than 100 MB' });
      } else if (part.fieldname === 'lang') lang = String((part as { value: unknown }).value ?? '');
    }
    if (!audio) return reply.code(400).send({ error: 'Choose a recording' });
    try {
      const text = await transcribe(audio.data, audio.name, { language: lang === 'ms' || lang === 'en' ? lang : undefined });
      await writeAudit({ actorUserId: req.user.id, action: 'meeting_transcribed', detail: { bytes: audio.data.length, chars: text.length } });
      return { text };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/meetings/:id/minutes', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const m = await meetingFor(req, id);
    if (!m) return reply.code(404).send({ error: 'Not found' });
    if (String(m.notes).trim().length < 40) return reply.code(400).send({ error: 'Add the meeting notes or a transcript first' });
    await query(`UPDATE meetings SET status = 'writing', error = NULL, updated_at = now() WHERE id = $1`, [id]);
    await getDocQueue().add('minutes', { type: 'minutes', meetingId: id }, { jobId: `minutes-${id}-${Date.now()}` });
    return { ok: true };
  });

  app.post('/api/meetings/:id/tasks', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const m = await meetingFor(req, id);
    if (!m) return reply.code(404).send({ error: 'Not found' });
    const min = m.minutes as StoredMinutes | null;
    if (!min?.actions.length) return reply.code(400).send({ error: 'The minutes have no action items' });
    if (m.plan_id) return { planId: m.plan_id };
    const planId = await createSourcePlan({
      requesterId: req.user.id,
      departmentId: m.department_id,
      title: `Actions from: ${m.title}`,
      source: 'meeting',
      sourceId: id,
      context: `Agreed at the meeting "${m.title}". ${min.summary}`.slice(0, 2000),
      tasks: min.actions.map((a) => ({
        title: a.task.slice(0, 200),
        description: `${a.task}\n\nAgreed at the meeting "${m.title}" on ${new Date(m.held_on.getTime() + 8 * 3600_000).toISOString().slice(0, 10)}.`,
        ownerRole: a.directory_id ? undefined : a.owner,
        directoryId: a.directory_id,
        dueDate: a.due_date,
      })),
    });
    await query(`UPDATE meetings SET plan_id = $2 WHERE id = $1`, [id, planId]);
    return { planId };
  });

  app.get('/api/meetings/:id/minutes.docx', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const m = await meetingFor(req, id);
    if (!m?.minutes) return reply.code(404).send({ error: 'No minutes yet' });
    const buf = await minutesDocx(id);
    const name = String(m.title).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'minutes';
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="Minutes-${name}.docx"`)
      .send(buf);
  });

  // ── Workload & team ──
  /** Load of the given people (plan review shows it next to each owner). */
  app.get('/api/crew/workload', auth, async (req) => {
    const { ids } = z.object({ ids: z.string().max(4000).default('') }).parse(req.query);
    const list = ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 60);
    if (!list.length) return [];
    const limits = await overloadLimits();
    const people = await loadWorkload({ ids: list });
    const departments = [...new Set(people.map((p) => p.department_id).filter(Boolean))] as string[];
    const pool = (await Promise.all(departments.map((d) => loadWorkload({ departmentId: d })))).flat();
    const today = klParts(new Date()).date;
    return people.map((p) => {
      const overloaded = isOverloaded(p, limits);
      const away = Boolean(p.away_until && p.away_until >= today);
      const alt = overloaded || away ? suggestAlternative(p, pool, limits, today) : null;
      return { ...p, overloaded, away, suggestion: alt ? { id: alt.id, name: alt.name, position: alt.position, open: alt.open } : null };
    });
  });

  app.get('/api/team', auth, async (req, reply) => {
    if (!isLead(req)) return forbid(reply);
    const { department } = z.object({ department: z.string().uuid().optional() }).parse(req.query);
    const dept = req.user.role === 'admin' ? department ?? req.user.department_id : req.user.department_id;
    const limits = await overloadLimits();
    const people = await loadWorkload({ departmentId: dept });
    const { rows: tasks } = await query(
      `SELECT t.id, t.title, t.status, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.directory_id, t.response_note, p.id AS plan_id, p.title AS plan_title
         FROM action_tasks t JOIN action_plans p ON p.id = t.plan_id AND p.status = 'launched'
         JOIN staff_directory s ON s.id = t.directory_id
        WHERE s.department_id = $1 AND t.owner_type = 'human' AND t.status IN ('sent', 'accepted', 'in_progress', 'blocked')
        ORDER BY t.due_date NULLS LAST`,
      [dept],
    );
    return { department_id: dept, limits, people: people.map((p) => ({ ...p, overloaded: isOverloaded(p, limits), tasks: tasks.filter((t) => t.directory_id === p.id) })) };
  });

  async function canManage(req: FastifyRequest, directoryId: string) {
    if (req.user.role === 'admin') return true;
    if (req.user.role !== 'dept_lead') return false;
    const { rows } = await query(`SELECT department_id FROM staff_directory WHERE id = $1`, [directoryId]);
    return rows[0]?.department_id === req.user.department_id;
  }

  app.patch('/api/team/:id/availability', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await canManage(req, id))) return forbid(reply);
    const b = z.object({ away_until: Day.nullable(), backup_id: z.string().uuid().nullable() }).parse(req.body);
    if (b.backup_id === id) return reply.code(400).send({ error: 'Choose someone else as the backup' });
    await query(`UPDATE staff_directory SET away_until = $2, backup_id = $3, updated_at = now() WHERE id = $1`, [id, b.away_until, b.backup_id]);
    await writeAudit({ actorUserId: req.user.id, action: 'staff_availability', targetType: 'staff_directory', targetId: id, detail: b });
    return { ok: true };
  });

  app.post('/api/team/:id/hand-over', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await canManage(req, id))) return forbid(reply);
    const { to } = z.object({ to: z.string().uuid() }).parse(req.body);
    try {
      return await handOver(id, to, req.user.id);
    } catch (err) {
      return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
    }
  });

  // ── Goals ──
  const GoalBody = z.object({
    title: z.string().trim().min(3).max(200),
    description: z.string().max(2000).default(''),
    quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
    department_id: z.string().uuid().nullable().default(null),
    metric_source: z.enum(['manual', 'npl_ratio', 'par30']).default('manual'),
    metric: z.string().max(120).default(''),
    unit: z.string().max(20).default(''),
    baseline: z.number().nullable().default(null),
    target: z.number().nullable().default(null),
    status: z.enum(['active', 'achieved', 'missed', 'dropped']).default('active'),
  });

  async function goalFor(req: FastifyRequest, id: string) {
    const { rows } = await query(`SELECT * FROM goals WHERE id = $1`, [id]);
    const g = rows[0];
    if (!g) return null;
    const can = req.user.role === 'admin' || g.owner_id === req.user.id || (req.user.role === 'dept_lead' && g.department_id === req.user.department_id);
    return can ? g : null;
  }

  app.get('/api/goals', auth, async (req) => {
    const { quarter } = z.object({ quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional() }).parse(req.query);
    const q = quarter ?? currentQuarter();
    return { quarter: q, goals: await listGoals(req.user, q) };
  });

  app.post('/api/goals', auth, async (req, reply) => {
    if (!isLead(req)) return forbid(reply);
    const b = GoalBody.parse(req.body);
    // Leads set goals for their own department; company-wide goals are for admins.
    const dept = req.user.role === 'admin' ? b.department_id : req.user.department_id;
    const { rows } = await query(
      `INSERT INTO goals (title, description, quarter, department_id, owner_id, metric_source, metric, unit, baseline, target, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [b.title, b.description, b.quarter, dept, req.user.id, b.metric_source, b.metric, b.unit, b.baseline, b.target, b.status],
    );
    await writeAudit({ actorUserId: req.user.id, action: 'goal_created', targetType: 'goal', targetId: rows[0].id, detail: { quarter: b.quarter } });
    return { id: rows[0].id };
  });

  app.put('/api/goals/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await goalFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    const b = GoalBody.parse(req.body);
    await query(
      `UPDATE goals SET title = $2, description = $3, quarter = $4, metric_source = $5, metric = $6, unit = $7, baseline = $8, target = $9, status = $10, updated_at = now() WHERE id = $1`,
      [id, b.title, b.description, b.quarter, b.metric_source, b.metric, b.unit, b.baseline, b.target, b.status],
    );
    return { ok: true };
  });

  app.delete('/api/goals/:id', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await goalFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    await query(`DELETE FROM goals WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.post('/api/goals/:id/checkin', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await goalFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    const b = z.object({ value: z.number().nullable(), note: z.string().max(1000).default('') }).parse(req.body);
    await query(`INSERT INTO goal_checkins (goal_id, value, note, recorded_by) VALUES ($1, $2, $3, $4)`, [id, b.value, b.note, req.user.id]);
    if (b.value != null) await query(`UPDATE goals SET current = $2, updated_at = now() WHERE id = $1`, [id, b.value]);
    return { ok: true };
  });

  app.get('/api/goals/:id/checkins', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    const { rows: g } = await query(`SELECT department_id FROM goals WHERE id = $1`, [id]);
    if (!g[0] || (req.user.role !== 'admin' && g[0].department_id && g[0].department_id !== req.user.department_id)) return reply.code(404).send({ error: 'Not found' });
    const { rows } = await query(
      `SELECT c.value, c.note, c.created_at, u.display_name AS by FROM goal_checkins c LEFT JOIN users u ON u.id = c.recorded_by WHERE c.goal_id = $1 ORDER BY c.created_at DESC LIMIT 50`,
      [id],
    );
    return rows;
  });

  app.post('/api/goals/:id/plan', auth, async (req, reply) => {
    const { id } = Uuid.parse(req.params);
    if (!(await goalFor(req, id))) return reply.code(404).send({ error: 'Not found' });
    const r = await planGoal(id, req.user);
    await writeAudit({ actorUserId: req.user.id, action: 'goal_planned', targetType: 'goal', targetId: id, detail: { message_id: r.messageId } });
    return r;
  });
}
