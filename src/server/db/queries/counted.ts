import "server-only";

import { scopeSql } from "../../lib/scope";

/** The "is this row counted" test on its own, without the budget scope. */
function countedCoreSql(alias?: string): string {
  const p = alias ? `${alias}.` : "";
  return `${p}is_excluded = 0 AND NOT EXISTS (
    SELECT 1 FROM categories nc
    WHERE nc.id = ${p}category_id AND nc.counts_in_spending = 0
  )`;
}

/**
 * SQL condition for "this transaction counts toward spending and income
 * totals". A row is left out when the user excluded it (or its merchant),
 * when its category is marked as not counted (Transfers by default), or when
 * it falls outside the active budget scope (see src/server/lib/scope.ts).
 *
 * Card bill payments are handled separately by `kind = 'transfer'`, so callers
 * still filter on `kind` themselves.
 *
 * @param alias table alias used in the query, e.g. "t". Omit for none.
 */
export function countedSql(alias?: string): string {
  return `${scopeSql(alias)} AND ${countedCoreSql(alias)}`;
}

/**
 * Rows that are visible but not counted. Still limited to the budget scope:
 * "not counted" means left out of totals, not "outside the selected accounts".
 */
export function notCountedSql(alias?: string): string {
  return `${scopeSql(alias)} AND NOT (${countedCoreSql(alias)})`;
}
