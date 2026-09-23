import { query } from './db/pool.js';
import type { AuditEntry } from './llm/gateway.js';

export async function writeAudit(entry: AuditEntry & { ip?: string }) {
  await query(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, detail, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.actorUserId ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.detail ?? {}),
      entry.ip ?? null,
    ],
  );
}
