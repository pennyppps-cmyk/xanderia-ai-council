import type { Queryable } from '../db/pool.js';

export interface AccessUser {
  id: string;
  department_id: string;
}

/**
 * Departments whose documents this user may retrieve: their own department plus
 * any cross-department grants. Company-wide documents are always included by the
 * retrieval query. The department a user *asks* does not widen this set.
 */
export async function accessibleDepartmentIds(db: Queryable, user: AccessUser): Promise<string[]> {
  const { rows } = await db.query(
    'SELECT department_id FROM user_department_access WHERE user_id = $1',
    [user.id],
  );
  return [...new Set([user.department_id, ...rows.map((r: any) => r.department_id as string)])];
}

/** SQL predicate on `documents d`; $n is the allowed department id array. */
export function accessPredicate(paramIndex: number) {
  return `(d.company_wide OR d.department_id = ANY($${paramIndex}::uuid[]))`;
}
