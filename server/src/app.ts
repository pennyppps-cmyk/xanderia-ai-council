import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import authPlugin from './auth/plugin.js';
import { config } from './config.js';
import { redis } from './redis.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import healthRoutes from './routes/health.js';
import knowledgeRoutes from './routes/knowledge.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // Per-route limits only (messages, login); counters live in Redis so they hold across restarts.
  await app.register(rateLimit, { global: false, redis });
  await app.register(multipart);
  await app.register(authPlugin);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(chatRoutes);
  await app.register(adminRoutes);
  await app.register(knowledgeRoutes);
  return app;
}
