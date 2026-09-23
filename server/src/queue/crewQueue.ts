import { Queue } from 'bullmq';
import { createRedis } from '../redis.js';

export const CREW_QUEUE = 'crew-jobs';

export type CrewJob = { type: 'dispatch'; planId: string } | { type: 'runner'; taskId: string };

let queue: Queue<CrewJob> | null = null;

export function getCrewQueue() {
  queue ??= new Queue<CrewJob>(CREW_QUEUE, {
    connection: createRedis(),
    defaultJobOptions: { attempts: 1, removeOnComplete: 500, removeOnFail: 500 },
  });
  return queue;
}

export async function enqueueDispatch(planId: string) {
  await getCrewQueue().add('dispatch', { type: 'dispatch', planId }, { jobId: `dispatch-${planId}-${Date.now()}` });
}

export async function enqueueRunner(taskId: string) {
  await getCrewQueue().add('runner', { type: 'runner', taskId }, { jobId: `runner-${taskId}` });
}
