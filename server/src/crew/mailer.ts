import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Mail provider interface (HANDOFF §14.4). Gmail API / Microsoft Graph can be added as further providers. */
export interface MailProvider {
  readonly id: string;
  /** 'logged' = recorded only (outbox provider), 'sent' = handed to a real mail system. */
  send(msg: MailMessage): Promise<'sent' | 'logged'>;
}

/** Default: keeps the email in the app's outbox (visible in Admin → Outbox) and never sends it. */
export const outboxProvider: MailProvider = {
  id: 'outbox',
  async send() {
    return 'logged';
  },
};

export function smtpProvider(): MailProvider {
  if (!config.SMTP_HOST) throw new Error('MAIL_PROVIDER=smtp needs SMTP_HOST');
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return {
    id: 'smtp',
    async send(msg) {
      await transport.sendMail({ from: config.MAIL_FROM, ...msg });
      return 'sent';
    },
  };
}

/** Hands the email to an n8n workflow (which can then send via Gmail, M365, etc.). */
export function n8nProvider(fetchImpl: typeof fetch = fetch): MailProvider {
  if (!config.N8N_MAIL_WEBHOOK_URL) throw new Error('MAIL_PROVIDER=n8n needs N8N_MAIL_WEBHOOK_URL');
  return {
    id: 'n8n',
    async send(msg) {
      const res = await fetchImpl(config.N8N_MAIL_WEBHOOK_URL!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.N8N_MAIL_SECRET ? { 'x-council-secret': config.N8N_MAIL_SECRET } : {}),
        },
        body: JSON.stringify({ from: config.MAIL_FROM, ...msg }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`n8n webhook returned ${res.status}`);
      return 'sent';
    },
  };
}

let provider: MailProvider | null = null;

export function getMailProvider(): MailProvider {
  provider ??=
    config.MAIL_PROVIDER === 'smtp' ? smtpProvider() : config.MAIL_PROVIDER === 'n8n' ? n8nProvider() : outboxProvider;
  return provider;
}
