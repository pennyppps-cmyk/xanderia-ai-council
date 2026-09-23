import { tx } from '../db/pool.js';
import { chunkText } from './chunk.js';
import { toVectorLiteral } from './retrieve.js';

export interface IngestInput {
  title: string;
  text: string;
  departmentId: string | null;
  companyWide: boolean;
  sourceFilename?: string;
  uploadedBy: string;
}

export async function ingestDocument(
  input: IngestInput,
  embed: (texts: string[]) => Promise<number[][]>,
) {
  const chunks = chunkText(input.text);
  if (chunks.length === 0) throw new Error('Document has no text');
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += 16) {
    const batch = chunks.slice(i, i + 16);
    // Title is prefixed so short chunks still carry their document's topic.
    vectors.push(...(await embed(batch.map((c) => `${input.title}\n${c.section ?? ''}\n${c.content}`))));
  }
  return tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO documents (department_id, company_wide, title, source_filename, uploaded_by, chunk_count)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.departmentId, input.companyWide, input.title, input.sourceFilename ?? null, input.uploadedBy, chunks.length],
    );
    const documentId = rows[0].id as string;
    for (const [i, chunk] of chunks.entries()) {
      await c.query(
        `INSERT INTO document_chunks (document_id, chunk_index, section, content, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [documentId, chunk.index, chunk.section, chunk.content, toVectorLiteral(vectors[i])],
      );
    }
    return { documentId, chunks: chunks.length };
  });
}
