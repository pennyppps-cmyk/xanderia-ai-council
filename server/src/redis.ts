import { Redis } from 'ioredis';
import { config } from './config.js';

export function createRedis() {
  // BullMQ requires maxRetriesPerRequest: null on the connections it uses.
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

export const redis = createRedis();
