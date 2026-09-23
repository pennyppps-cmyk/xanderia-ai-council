import { query } from './db/pool.js';

const cache = new Map<string, { at: number; value: unknown }>();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.value as T;
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  const value = rows[0] ? (rows[0].value as T) : fallback;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSetting(key: string, value: unknown) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  cache.delete(key);
}

export async function allSettings() {
  const { rows } = await query('SELECT key, value FROM settings ORDER BY key');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const ROLE_RANK = { employee: 0, dept_lead: 1, admin: 2 } as const;
export type UserRole = keyof typeof ROLE_RANK;

export function roleAtLeast(role: UserRole, min: UserRole) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function canUseCouncil(role: UserRole) {
  return roleAtLeast(role, await getSetting<UserRole>('council_min_role', 'employee'));
}
