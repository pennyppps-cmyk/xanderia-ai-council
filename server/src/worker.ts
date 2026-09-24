import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import { processMessage } from './council/pipeline.js';
import { dispatchPlan, runAgentTask, sendQueuedEmails, trackerTick } from './crew/service.js';
import { migrate } from './db/migrate.js';
import { pool, query } from './db/pool.js';
import { seed } from './db/seed.js';
import { CREW_QUEUE, enqueueRunner, type CrewJob } from './queue/crewQueue.js';
import { createPublisher } from './queue/events.js';
import { QUEUE_NAME, type MessageJob } from './queue/queue.js';
import { createRedis, redis } from './redis.js';
import { runRetention } from './retention.js';
import { decisionCheckIns } from './jobs.js';

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

// Maintenance: nightly retention, the Tracker every 15 minutes, the email sender every minute.
const maintenance = new Queue('maintenance', { connection: createRedis() });
await maintenance.upsertJobScheduler('retention', { pattern: '0 3 * * *' }, { name: 'retention' });
await maintenance.upsertJobScheduler('tracker', { pattern: '*/15 * * * *' }, { name: 'tracker' });
await maintenance.upsertJobScheduler('mailer', { pattern: '* * * * *' }, { name: 'mailer' });
// Decision outcome check-ins, daily at 09:05 KL time (01:05 UTC).
await maintenance.upsertJobScheduler('checkins', { pattern: '5 1 * * *' }, { name: 'checkins' });
const maintenanceWorker = new Worker(
  'maintenance',
  async (job) => {
    if (job.name === 'tracker') {
      const n = await trackerTick();
      if (n) console.log(`[tracker] ${n} action(s)`);
    } else if (job.name === 'checkins') {
      const n = await decisionCheckIns();
      if (n) console.log(`[checkins] ${n} decision check-in(s) sent`);
    } else if (job.name === 'mailer') {
      const n = await sendQueuedEmails();
      if (n) console.log(`[mailer] processed ${n} email(s)`);
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

async function shutdown() {
  console.log('[worker] shutting down');
  await worker.close();
  await crewWorker.close();
  await maintenanceWorker.close();
  await maintenance.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
