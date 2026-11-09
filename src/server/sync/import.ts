import "server-only";

import { getBankCredentialMeta } from "@/server/db/queries/bank-credentials";
import {
  completeSyncRun,
  createSyncRun,
  failSyncRun,
} from "@/server/db/queries/sync-runs";
import { insertTransactions } from "@/server/db/queries/transactions";
import { applyMerchantRulesToSyncRun } from "@/server/db/queries/excluded-merchants";
import { getLoginAccounts } from "@/server/lib/card-bills";
import { finishImportedRows } from "@/server/sync/orchestrator";
import type { ImportResult, ImportRow } from "@/lib/types";

export const MAX_IMPORT_ROWS = 20_000;

/** Used when the login has no rows yet, so there's no account number to reuse. */
const FALLBACK_ACCOUNT = "imported";

export class ImportError extends Error {}

function parseDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Rejects 2026-02-31 and friends, which Date would roll into March.
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

/**
 * Inserts rows from a bank's exported file as one sync run on that login, so
 * they dedup against scraped rows and against a second import of the same file.
 */
export function importTransactions(
  workspaceId: number,
  credentialId: number,
  rows: unknown[]
): ImportResult {
  const meta = getBankCredentialMeta(workspaceId, credentialId);
  if (!meta) throw new ImportError("That bank connection no longer exists.");
  if (rows.length === 0) throw new ImportError("The file has no rows to import.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportError(
      `That's more than ${MAX_IMPORT_ROWS.toLocaleString("en")} rows. Split the file and import it in parts.`
    );
  }

  const earliest = new Date(2000, 0, 1);
  const latest = new Date();
  latest.setDate(latest.getDate() + 60);

  const accountNumber =
    getLoginAccounts(workspaceId).get(credentialId)?.[0]?.accountNumber ?? FALLBACK_ACCOUNT;

  let skipped = 0;
  const valid: { day: Date; row: ImportRow }[] = [];
  for (const raw of rows) {
    const row = raw as Partial<ImportRow> | null;
    const day = parseDay(row?.date);
    const description = typeof row?.description === "string" ? row.description.trim() : "";
    const amount = typeof row?.amount === "number" ? row.amount : NaN;
    if (
      !day ||
      day < earliest ||
      day > latest ||
      !description ||
      !Number.isFinite(amount) ||
      amount === 0
    ) {
      skipped++;
      continue;
    }
    const memo = typeof row?.memo === "string" ? row.memo.trim().slice(0, 500) : "";
    valid.push({
      day,
      row: {
        date: row!.date!,
        description: description.slice(0, 300),
        amount: Math.round(amount * 100) / 100,
        ...(memo ? { memo } : {}),
      },
    });
  }
  if (valid.length === 0) {
    throw new ImportError("None of the rows had a readable date, description and amount.");
  }

  const from = valid.reduce((min, v) => (v.row.date < min ? v.row.date : min), valid[0].row.date);
  const syncRunId = createSyncRun(workspaceId, meta.provider, credentialId, from);

  let inserted: ReturnType<typeof insertTransactions>;
  try {
    inserted = insertTransactions(
    workspaceId,
    valid.map(({ day, row }) => {
      // Scraped dates are the UTC instant of local midnight; match that.
      const date = day.toISOString();
      return {
        accountNumber,
        date,
        processedDate: date,
        originalAmount: row.amount,
        originalCurrency: "ILS",
        chargedAmount: row.amount,
        chargedCurrency: "ILS",
        description: row.description,
        memo: row.memo,
        type: "normal" as const,
        status: "completed" as const,
      };
    }),
    meta.provider,
    credentialId,
    syncRunId
  );
  } catch (err) {
    failSyncRun(syncRunId, "File import failed");
    throw err;
  }
  const { added, updated, routedWorkspaceIds } = inserted;

  const touched = [workspaceId, ...routedWorkspaceIds];
  for (const id of touched) applyMerchantRulesToSyncRun(id, syncRunId);
  completeSyncRun(syncRunId, added, updated);
  finishImportedRows(touched);

  return { added, updated, skipped };
}
