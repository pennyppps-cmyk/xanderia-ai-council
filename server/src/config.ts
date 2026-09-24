import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://council:council@localhost:5432/council'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  COOKIE_SECURE: bool,
  // Ollama — local by default; point at aixan / the RDP box via env.
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  // Optional shared secret for an Ollama reached through hermes-proxy (sent as X-Hermes-Key).
  OLLAMA_API_KEY: z.string().optional(),
  OLLAMA_API_KEY_HEADER: z.string().default('X-Hermes-Key'),
  DEFAULT_CHAT_MODEL: z.string().default('hermes3:8b'),
  DEFAULT_EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_NUM_PARALLEL: z.coerce.number().int().min(1).default(2),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(6),
  // First admin, created by the seed on an empty database.
  ADMIN_EMAIL: z.string().default('admin@xanderia.local'),
  ADMIN_PASSWORD: z.string().default('ChangeMe!2026'),
  ADMIN_DEPARTMENT: z.string().default('technology'),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(20),
  // Action Crew email (HANDOFF §14.4). 'outbox' records emails in the app without sending them.
  APP_BASE_URL: z.string().default('https://localhost'),
  MAIL_PROVIDER: z.enum(['outbox', 'smtp', 'n8n']).default('outbox'),
  MAIL_FROM: z.string().default('Xanderia AI Council <council@xanderia.com.my>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool,
  N8N_MAIL_WEBHOOK_URL: z.string().optional(),
  N8N_MAIL_SECRET: z.string().optional(),
  // Telegram bot (optional). Long polling from the worker: no inbound port or public URL needed.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // On-premises speech-to-text (OpenAI-compatible /v1/audio/transcriptions, e.g. the `voice` compose profile).
  WHISPER_URL: z.string().optional(),
  WHISPER_MODEL: z.string().default('Systran/faster-whisper-small'),
  LOG_LEVEL: z.string().default('info'),
});

export const config = Env.parse(process.env);
export type Config = typeof config;
