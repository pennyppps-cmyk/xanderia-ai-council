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
    await c.query(`DELETE FROM notis_log WHERE at < now() - make_interval(months => $1)`, [months]);
    // Notis blast: customer details (IC, address, amounts) are removed after notis_retention_days.
    const notisDays = Number(await getSetting('notis_retention_days', 90));
    const notis = await c.query(
      `WITH old AS (UPDATE notis_batches SET purged_at = now() WHERE purged_at IS NULL AND created_at < now() - make_interval(days => $1) RETURNING id)
       UPDATE notis_rows SET data = NULL, email = NULL, customer_name = NULL WHERE batch_id IN (SELECT id FROM old) AND delivery IS DISTINCT FROM 'queued'`,
      [Number.isFinite(notisDays) && notisDays > 0 ? notisDays : 90],
    );
    await c.query(`DELETE FROM merge_log WHERE at < now() - make_interval(months => $1)`, [months]);
    // Templates workspace: uploaded rows are removed after merge_retention_days (templates stay).
    const mergeDays = Number(await getSetting('merge_retention_days', 90));
    const merge = await c.query(
      `WITH old AS (UPDATE merge_runs SET purged_at = now() WHERE purged_at IS NULL AND created_at < now() - make_interval(days => $1) RETURNING id)
       UPDATE merge_rows SET record = NULL WHERE run_id IN (SELECT id FROM old) AND delivery IS DISTINCT FROM 'queued'`,
      [Number.isFinite(mergeDays) && mergeDays > 0 ? mergeDays : 90],
    );
    return { conversations: conv.rowCount ?? 0, audit: audit.rowCount ?? 0, notisRows: notis.rowCount ?? 0, mergeRows: merge.rowCount ?? 0 };
  });
  await writeAudit({ action: 'retention_run', detail: { months, ...result } });
  return result;
}
