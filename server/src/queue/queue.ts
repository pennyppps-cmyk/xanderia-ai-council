import { Queue } from 'bullmq';
import { createRedis } from '../redis.js';

export const QUEUE_NAME = 'council-jobs';

export interface MessageJob {
  messageId: string;
}

let queue: Queue<MessageJob> | null = null;

export function getQueue() {
  queue ??= new Queue<MessageJob>(QUEUE_NAME, {
    connection: createRedis(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
  return queue;
}

/** BullMQ priority: lower runs first. Quick (and Auto, whose router is quick) beat Council. */
export async function enqueueMessage(messageId: string, requestedMode: 'auto' | 'quick' | 'council') {
  await getQueue().add(
    'message',
    { messageId },
    { jobId: messageId, priority: requestedMode === 'council' ? 10 : 1 },
  );
}

export async function queuePosition(messageId: string): Promise<number | null> {
  const q = getQueue();
  const job = await q.getJob(messageId);
  if (!job || !(await job.isWaiting())) return null;
  const waiting = await q.getJobs(['prioritized', 'waiting'], 0, 200, true);
  const idx = waiting.findIndex((j) => j.id === messageId);
  return idx >= 0 ? idx + 1 : null;
}
