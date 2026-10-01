import { Queue } from 'bullmq';
import { createRedis } from '../redis.js';

export const DOC_QUEUE = 'document-jobs';

export type DocJob =
  | { type: 'write'; documentId: string }
  | { type: 'rewrite'; documentId: string; key: string; instruction: string }
  | { type: 'minutes'; meetingId: string };

let queue: Queue<DocJob> | null = null;

export function getDocQueue() {
  queue ??= new Queue<DocJob>(DOC_QUEUE, {
    connection: createRedis(),
    defaultJobOptions: { attempts: 1, removeOnComplete: 500, removeOnFail: 500 },
  });
  return queue;
}

export async function enqueueDocumentWrite(documentId: string) {
  await getDocQueue().add('write', { type: 'write', documentId }, { jobId: `write-${documentId}-${Date.now()}` });
}

export async function enqueueSectionRewrite(documentId: string, key: string, instruction: string) {
  await getDocQueue().add('rewrite', { type: 'rewrite', documentId, key, instruction }, { jobId: `rewrite-${documentId}-${key}-${Date.now()}` });
}
