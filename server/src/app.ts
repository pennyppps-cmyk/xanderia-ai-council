import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import authPlugin from './auth/plugin.js';
import { config } from './config.js';
import { redis } from './redis.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import crewRoutes from './routes/crew.js';
import healthRoutes from './routes/health.js';
import knowledgeRoutes from './routes/knowledge.js';
import shareRoutes from './routes/share.js';
import decisionRoutes from './routes/decisions.js';
import toolRoutes from './routes/tools.js';
import channelRoutes from './routes/channels.js';
import attachmentRoutes from './routes/attachments.js';
import memoryRoutes from './routes/memory.js';
import onboardingRoutes from './routes/onboarding.js';
import notisRoutes from './routes/notis.js';
import mergeRoutes from './routes/merge.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    // Signed task-link tokens in /api/t/:token are longer than Fastify's 100-character default.
    routerOptions: { maxParamLength: 400 },
  });

  // Per-route limits only (messages, login); counters live in Redis so they hold across restarts.
  await app.register(rateLimit, { global: false, redis });
  await app.register(multipart);
  await app.register(formbody); // public task-link pages post plain HTML forms
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
  await app.register(crewRoutes);
  await app.register(shareRoutes);
  await app.register(decisionRoutes);
  await app.register(toolRoutes);
  await app.register(channelRoutes);
  await app.register(attachmentRoutes);
  await app.register(memoryRoutes);
  await app.register(onboardingRoutes);
  await app.register(notisRoutes);
  await app.register(mergeRoutes);
  return app;
}
