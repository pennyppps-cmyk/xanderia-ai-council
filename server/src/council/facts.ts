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

/** The questions the asker has already answered (clarifying and open questions), for filtering. */
export function answeredQuestions(messages: FactSource[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const open = parseOpenAnswer(m.content);
      if (open) out.push(open.question);
    } else if (m.options?.clarifiedFrom && m.options.effectiveQuestion) {
      const asked = /The council asked:\n([\s\S]*?)\n\nThe asker answered:/.exec(m.options.effectiveQuestion);
      if (asked) out.push(...asked[1].split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean));
    }
  }
  return out;
}

const STOP = new Set('the a an of to for in on and or is are be what which how should we our your this that with by as at from can do does will would it its there any specific'.split(' '));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** True when two questions ask essentially the same thing (word overlap). */
export function sameQuestion(a: string, b: string) {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size) >= 0.7 || inter / (wa.size + wb.size - inter) >= 0.5;
}

/** Drop open questions the asker has already answered (the model sometimes repeats them). */
export function dropAnswered(openQuestions: string[], answered: string[]) {
  return openQuestions.filter((q) => !answered.some((a) => sameQuestion(q, a)));
}
