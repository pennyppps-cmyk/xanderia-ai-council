/**
 * Acceptance: a user from HR cannot retrieve Finance-only data.
 * Runs against a real Postgres + pgvector (TEST_DATABASE_URL); skipped when not set.
 *   docker compose up -d postgres
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5432/council_test npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { accessibleDepartmentIds } from '../../src/rag/access.js';
import { retrieveForUser, searchChunks, toVectorLiteral } from '../../src/rag/retrieve.js';

const url = process.env.TEST_DATABASE_URL;

// Deterministic 768-d "embeddings": every document about salaries points the same way,
// so an unfiltered search would certainly return the Finance document.
const vec = (seed: number) => Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i));
const SALARY = vec(1);

describe.skipIf(!url)('RAG access control (integration)', () => {
  let db: pg.Pool;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url!.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    const dbName = new URL(url!).pathname.slice(1);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    await migrate(url!, () => {});
    db = new pg.Pool({ connectionString: url });

    for (const slug of ['hr', 'finance', 'operations']) {
      ids[slug] = (await db.query(`INSERT INTO departments (slug, name) VALUES ($1, $1) RETURNING id`, [slug])).rows[0].id;
    }
    const mkUser = async (email: string, dept: string) =>
      (await db.query(`INSERT INTO users (email, display_name, department_id) VALUES ($1, $1, $2) RETURNING id`, [email, ids[dept]]))
        .rows[0].id as string;
    ids.hrUser = await mkUser('hr@x', 'hr');
    ids.finUser = await mkUser('fin@x', 'finance');
    ids.opsUser = await mkUser('ops@x', 'operations');

    const mkDoc = async (title: string, dept: string | null, companyWide: boolean, v: number[]) => {
      const d = (
        await db.query(
          `INSERT INTO documents (department_id, company_wide, title, chunk_count) VALUES ($1, $2, $3, 1) RETURNING id`,
          [dept ? ids[dept] : null, companyWide, title],
        )
      ).rows[0].id;
      await db.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content, embedding) VALUES ($1, 0, $2, $3::vector)`,
        [d, `${title} content`, toVectorLiteral(v)],
      );
      return d as string;
    };
    ids.finDoc = await mkDoc('Finance salary budget 2027 (CONFIDENTIAL)', 'finance', false, SALARY);
    ids.hrDoc = await mkDoc('HR leave policy', 'hr', false, vec(2));
    ids.companyDoc = await mkDoc('Company code of conduct', null, true, vec(3));
  });

  afterAll(async () => {
    await db?.end();
  });

  it('HR user cannot retrieve a Finance-only document, even with a perfectly matching query', async () => {
    const results = await retrieveForUser(
      { db, embed: async () => [SALARY] },
      { id: ids.hrUser, department_id: ids.hr },
      'What is the salary budget?',
      10,
    );
    const docs = results.map((r) => r.documentId);
    expect(docs).not.toContain(ids.finDoc);

    // Low-level search with HR's scope and no distance cut-off: still no Finance document.
    const raw = await searchChunks(db, {
      allowedDepartmentIds: await accessibleDepartmentIds(db, { id: ids.hrUser, department_id: ids.hr }),
      vector: SALARY,
      k: 50,
    });
    expect(raw.map((r) => r.documentId).sort()).toEqual([ids.hrDoc, ids.companyDoc].sort());
  });

  it('Finance user does retrieve it (the query itself is not the reason HR got nothing)', async () => {
    const results = await retrieveForUser(
      { db, embed: async () => [SALARY] },
      { id: ids.finUser, department_id: ids.finance },
      'What is the salary budget?',
      10,
    );
    expect(results[0].documentId).toBe(ids.finDoc);
  });

  it('an admin-granted cross-department access widens the scope', async () => {
    await db.query(`INSERT INTO user_department_access (user_id, department_id) VALUES ($1, $2)`, [ids.opsUser, ids.finance]);
    const results = await retrieveForUser(
      { db, embed: async () => [SALARY] },
      { id: ids.opsUser, department_id: ids.operations },
      'salary budget',
      10,
    );
    expect(results.map((r) => r.documentId)).toContain(ids.finDoc);
  });

  it('audit_log is append-only', async () => {
    await db.query(`INSERT INTO audit_log (action) VALUES ('test')`);
    await expect(db.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    await expect(db.query(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
  });
});
