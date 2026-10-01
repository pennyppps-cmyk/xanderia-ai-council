/**
 *   TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_docs_test TEST_REDIS_URL=redis://localhost:6380 npm test
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!url || !redisUrl)('official documents (integration)', () => {
  let service: typeof import('../../src/documents/service.js');
  let db: pg.Pool;
  let user: string;
  let dept: string;
  let message: string;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url!.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    const name = new URL(url!).pathname.slice(1);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    process.env.DATABASE_URL = url;
    process.env.REDIS_URL = redisUrl;
    await (await import('../../src/db/migrate.js')).migrate(url!, () => {});
    await (await import('../../src/db/seed.js')).seed(() => {});
    service = await import('../../src/documents/service.js');
    db = new pg.Pool({ connectionString: url });
    ({ id: user, department_id: dept } = (await db.query(`SELECT id, department_id FROM users LIMIT 1`)).rows[0]);
    const conv = (await db.query(`INSERT INTO conversations (user_id, department_id) VALUES ($1, $2) RETURNING id`, [user, dept])).rows[0].id;
    const q = (await db.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', 'q') RETURNING id`, [conv])).rows[0].id;
    message = (await db.query(`INSERT INTO messages (conversation_id, role, reply_to, mode, status, verdict) VALUES ($1, 'assistant', $2, 'council', 'done', '{"verdict":"x"}') RETURNING id`, [conv, q])).rows[0].id;
  });

  afterAll(async () => {
    await db?.end();
  });

  const draft = async () => {
    const id = await service.createDocument({ messageId: message, userId: user, departmentId: dept, type: 'board_paper', language: 'en', subject: 'Pilot', addressedTo: 'Board' });
    await db.query(`UPDATE official_documents SET status = 'draft' WHERE id = $1`, [id]);
    return id;
  };

  it('snapshots the outline into the document', async () => {
    const doc = (await service.loadDocument(await draft()))!;
    expect(doc.sections.map((s) => s.key)).toContain('signoff');
    expect(doc.sections.every((s) => s.status === 'pending' && s.content === '')).toBe(true);
  });

  it('gives documents approved at the same moment different reference numbers', async () => {
    const [a, b, c] = await Promise.all([draft(), draft(), draft()]);
    const refs = await Promise.all([a, b, c].map((id) => service.approveDocument(id, user)));
    const year = new Date(Date.now() + 8 * 3600_000).getUTCFullYear();
    expect([...refs].sort()).toEqual([`XB/BP/${year}/001`, `XB/BP/${year}/002`, `XB/BP/${year}/003`]);
    await expect(service.approveDocument(a, user)).rejects.toThrow(/Only a finished draft/);
  });

  it('keeps an approved document when the conversation is deleted', async () => {
    const id = await draft();
    await service.approveDocument(id, user);
    await db.query(`DELETE FROM messages WHERE id = $1`, [message]);
    const doc = await service.loadDocument(id);
    expect(doc?.status).toBe('approved');
    expect(doc?.message_id).toBeNull();
  });
});
