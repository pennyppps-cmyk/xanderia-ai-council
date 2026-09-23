import type { Queryable } from '../db/pool.js';
import { accessPredicate, accessibleDepartmentIds, type AccessUser } from './access.js';

export interface RetrievedChunk {
  documentId: string;
  title: string;
  section: string | null;
  content: string;
  distance: number;
}

export function toVectorLiteral(v: number[]) {
  return `[${v.join(',')}]`;
}

/** Low-level search. Access filtering happens inside the SQL, never after the fact. */
export async function searchChunks(
  db: Queryable,
  opts: { allowedDepartmentIds: string[]; vector: number[]; k: number },
): Promise<RetrievedChunk[]> {
  const { rows } = await db.query(
    `SELECT d.id AS "documentId", d.title, c.section, c.content,
            (c.embedding <=> $1::vector) AS distance
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE ${accessPredicate(2)}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(opts.vector), opts.allowedDepartmentIds, opts.k],
  );
  return rows;
}

export async function hasAccessibleDocuments(db: Queryable, allowed: string[]) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM documents d WHERE ${accessPredicate(1)} AND d.chunk_count > 0) AS any`,
    [allowed],
  );
  return rows[0].any as boolean;
}

export interface RetrieveDeps {
  db: Queryable;
  embed(texts: string[]): Promise<number[][]>;
}

/** Retrieve for a user: resolves their allowed departments, embeds the query, searches. */
export async function retrieveForUser(deps: RetrieveDeps, user: AccessUser, text: string, k = 5) {
  const allowed = await accessibleDepartmentIds(deps.db, user);
  if (!(await hasAccessibleDocuments(deps.db, allowed))) return [];
  const [vector] = await deps.embed([text]);
  // Drop weak matches so irrelevant snippets do not get cited.
  return (await searchChunks(deps.db, { allowedDepartmentIds: allowed, vector, k })).filter(
    (c) => c.distance < 0.6,
  );
}
