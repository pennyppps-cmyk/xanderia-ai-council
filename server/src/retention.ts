import { tx } from './db/pool.js';
import { writeAudit } from './audit.js';
import { getSetting } from './settings.js';

/** PDPA retention: delete conversations and audit rows older than `retention_months`. */
export async function runRetention() {
  const months = Number(await getSetting('retention_months', 12));
  if (!Number.isFinite(months) || months <= 0) return { conversations: 0, audit: 0 };
  const result = await tx(async (c) => {
    const conv = await c.query(
      `DELETE FROM conversations WHERE updated_at < now() - make_interval(months => $1)`,
      [months],
    );
    await c.query(`DELETE FROM attachments WHERE message_id IS NULL AND created_at < now() - interval '1 day'`);
    // The audit trigger only permits deletes while this transaction-local flag is on.
    await c.query(`SELECT set_config('xanderia.audit_purge', 'on', true)`);
    const audit = await c.query(`DELETE FROM audit_log WHERE at < now() - make_interval(months => $1)`, [months]);
    return { conversations: conv.rowCount ?? 0, audit: audit.rowCount ?? 0 };
  });
  await writeAudit({ action: 'retention_run', detail: { months, ...result } });
  return result;
}
