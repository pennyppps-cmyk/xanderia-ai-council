import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import { processMessage } from './council/pipeline.js';
import { dispatchPlan, runAgentTask, sendQueuedEmails, trackerTick } from './crew/service.js';
import { sendQueuedNotis } from './notis/send.js';
import { sendQueuedMerge } from './routes/merge.js';
import { migrate } from './db/migrate.js';
import { pool, query } from './db/pool.js';
import { seed } from './db/seed.js';
import { CREW_QUEUE, enqueueRunner, type CrewJob } from './queue/crewQueue.js';
import { DOC_QUEUE, enqueueDocumentWrite, type DocJob } from './queue/docQueue.js';
import { rewriteSection, writeDocument } from './documents/service.js';
import { writeMinutes } from './work/meetings.js';
import { routineTick } from './work/routines.js';
import { weeklyEmails } from './work/weekly.js';
import { createPublisher } from './queue/events.js';
import { QUEUE_NAME, type MessageJob } from './queue/queue.js';
import { createRedis, redis } from './redis.js';
import { runRetention } from './retention.js';
import { decisionCheckIns, knowledgeFreshness, monthlyImprovementReport, weeklyDigests } from './jobs.js';
import { backfillDecisionEmbeddings } from './memory/memory.js';
import { onboardingNudges } from './onboarding.js';
import { embed } from './llm/registry.js';
import { getSetting } from './settings.js';
import { startTelegramPolling } from './telegram/bot.js';

await migrate();
await seed();

const events = createPublisher(redis);

// Real GPU concurrency is enforced by the per-provider PriorityGate (OLLAMA_NUM_PARALLEL
// slots, Quick ahead of Council). Worker concurrency only needs to be high enough that a
// Quick job is never stuck behind running council jobs waiting for a BullMQ slot.
const worker = new Worker<MessageJob>(
  QUEUE_NAME,
  async (job) => {
    await processMessage(job.data.messageId, events);
  },
  { connection: createRedis(), concurrency: config.WORKER_CONCURRENCY, lockDuration: 120_000 },
);

worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));
worker.on('ready', () => console.log(`[worker] ready, concurrency ${config.WORKER_CONCURRENCY}`));

// Action Crew: Dispatcher and Runner jobs. Their model calls run at background priority,
// so they never slow down chat (HANDOFF §14.7).
const crewWorker = new Worker<CrewJob>(
  CREW_QUEUE,
  async (job) => {
    if (job.data.type === 'dispatch') await dispatchPlan(job.data.planId);
    else await runAgentTask(job.data.taskId);
  },
  { connection: createRedis(), concurrency: 2, lockDuration: 300_000 },
);
crewWorker.on('failed', (job, err) => console.error(`[crew] job ${job?.id} failed:`, err.message));

// Official documents: one section per model call, one document at a time, at background priority.
const docWorker = new Worker<DocJob>(
  DOC_QUEUE,
  async (job) => {
    if (job.data.type === 'write') await writeDocument(job.data.documentId, events);
    else if (job.data.type === 'rewrite') await rewriteSection(job.data.documentId, job.data.key, job.data.instruction, events);
    else await writeMinutes(job.data.meetingId);
  },
  { connection: createRedis(), concurrency: 1, lockDuration: 600_000 },
);
docWorker.on('failed', (job, err) => console.error(`[documents] job ${job?.id} failed:`, err.message));

// Maintenance: nightly retention, the Tracker every 15 minutes, the email sender every minute.
const maintenance = new Queue('maintenance', { connection: createRedis() });
await maintenance.upsertJobScheduler('retention', { pattern: '0 3 * * *' }, { name: 'retention' });
await maintenance.upsertJobScheduler('tracker', { pattern: '*/15 * * * *' }, { name: 'tracker' });
await maintenance.upsertJobScheduler('mailer', { pattern: '* * * * *' }, { name: 'mailer' });
// Decision outcome check-ins, daily at 09:05 KL time (01:05 UTC).
await maintenance.upsertJobScheduler('checkins', { pattern: '5 1 * * *' }, { name: 'checkins' });
// Knowledge freshness daily at 09:15 KL; the department heads' digest on Mondays at 08:00 KL.
await maintenance.upsertJobScheduler('freshness', { pattern: '15 1 * * *' }, { name: 'freshness' });
await maintenance.upsertJobScheduler('digest', { pattern: '0 0 * * 1' }, { name: 'digest' });
// Improvement report to admins on the 1st of each month, 09:00 KL.
await maintenance.upsertJobScheduler('improvement', { pattern: '0 1 1 * *' }, { name: 'improvement' });
// Routines create their cycle's tasks at 07:30 KL on their run day; weekly plan Monday 08:00 KL,
// Friday check-in 15:00 KL (both off until switched on in Settings).
await maintenance.upsertJobScheduler('routines', { pattern: '30 23 * * *' }, { name: 'routines' });
await maintenance.upsertJobScheduler('weekplan', { pattern: '0 0 * * 1' }, { name: 'weekplan' });
await maintenance.upsertJobScheduler('weekcheckin', { pattern: '0 7 * * 5' }, { name: 'weekcheckin' });
// Company memory: decisions recorded before memory existed get embedded once.
void backfillDecisionEmbeddings(pool, (t) => embed(t, { purpose: 'memory_index' }))
  .then((n) => n && console.log(`[memory] indexed ${n} past decision(s)`))
  .catch(() => {});

// Telegram bot (when TELEGRAM_BOT_TOKEN is set): long polling, one poller across workers.
void startTelegramPolling();

const maintenanceWorker = new Worker(
  'maintenance',
  async (job) => {
    if (job.name === 'tracker') {
      const n = await trackerTick();
      if (n) console.log(`[tracker] ${n} action(s)`);
    } else if (job.name === 'checkins') {
      const nudges = await onboardingNudges().catch((err) => (console.error('[onboarding]', err), { welcomed: 0, reminded: 0 }));
      if (nudges.welcomed || nudges.reminded) console.log(`[onboarding] welcomed ${nudges.welcomed}, reminded ${nudges.reminded}`);
      const n = await decisionCheckIns();
      if (n) console.log(`[checkins] ${n} decision check-in(s) sent`);
    } else if (job.name === 'freshness') {
      const n = await knowledgeFreshness();
      if (n) console.log(`[freshness] ${n} stale document(s) flagged`);
    } else if (job.name === 'digest') {
      if (await getSetting('weekly_digest_enabled', true)) console.log(`[digest] ${await weeklyDigests()} digest(s) queued`);
    } else if (job.name === 'routines') {
      const n = await routineTick();
      if (n) console.log(`[routines] ${n} cycle(s) created`);
    } else if (job.name === 'weekplan' || job.name === 'weekcheckin') {
      const n = await weeklyEmails(job.name === 'weekplan' ? 'plan' : 'checkin');
      if (n) console.log(`[${job.name}] ${n} email(s) queued`);
    } else if (job.name === 'improvement') {
      console.log(`[improvement] report queued for ${await monthlyImprovementReport()} admin(s)`);
    } else if (job.name === 'mailer') {
      const n = await sendQueuedEmails();
      if (n) console.log(`[mailer] processed ${n} email(s)`);
      const notis = await sendQueuedNotis();
      if (notis) console.log(`[notis] processed ${notis} notice(s)`);
      const merged = await sendQueuedMerge();
      if (merged) console.log(`[merge] processed ${merged} email(s)`);
    } else {
      console.log('[worker] retention', await runRetention());
    }
  },
  { connection: createRedis() },
);

// Jobs that were queued/running when a previous worker died without BullMQ knowing
// (e.g. Redis flushed) would stay "running" forever: mark them failed.
await query(
  `UPDATE messages SET status = 'error', error = 'Interrupted by a restart. Please ask again.'
    WHERE status IN ('queued', 'running') AND created_at < now() - interval '30 minutes'`,
);

// Runner tasks approved while the worker was down (or whose job was lost) are queued again;
// the job id is per task, so this never runs one twice.
for (const r of (await query(`SELECT id FROM action_tasks WHERE status = 'running'`)).rows) await enqueueRunner(r.id);

// Documents cut off by a restart carry on from the first section that is not written yet.
for (const r of (await query(`SELECT id FROM official_documents WHERE status IN ('queued', 'writing')`)).rows) await enqueueDocumentWrite(r.id);

async function shutdown() {
  console.log('[worker] shutting down');
  await worker.close();
  await crewWorker.close();
  await docWorker.close();
  await maintenanceWorker.close();
  await maintenance.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
