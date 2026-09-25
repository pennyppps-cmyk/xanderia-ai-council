/**
 * Documents attached to a question. Each model step gets as much of them as its context allows:
 * advisors and Quick answers most, the Chairman a shorter version, the router and clarifier an excerpt.
 */
export interface Attachment {
  name: string;
  text: string;
}

export const MAX_ATTACHMENTS = 3;
/** About 6,000 tokens: leaves room in a 16,384-token context for prompts, knowledge and the answer. */
export const ATTACHMENT_BUDGET = { answer: 24_000, chairman: 8_000, clarify: 4_000, router: 1_500 } as const;

/** Share `maxChars` between the documents (short ones keep everything), marking what was cut. */
export function fitAttachments(list: Attachment[], maxChars: number): Array<Attachment & { truncated: boolean; totalChars: number }> {
  const out = list.map((a) => ({ ...a, totalChars: a.text.length, truncated: false }));
  let remaining = maxChars;
  // Smallest first, so a short document is never cut to make room for a long one.
  const order = [...out.keys()].sort((a, b) => out[a].totalChars - out[b].totalChars);
  for (const [n, i] of order.entries()) {
    const share = Math.floor(remaining / (order.length - n));
    const a = out[i];
    if (a.text.length > share) {
      a.text = a.text.slice(0, Math.max(0, share)).replace(/\s+\S*$/, '');
      a.truncated = true;
    }
    remaining -= a.text.length;
  }
  return out;
}

/** One-line note for the asker when documents were too long to read in full. */
export function truncationNote(list: Attachment[], maxChars = ATTACHMENT_BUDGET.answer) {
  const cut = fitAttachments(list, maxChars).filter((a) => a.truncated);
  if (!cut.length) return '';
  return cut.map((a) => `"${a.name}" was too long to read in full: the council read the first ${Math.round((a.text.length / a.totalChars) * 100)}%.`).join(' ');
}
