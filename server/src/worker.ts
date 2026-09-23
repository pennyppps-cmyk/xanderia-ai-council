import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import { processMessage } from './council/pipeline.js';
import { migrate } from './db/migrate.js';
import { pool, query } from './db/pool.js';
import { seed } from './db/seed.js';
import { createPublisher } from './queue/events.js';
import { QUEUE_NAME, type MessageJob } from './queue/queue.js';
import { createRedis, redis } from './redis.js';
import { runRetention } from './retention.js';

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

// Daily retention sweep.
const maintenance = new Queue('maintenance', { connection: createRedis() });
await maintenance.upsertJobScheduler('retention', { pattern: '0 3 * * *' }, { name: 'retention' });
const maintenanceWorker = new Worker(
  'maintenance',
  async () => {
    const r = await runRetention();
    console.log('[worker] retention', r);
  },
  { connection: createRedis() },
);

// Jobs that were queued/running when a previous worker died without BullMQ knowing
// (e.g. Redis flushed) would stay "running" forever: mark them failed.
await query(
  `UPDATE messages SET status = 'error', error = 'Interrupted by a restart. Please ask again.'
    WHERE status IN ('queued', 'running') AND created_at < now() - interval '30 minutes'`,
);

async function shutdown() {
  console.log('[worker] shutting down');
  await worker.close();
  await maintenanceWorker.close();
  await maintenance.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
