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
  /** The task itself in plain words (what "done" looks like), shown under "What you need to do". */
  whatToDo?: string;
  /** For reminders: why it is being sent (not acknowledged yet, due soon...). */
  reminderNote?: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Tidy a model-written email body: drop echoed prompt tags, the model's own greeting and
 * sign-off (the template adds both), and surrounding whitespace.
 */
export function cleanEmailBody(text: string): string {
  let t = text.replace(/<\/?[a-z_]+(?:\s[^>]*)?>/gi, '').replace(/<<<[^>]*>>>/g, '').trim();
  t = t.replace(/^(subject:[^\n]*\n+)/i, '');
  t = t.replace(/^(dear|hi|hello|good (?:morning|afternoon)|salam|assalamualaikum|kepada)\b[^\n]{0,60}\n+/i, '');
  t = t.replace(/\n+\s*(best regards|kind regards|regards|thank you|thanks|sincerely|yours|terima kasih|sekian)\b[\s\S]{0,120}$/i, '');
  return t.trim();
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


const fmtDue = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);

/**
 * A task email written as a proper letter: addressed to the person by name, who assigned it and why,
 * the task and its due date in a box, what they need to do in plain words, the requester's note (or
 * the AI draft to finish), and how to respond. Every model- or user-written part is PII-scrubbed.
 */
export function buildTaskEmail(e: TaskEmailInput): BuiltEmail {
  const title = scrubEmailText(e.title);
  const plan = scrubEmailText(e.planTitle);
  const todo = e.whatToDo ? scrubEmailText(e.whatToDo).trim() : '';
  let note = scrubEmailText(cleanEmailBody(e.body)).trim();
  // A body that only repeats the task description adds nothing.
  if (note && todo && note.replace(/\s+/g, ' ') === todo.replace(/\s+/g, ' ')) note = '';
  const due = fmtDue(e.dueDate);
  const subject =
    e.kind === 'task'
      ? `Task assigned to you: ${title}${due ? ` (due ${due})` : ''}`
      : e.kind === 'reminder'
        ? `Reminder: ${title}${due ? ` (due ${due})` : ''}`
        : `Escalation: "${title}" is overdue`;

  const greeting = e.kind === 'escalation' ? 'Dear Sir/Madam,' : `Dear ${scrubEmailText(e.ownerName)},`;
  const opening =
    e.kind === 'task'
      ? `${e.requesterName} has assigned you the following task, as part of "${plan}".`
      : e.kind === 'reminder'
        ? `This is a reminder about the task below, assigned to you by ${e.requesterName}.${e.reminderNote ? ` ${e.reminderNote}` : ''}`
        : `The task below, assigned to ${e.assigneeName ?? 'a member of your team'}, is overdue and has not been completed. ${e.requesterName} has asked for it to be raised with you as their manager.`;
  const respond =
    e.kind === 'escalation'
      ? 'Please follow up with them, or open the task to see its history.'
      : e.kind === 'task'
        ? 'Please let us know with one of the buttons below: Accept if you can take it on, Need help if anything is unclear, or Can\'t do it if it cannot be done by the due date. When the task is finished, click Mark done.'
        : 'If the task is finished, please click Mark done. If something is holding it up, click Need help so the requester can assist.';

  const box = [`Task: ${title}`, ...(e.assigneeName && e.kind === 'escalation' ? [`Assigned to: ${e.assigneeName}`] : []), `Due: ${due ?? 'not set'}`, `Requested by: ${e.requesterName}`, `Plan: ${plan}`];
  const linkLines =
    e.kind === 'escalation'
      ? [`Open the task: ${e.links.open}`]
      : [`Accept: ${e.links.accept}`, `Need help: ${e.links.help}`, `Mark done: ${e.links.done}`, `Can't do it: ${e.links.cant}`];

  const text = [
    greeting,
    '',
    opening,
    '',
    ...box,
    '',
    ...(todo ? ['WHAT YOU NEED TO DO', todo, ''] : []),
    ...(note ? [note, ''] : []),
    respond,
    '',
    ...linkLines,
    '',
    'Regards,',
    e.requesterName,
    '(sent through the Xanderia AI Council)',
  ].join('\n');

  const button = (href: string, label: string, primary = false) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 6px 6px 0;padding:9px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;${
      primary ? 'background:#0f2a3d;color:#ffffff;' : 'background:#f3f6f8;color:#0f2a3d;border:1px solid #c7d4de;'
    }">${esc(label)}</a>`;
  const buttons =
    e.kind === 'escalation'
      ? button(e.links.open, 'Open the task', true)
      : e.kind === 'task'
        ? button(e.links.accept, 'Accept', true) + button(e.links.help, 'Need help') + button(e.links.done, 'Mark done') + button(e.links.cant, "Can't do it")
        : button(e.links.done, 'Mark done', true) + button(e.links.help, 'Need help') + button(e.links.cant, "Can't do it");
  const paras = (s: string) =>
    s
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 12px;line-height:1.55">${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17354a;font-size:14px">
<div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3eaef">
<div style="background:#0f2a3d;color:#cdf6ee;padding:14px 22px;font-size:13px;font-weight:600">Xanderia Berhad · ${e.kind === 'task' ? 'Task assignment' : e.kind === 'reminder' ? 'Task reminder' : 'Escalation'}</div>
<div style="padding:22px">
<p style="margin:0 0 14px">${esc(greeting)}</p>
${paras(opening)}
<div style="margin:6px 0 18px;padding:14px 16px;border-left:4px solid #0d9488;background:#effcf9;border-radius:6px">
<div style="font-size:16px;font-weight:700;color:#0f2a3d;margin-bottom:6px">${esc(title)}</div>
<table style="font-size:13px;color:#3b556a;border-collapse:collapse">
<tr><td style="padding:2px 14px 2px 0;color:#7890a3">Due</td><td style="font-weight:600;color:#0f2a3d">${esc(due ?? 'not set')}</td></tr>
${e.kind === 'escalation' && e.assigneeName ? `<tr><td style="padding:2px 14px 2px 0;color:#7890a3">Assigned to</td><td>${esc(e.assigneeName)}</td></tr>` : ''}
<tr><td style="padding:2px 14px 2px 0;color:#7890a3">Requested by</td><td>${esc(e.requesterName)}</td></tr>
<tr><td style="padding:2px 14px 2px 0;color:#7890a3">Plan</td><td>${esc(plan)}</td></tr>
</table></div>
${todo ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;color:#0b5e55">WHAT YOU NEED TO DO</p>${paras(todo)}` : ''}
${note ? paras(note) : ''}
${paras(respond)}
<div style="margin:4px 0 18px">${buttons}</div>
<p style="margin:0;line-height:1.5">Regards,<br>${esc(e.requesterName)}</p>
<p style="margin:16px 0 0;font-size:11px;color:#7890a3">Sent through the Xanderia AI Council on behalf of ${esc(e.requesterName)}. If anything is unclear, reply to them directly.</p>
</div></div></body></html>`;
  return { subject, text, html };
}
