import { redact } from '../privacy/pii.js';

/**
 * Task emails: fixed templates for the subject, details block and links; the model only
 * writes the short body. Every body is PII-scrubbed before it can be queued.
 */
export interface TaskEmailInput {
  kind: 'task' | 'reminder' | 'escalation';
  ownerName: string;
  title: string;
  body: string;
  dueDate: string | null;
  requesterName: string;
  planTitle: string;
  links: { accept: string; help: string; done: string; cant: string; open: string };
  /** For escalations: who the task is assigned to. */
  assigneeName?: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Remove IC/account numbers (and other detectable PII) from model-written text. */
export function scrubEmailText(text: string): string {
  return redact(text).text;
}

export function allowedRecipient(email: string, domains: string[]) {
  const domain = email.trim().toLowerCase().split('@')[1];
  return Boolean(domain) && domains.some((d) => domain === d.toLowerCase().replace(/^@/, ''));
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function buildTaskEmail(e: TaskEmailInput): BuiltEmail {
  const body = scrubEmailText(e.body).trim();
  const title = scrubEmailText(e.title);
  const subject =
    e.kind === 'task'
      ? `[Xanderia AI Council] Task for you: ${title}`
      : e.kind === 'reminder'
        ? `Reminder: ${title}`
        : `Escalation: "${title}" is overdue`;
  const due = e.dueDate ? new Date(`${e.dueDate}T00:00:00Z`).toLocaleDateString('en-MY', { dateStyle: 'medium', timeZone: 'UTC' }) : 'not set';

  const details = [
    `Task: ${title}`,
    e.assigneeName ? `Assigned to: ${e.assigneeName}` : null,
    `Due: ${due}`,
    `Requested by: ${e.requesterName}`,
    `Plan: ${scrubEmailText(e.planTitle)}`,
  ].filter(Boolean) as string[];

  const linkLines =
    e.kind === 'escalation'
      ? [`Open the task: ${e.links.open}`]
      : [
          `Accept: ${e.links.accept}`,
          `Need help: ${e.links.help}`,
          `Mark done: ${e.links.done}`,
          `Can't do it: ${e.links.cant}`,
        ];

  const text = [`Hi ${e.ownerName},`, '', body, '', ...details, '', ...linkLines, '', '— Xanderia AI Council (on behalf of ' + e.requesterName + ')'].join('\n');

  const button = (href: string, label: string, primary = false) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 6px 6px 0;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;${
      primary ? 'background:#0f2a3d;color:#ffffff;' : 'background:#f3f6f8;color:#0f2a3d;border:1px solid #c7d4de;'
    }">${esc(label)}</a>`;
  const buttons =
    e.kind === 'escalation'
      ? button(e.links.open, 'Open the task', true)
      : button(e.links.accept, 'Accept', true) + button(e.links.help, 'Need help') + button(e.links.done, 'Mark done') + button(e.links.cant, "Can't do it");

  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17354a">
<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3eaef">
<div style="background:#0f2a3d;color:#cdf6ee;padding:14px 20px;font-size:13px;font-weight:600">Xanderia AI Council</div>
<div style="padding:20px">
<p style="margin:0 0 12px">Hi ${esc(e.ownerName)},</p>
${body
  .split(/\n{2,}/)
  .map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`)
  .join('\n')}
<table style="margin:8px 0 16px;font-size:13px;color:#3b556a">${details
    .map((d) => {
      const [k, ...v] = d.split(': ');
      return `<tr><td style="padding:2px 12px 2px 0;color:#7890a3">${esc(k)}</td><td>${esc(v.join(': '))}</td></tr>`;
    })
    .join('')}</table>
<div>${buttons}</div>
<p style="margin:16px 0 0;font-size:11px;color:#7890a3">Sent by Xanderia AI Council on behalf of ${esc(e.requesterName)}. Advisory tasks; reply to the requester directly if anything is unclear.</p>
</div></div></body></html>`;
  return { subject, text, html };
}
