export interface Chunk {
  index: number;
  section: string | null;
  content: string;
}

// Markdown heading, numbered heading ("3.2 Refund policy") or an ALL-CAPS line.
const HEADING = /^(?:#{1,6}\s+(.+)|(\d+(?:\.\d+)*\.?\s+[A-Z].{2,80})|([A-Z][A-Z0-9 &/,()-]{3,80}))$/;

/**
 * Split text into chunks of at most ~maxChars on paragraph boundaries. A heading
 * always starts a new chunk, and each chunk records its nearest heading as
 * `section` so answers can cite "Document › Section".
 */
export function chunkText(text: string, maxChars = 1200): Chunk[] {
  const chunks: Chunk[] = [];
  let section: string | null = null;
  let current = '';

  const push = (content: string) => {
    const trimmed = content.trim();
    if (trimmed) chunks.push({ index: chunks.length, section, content: trimmed });
  };

  for (const raw of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const para = raw.trim();
    if (!para) continue;
    const m = HEADING.exec(para.split('\n')[0].trim());
    if (m) {
      push(current);
      current = '';
      section = (m[1] ?? m[2] ?? m[3]).trim();
    }
    if (current && current.length + para.length + 2 > maxChars) {
      push(current);
      current = '';
    }
    if (para.length > maxChars) {
      for (let i = 0; i < para.length; i += maxChars) push(para.slice(i, i + maxChars));
      continue;
    }
    current += (current ? '\n\n' : '') + para;
  }
  push(current);
  return chunks;
}
