/**
 * What the asker has already told the council in this conversation: answers to clarifying questions
 * and to open questions under a verdict. Passed to every model step as settled facts, so the council
 * builds on them instead of asking again.
 */

/** "Answer to the council's open question "<q>": <a>" — the text the UI pre-fills (English or BM). */
const OPEN_ANSWER = /^\s*(?:Answer to the council's open question|Jawapan kepada soalan terbuka majlis)\s*"([\s\S]+?)"\s*:\s*([\s\S]*)$/i;

export function parseOpenAnswer(text: string): { question: string; answer: string } | null {
  const m = OPEN_ANSWER.exec(text);
  if (!m || !m[2].trim()) return null;
  return { question: m[1].trim(), answer: m[2].trim() };
}

export interface FactSource {
  role: 'user' | 'assistant';
  content: string;
  options?: { clarifiedFrom?: string; effectiveQuestion?: string; openAnswer?: { question: string; answer: string } } | null;
}

/** Confirmed facts, oldest first, as "question → answer" lines (at most `max`, the most recent kept). */
export function confirmedFacts(messages: FactSource[], max = 12): string[] {
  const facts: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const open = parseOpenAnswer(m.content);
      if (open) facts.push(`${open.question} → ${open.answer}`);
    } else if (m.options?.clarifiedFrom && m.options.effectiveQuestion) {
      // "…The council asked:\n1. q1\n2. q2\n\nThe asker answered:\nreply"
      const parts = /The council asked:\n([\s\S]*?)\n\nThe asker answered:\n([\s\S]*)$/.exec(m.options.effectiveQuestion);
      if (parts) facts.push(`Clarifying questions:\n${parts[1].trim()}\nAnswers: ${parts[2].trim().slice(0, 1200)}`);
    }
  }
  return facts.slice(-max);
}

export function factsBlock(facts: string[]) {
  if (!facts.length) return '';
  return `Facts the asker has already confirmed in this conversation (treat them as settled; build on them; do not ask about them again or list them as open questions):\n${facts
    .map((f) => `- ${f.replace(/\n/g, '\n  ')}`)
    .join('\n')}`;
}

/** The question a reply to an open question stands for: the plan being discussed, updated with the answer. */
export function questionForOpenAnswer(baseQuestion: string, open: { question: string; answer: string }) {
  // Earlier updates are carried by the facts block; keep only the original request.
  const base = baseQuestion.split('\n\nThe asker has now answered')[0];
  return `${base}\n\nThe asker has now answered the council's open question "${open.question}": ${open.answer}\nReconsider the previous verdict with this answer and update it where the answer changes it.`;
}
