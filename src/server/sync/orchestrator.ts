import "server-only";

import {
  getBankCredentials,
  getRequiresManualTwoFactor,
  listBankCredentials,
  updateCredentialField,
  type BankCredentialMeta,
} from "@/server/db/queries/bank-credentials";
import { getAppSettings } from "@/server/db/queries/settings";
import { isBankAccountProvider, reconcileCardBills } from "@/server/lib/card-bills";
import { saveAccountBalances } from "@/server/db/queries/balances";
import { getLoginHome, listRoutedIn } from "@/server/lib/card-routes";
import {
  excludedCards,
  listLoginCards,
  recordSeenCards,
  type LoginCardRow,
  type SeenCard,
} from "@/server/db/queries/login-cards";
import {
  createSyncRun,
  completeSyncRun,
  failSyncRun,
  isCredentialSyncing,
} from "@/server/db/queries/sync-runs";
import {
  insertTransactions,
  settleStalePending,
  getUncategorizedIdsByKind,
  getTransactionsForCategorization,
  batchUpdateCategories,
  batchSetNeedsReview,
} from "@/server/db/queries/transactions";
import {
  lookupMerchantCategoriesBulk,
  normalizeMerchant,
  incrementMerchantHits,
} from "@/server/lib/merchant-memory";
import { applyMerchantRulesToSyncRun } from "@/server/db/queries/excluded-merchants";
import { getAllCategories } from "@/server/db/queries/categories";
import { getRecentCorrections } from "@/server/db/queries/category-corrections";
import { canShowBrowser, scrapeBank } from "@/server/scrapers";
import {
  scrapeOneZeroFirstTime,
  scrapeOneZeroWithToken,
} from "@/server/scrapers/one-zero";
import { createAIProvider } from "@/server/ai/factory";
import { ensureOllamaRunning } from "@/server/ai/ollama-manager";
import { toLocalISODate } from "@/server/lib/date-utils";
import { listAllWorkspaceIds } from "@/server/lib/workspace-context";
import { getWorkspace } from "@/server/db/queries/workspaces";
import { BANK_PROVIDERS, type BankProvider, type SyncKind } from "@/lib/types";
import {
  cancelOtpRequest,
  registerOtpRequest,
} from "@/server/sync/otp-bridge";
import {
  markSyncEnd,
  markSyncHeartbeat,
  markSyncStart,
} from "@/server/sync/activity";
import type { CardScope, ScrapeResult } from "@/server/scrapers/types";

export type SyncEventSender = (
  event: string,
  data: Record<string, unknown>
) => void;

export interface ProviderResult {
  provider: BankProvider;
  credentialId: number;
  label: string;
  ok: boolean;
  added: number;
  updated: number;
  errorMessage?: string;
  syncRunId?: number;
  /** Other workspaces that received rows from cards routed there. */
  routedWorkspaceIds?: number[];
}

export interface WorkspaceSummary {
  workspaceId: number;
  workspaceName: string;
  providers: ProviderResult[];
  added: number;
  updated: number;
  categorized: number;
  aiWarning: string | null;
}

export function friendlyAIError(err: unknown, modelName: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/model.*not found|pull.*model|404/i.test(msg)) {
    return `Ollama model "${modelName}" is not installed. Run: ollama pull ${modelName}`;
  }
  if (/ECONNREFUSED|fetch failed/i.test(msg)) {
    return "Ollama is not reachable. Make sure it's installed and that no firewall is blocking port 11434.";
  }
  if (/Anthropic|api[_-]?key|401|403/i.test(msg)) {
    return "Claude API request was rejected. Check your API key in settings.";
  }
  return `AI categorization failed: ${msg}`;
}

function supportsProgrammaticTwoFactor(provider: BankProvider): boolean {
  return Boolean(
    BANK_PROVIDERS.find((b) => b.id === provider)?.supportsProgrammaticTwoFactor
  );
}

interface RunScrapeArgs {
  workspaceId: number;
  workspaceName: string;
  credentialId: number;
  provider: BankProvider;
  credentials: Record<string, string>;
  startDate: Date;
  syncRunId: number;
  manualTwoFactor: boolean;
  send: SyncEventSender;
  cardScope?: CardScope;
}

async function runScrapeForProvider(args: RunScrapeArgs): Promise<ScrapeResult> {
  const {
    workspaceId,
    workspaceName,
    credentialId,
    provider,
    credentials,
    startDate,
    syncRunId,
    manualTwoFactor,
    send,
  } = args;

  if (supportsProgrammaticTwoFactor(provider)) {
    const existingToken = credentials.otpLongTermToken;
    if (existingToken) {
      const withToken = await scrapeOneZeroWithToken({
        email: credentials.email,
        password: credentials.password,
        otpLongTermToken: existingToken,
        startDate,
      });
      if (!withToken.tokenRejected) return withToken;
      // The saved token expired. Drop it and fall through to the SMS flow so
      // this same sync asks for a fresh code instead of failing every time.
      updateCredentialField(workspaceId, credentialId, "otpLongTermToken", null);
    }

    if (!credentials.email || !credentials.password) {
      return {
        success: false,
        accounts: [],
        errorMessage: "Email and password are required for One Zero.",
      };
    }
    if (!credentials.phoneNumber) {
      return {
        success: false,
        accounts: [],
        errorMessage:
          "Phone number is required to receive the One Zero 2FA code.",
      };
    }

    const bridge = registerOtpRequest(syncRunId, workspaceId, provider);

    const result = await scrapeOneZeroFirstTime({
      email: credentials.email,
      password: credentials.password,
      phoneNumber: credentials.phoneNumber,
      startDate,
      awaitOtp: async () => {
        send("provider-2fa-needed", {
          workspaceId,
          workspaceName,
          provider,
          syncRunId,
        });
        return bridge.wait();
      },
      onOtpSubmitted: () => {
        send("provider-2fa-submitted", {
          workspaceId,
          workspaceName,
          provider,
          syncRunId,
        });
      },
    });

    if (result.otpLongTermToken) {
      updateCredentialField(
        workspaceId,
        credentialId,
        "otpLongTermToken",
        result.otpLongTermToken
      );
    }

    return result;
  }

  if (manualTwoFactor && !BANK_PROVIDERS.find((b) => b.id === provider)?.asksCodeInApp && canShowBrowser()) {
    send("provider-2fa-manual", {
      workspaceId,
      workspaceName,
      provider,
    });
  }

  // Banks that send a code mid-login (Hapoalim): ask in the sync dialog,
  // but only when someone is watching it. A scheduled sync has no dialog.
  const interactive = send !== NOOP_SEND;
  return scrapeBank(workspaceId, provider, credentials, startDate, {
    manualTwoFactor,
    cardScope: args.cardScope,
    credentialId,
    askForCode: interactive
      ? () => {
          const bridge = registerOtpRequest(syncRunId, workspaceId, provider);
          send("provider-2fa-needed", { workspaceId, workspaceName, provider, syncRunId });
          return bridge.wait();
        }
      : undefined,
    onCodeSubmitted: () => send("provider-2fa-submitted", { workspaceId, workspaceName, provider, syncRunId }),
  });
}

/** Logins in the middle of a quick card check (no sync run row to show it). */
const checkingCards = new Set<number>();

function listsCards(provider: string): boolean {
  return Boolean(BANK_PROVIDERS.find((b) => b.id === provider)?.listsCards);
}

/** Which cards a sync of this login reads: the ones asked for, minus any the user left out. */
function cardScopeFor(meta: BankCredentialMeta, onlyCards?: string[]): CardScope | undefined {
  if (!listsCards(meta.provider)) return undefined;
  if (onlyCards && onlyCards.length > 0) return { only: onlyCards };
  const skip = excludedCards(meta.id);
  return skip.length > 0 ? { skip } : undefined;
}

export class CardCheckError extends Error {}

/**
 * The quick card check: sign in, read the card list, save it. No
 * transactions, so it takes seconds instead of minutes, and the user can
 * choose which cards to sync before the first full sync.
 */
export async function checkLoginCards(credentialId: number): Promise<LoginCardRow[]> {
  const home = getLoginHome(credentialId);
  if (!home || !listsCards(home.provider)) {
    throw new CardCheckError("This connection can't list its cards.");
  }
  if (checkingCards.has(credentialId) || isCredentialSyncing(credentialId)) {
    throw new CardCheckError(`${home.label} is syncing right now. Try again when it finishes.`);
  }
  const credentials = getBankCredentials(home.workspaceId, credentialId);
  if (!credentials) throw new CardCheckError(`No credentials saved for ${home.label}.`);

  checkingCards.add(credentialId);
  markSyncHeartbeat();
  try {
    const result = await scrapeBank(home.workspaceId, home.provider as BankProvider, credentials, new Date(), {
      manualTwoFactor: getRequiresManualTwoFactor(home.workspaceId, credentialId),
      cardScope: { listOnly: true },
    });
    if (!result.success) throw new CardCheckError(result.errorMessage ?? "Couldn't read the card list.");
    recordSeenCards(credentialId, seenCards(result.accounts));
    return listLoginCards(credentialId);
  } finally {
    checkingCards.delete(credentialId);
  }
}

function seenCards(accounts: ScrapeResult["accounts"]): SeenCard[] {
  return accounts
    .filter((a) => a.card)
    .map((a) => ({ accountNumber: a.accountNumber, label: a.card!.label, active: a.card!.active }));
}

async function syncOneCredential(
  workspaceId: number,
  workspaceName: string,
  meta: BankCredentialMeta,
  credentials: Record<string, string>,
  startDate: Date,
  send: SyncEventSender,
  onlyCards?: string[]
): Promise<ProviderResult> {
  const provider = meta.provider as BankProvider;
  // Two sign-ins to one bank at once can log each other out, and both would
  // write the same rows. Let the first finish.
  if (isCredentialSyncing(meta.id) || checkingCards.has(meta.id)) {
    return {
      provider,
      credentialId: meta.id,
      label: meta.label,
      ok: false,
      added: 0,
      updated: 0,
      errorMessage: `${meta.label} is already syncing. Its results will show up when that sync finishes.`,
    };
  }
  const syncRunId = createSyncRun(
    workspaceId,
    provider,
    meta.id,
    toLocalISODate(startDate)
  );
  const manualTwoFactor = getRequiresManualTwoFactor(workspaceId, meta.id);

  let result: ScrapeResult;
  try {
    result = await runScrapeForProvider({
      workspaceId,
      workspaceName,
      credentialId: meta.id,
      provider,
      credentials,
      startDate,
      syncRunId,
      manualTwoFactor,
      send,
      cardScope: cardScopeFor(meta, onlyCards),
    });
  } catch (err) {
    // A thrown error (rather than a returned failure) used to leave the run
    // stuck as "running" forever. Record it, then let the caller report it.
    failSyncRun(
      syncRunId,
      err instanceof Error ? err.message.replace(/\b\d{5,}\b/g, "[REDACTED]") : "Scraping failed"
    );
    throw err;
  } finally {
    cancelOtpRequest(syncRunId, "Scrape completed");
  }

  if (!result.success) {
    failSyncRun(syncRunId, result.errorMessage ?? "Scraping failed");
    return {
      provider,
      credentialId: meta.id,
      label: meta.label,
      ok: false,
      added: 0,
      updated: 0,
      errorMessage: result.errorMessage ?? "Scraping failed",
      syncRunId,
    };
  }

  recordSeenCards(meta.id, seenCards(result.accounts));
  if (isBankAccountProvider(provider)) saveAccountBalances(meta.id, result.accounts);

  const allTransactions = result.accounts.flatMap((account) =>
    account.transactions.map((txn) => ({
      accountNumber: account.accountNumber,
      ...txn,
      installmentNumber: txn.installments?.number,
      installmentTotal: txn.installments?.total,
    }))
  );

  const { added, updated, routedWorkspaceIds, pendingSeen } = insertTransactions(
    workspaceId,
    allTransactions,
    provider,
    meta.id,
    syncRunId
  );
  const settled = settleStalePending(
    meta.id,
    result.accounts.map((a) => a.accountNumber),
    startDate,
    pendingSeen
  );
  if (settled > 0) console.log(`[sync] ${provider}: ${settled} pending row(s) settled or cancelled since the last sync`);
  for (const id of [workspaceId, ...routedWorkspaceIds]) {
    applyMerchantRulesToSyncRun(id, syncRunId);
  }
  completeSyncRun(syncRunId, added, updated);

  return {
    provider,
    credentialId: meta.id,
    label: meta.label,
    ok: true,
    added,
    updated,
    syncRunId,
    routedWorkspaceIds,
  };
}

/** A login to sync, and the workspace it belongs to (where its rows land unless a card is routed). */
interface SyncTarget {
  meta: BankCredentialMeta;
  homeWorkspaceId: number;
}

/**
 * The logins a workspace's sync covers: its own, plus logins from other
 * workspaces whose cards were moved here. Without the second group, a card
 * moved out of its login's workspace could only be refreshed from there.
 */
function listSyncTargets(workspaceId: number): SyncTarget[] {
  const targets: SyncTarget[] = listBankCredentials(workspaceId).map((meta) => ({
    meta,
    homeWorkspaceId: workspaceId,
  }));
  for (const credentialId of new Set(listRoutedIn(workspaceId).map((r) => r.credentialId))) {
    const home = getLoginHome(credentialId);
    const meta = home
      ? listBankCredentials(home.workspaceId).find((c) => c.id === credentialId)
      : undefined;
    if (home && meta) targets.push({ meta, homeWorkspaceId: home.workspaceId });
  }
  // Paused banks block automated sign-in; their rows arrive by file import.
  return targets.filter(
    (t) => !BANK_PROVIDERS.find((b) => b.id === t.meta.provider)?.syncPaused
  );
}

export async function syncWorkspace(
  workspaceId: number,
  filterCredentialId: number | undefined,
  send: SyncEventSender,
  /** Logins already synced in this run (syncing every workspace); skipped and then added to. */
  alreadySynced?: Set<number>,
  /** With a single login: read only these of its cards. */
  onlyCards?: string[]
): Promise<WorkspaceSummary> {
  const workspace = getWorkspace(workspaceId);
  const workspaceName = workspace?.name ?? `Workspace ${workspaceId}`;

  const targets = listSyncTargets(workspaceId).filter(
    (t) =>
      (filterCredentialId == null || t.meta.id === filterCredentialId) &&
      !alreadySynced?.has(t.meta.id)
  );
  for (const t of targets) alreadySynced?.add(t.meta.id);
  const credsToSync = targets.map((t) => t.meta);

  if (credsToSync.length === 0) {
    send("plan", {
      workspaceId,
      workspaceName,
      providers: [],
      total: 0,
    });
    return {
      workspaceId,
      workspaceName,
      providers: [],
      added: 0,
      updated: 0,
      categorized: 0,
      aiWarning: null,
    };
  }

  // A login reaches back as far as its own workspace's setting says.
  const startDateFor = (homeId: number) => {
    const date = new Date();
    date.setMonth(date.getMonth() - getAppSettings(homeId).monthsToSync);
    return date;
  };

  send("plan", {
    workspaceId,
    workspaceName,
    providers: credsToSync.map((c) => c.provider),
    total: credsToSync.length,
  });

  const results: ProviderResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const { meta, homeWorkspaceId } = targets[i];
    const provider = meta.provider as BankProvider;

    send("provider-start", {
      workspaceId,
      workspaceName,
      provider,
      credentialId: meta.id,
      label: meta.label,
      index: i,
      total: credsToSync.length,
    });
    markSyncHeartbeat();

    const credentials = getBankCredentials(homeWorkspaceId, meta.id);
    if (!credentials) {
      send("provider-done", {
        workspaceId,
        workspaceName,
        provider,
        credentialId: meta.id,
        label: meta.label,
        ok: false,
        added: 0,
        updated: 0,
        errorMessage: `No credentials configured for ${meta.label}`,
      });
      results.push({
        provider,
        credentialId: meta.id,
        label: meta.label,
        ok: false,
        added: 0,
        updated: 0,
        errorMessage: "No credentials",
      });
      continue;
    }

    try {
      const homeName =
        homeWorkspaceId === workspaceId
          ? workspaceName
          : getWorkspace(homeWorkspaceId)?.name ?? `Workspace ${homeWorkspaceId}`;
      const result = await syncOneCredential(
        homeWorkspaceId,
        homeName,
        meta,
        credentials,
        startDateFor(homeWorkspaceId),
        send,
        filterCredentialId != null ? onlyCards : undefined
      );
      // A moved-in login's unrouted cards write to its own workspace, which
      // then needs the same bill matching and categorizing as routed ones.
      if (homeWorkspaceId !== workspaceId) {
        result.routedWorkspaceIds = [...(result.routedWorkspaceIds ?? []), homeWorkspaceId];
      }
      results.push(result);
      send("provider-done", {
        workspaceId,
        workspaceName,
        provider,
        credentialId: meta.id,
        label: meta.label,
        ok: result.ok,
        added: result.added,
        updated: result.updated,
        errorMessage: result.errorMessage,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message.replace(/\b\d{5,}\b/g, "[REDACTED]")
          : "Unknown scrape error";
      results.push({
        provider,
        credentialId: meta.id,
        label: meta.label,
        ok: false,
        added: 0,
        updated: 0,
        errorMessage: message,
      });
      send("provider-done", {
        workspaceId,
        workspaceName,
        provider,
        credentialId: meta.id,
        label: meta.label,
        ok: false,
        added: 0,
        updated: 0,
        errorMessage: message,
      });
    }
  }

  const totalAdded = results.reduce((s, r) => s + r.added, 0);
  const totalUpdated = results.reduce((s, r) => s + r.updated, 0);

  // Before categorizing, so card bill debits become transfers and the AI
  // doesn't spend a call labeling them as spending.
  try {
    reconcileCardBills(workspaceId);
  } catch (err) {
    console.error("[sync] card bill reconciliation failed:", err);
  }

  const { categorized: ownCategorized, aiWarning: ownWarning } = await categorizeWorkspace(
    workspaceId,
    workspaceName,
    send
  );
  let categorized = ownCategorized;
  let aiWarning = ownWarning;

  // Cards routed to other workspaces wrote rows there. Give those workspaces
  // the same card bill matching and categorizing, without waiting for their
  // own sync.
  const routedWorkspaceIds = new Set(results.flatMap((r) => r.routedWorkspaceIds ?? []));
  routedWorkspaceIds.delete(workspaceId);
  for (const otherId of routedWorkspaceIds) {
    try {
      reconcileCardBills(otherId);
    } catch (err) {
      console.error("[sync] card bill reconciliation failed:", err);
    }
    const otherName = getWorkspace(otherId)?.name ?? `Workspace ${otherId}`;
    const other = await categorizeWorkspace(otherId, otherName, send);
    categorized += other.categorized;
    aiWarning = aiWarning ?? other.aiWarning;
  }

  return {
    workspaceId,
    workspaceName,
    providers: results,
    added: totalAdded,
    updated: totalUpdated,
    categorized,
    aiWarning,
  };
}

/**
 * What a sync does after inserting rows, for rows that came from a file:
 * match card bills, then categorize. Categorizing can take minutes with a
 * local model, so it runs in the background and the import returns at once.
 */
export function finishImportedRows(workspaceIds: number[]): void {
  for (const id of workspaceIds) {
    try {
      reconcileCardBills(id);
    } catch (err) {
      console.error("[import] card bill reconciliation failed:", err);
    }
  }
  void (async () => {
    for (const id of workspaceIds) {
      const name = getWorkspace(id)?.name ?? `Workspace ${id}`;
      try {
        await categorizeWorkspace(id, name, NOOP_SEND);
      } catch (err) {
        console.error("[import] categorization failed:", err);
      }
    }
  })();
}

/**
 * Categorizes a workspace's uncategorized transactions: merchant memory
 * first, then the AI provider in batches.
 */
async function categorizeWorkspace(
  workspaceId: number,
  workspaceName: string,
  send: SyncEventSender
): Promise<{ categorized: number; aiWarning: string | null }> {
  const settings = getAppSettings(workspaceId);
  let categorized = 0;
  let aiWarning: string | null = null;

  const aiProvider = createAIProvider();
  if (!aiProvider) {
    aiWarning =
      "AI provider not connected — new transactions weren't auto-categorized.";
  }
  if (aiProvider) {
    if (settings.aiProvider === "ollama") {
      send("stage", {
        workspaceId,
        workspaceName,
        stage: "ollama-start",
      });
      const ollamaResult = await ensureOllamaRunning(settings.ollamaUrl);
      if (!ollamaResult.ok) {
        aiWarning = ollamaResult.error ?? "Ollama is not reachable";
        console.error("[sync]", aiWarning);
      }
    }

    if (!aiWarning) {
      send("stage", {
        workspaceId,
        workspaceName,
        stage: "categorizing",
      });

      const KINDS: Array<"expense" | "income"> = ["expense", "income"];
      const BATCH_SIZE = 50;

      for (const kind of KINDS) {
        const uncategorizedIds = getUncategorizedIdsByKind(workspaceId, kind);
        if (uncategorizedIds.length === 0) continue;

        const categories = getAllCategories(workspaceId, kind);
        if (categories.length === 0) continue;
        const categoryInput = categories.map((c) => ({
          name: c.name,
          description: c.description,
        }));
        const pastCorrections = getRecentCorrections(workspaceId, kind);

        const allTxns = getTransactionsForCategorization(
          workspaceId,
          uncategorizedIds
        );

        const memoryMap = lookupMerchantCategoriesBulk(
          workspaceId,
          allTxns.map((t) => t.description)
        );

        const memoryUpdates: { id: number; categoryId: number }[] = [];
        const memoryKeysHit: string[] = [];
        const remainingTxns: typeof allTxns = [];
        for (const t of allTxns) {
          const m = memoryMap.get(t.description);
          if (m && m.kind === kind) {
            memoryUpdates.push({ id: t.id, categoryId: m.categoryId });
            memoryKeysHit.push(normalizeMerchant(t.description));
          } else {
            remainingTxns.push(t);
          }
        }
        if (memoryUpdates.length > 0) {
          batchUpdateCategories(workspaceId, memoryUpdates);
          incrementMerchantHits(workspaceId, memoryKeysHit);
          categorized += memoryUpdates.length;
          send("stage", {
            workspaceId,
            workspaceName,
            stage: "memory-hit",
            count: memoryUpdates.length,
            kind,
          });
        }

        for (let i = 0; i < remainingTxns.length; i += BATCH_SIZE) {
          const batch = remainingTxns.slice(i, i + BATCH_SIZE);

          try {
            const mappings = await aiProvider.categorize(
              batch.map((t) => ({
                description: t.description,
                amount: t.chargedAmount,
                currency: t.originalCurrency,
                memo: t.memo,
              })),
              categoryInput,
              { pastCorrections }
            );

            const updates: {
              id: number;
              categoryId: number;
              aiConfidence: number | null;
            }[] = [];
            const reviewFlags: { id: number; needsReview: boolean }[] = [];

            for (const m of mappings) {
              const category = categories.find(
                (c) => c.name === m.categoryName
              );
              const txn = batch[m.index];
              if (!category || !txn) continue;
              const confidence = m.confidence ?? null;
              updates.push({
                id: txn.id,
                categoryId: category.id,
                aiConfidence: confidence,
              });
              reviewFlags.push({
                id: txn.id,
                needsReview: confidence == null || confidence <= 4,
              });
            }

            batchUpdateCategories(workspaceId, updates);
            batchSetNeedsReview(workspaceId, reviewFlags);
            categorized += updates.length;
          } catch (err) {
            console.error(
              `[sync] AI categorization batch failed (${kind}):`,
              err
            );
            if (!aiWarning) {
              aiWarning = friendlyAIError(err, settings.ollamaModel);
            }
          }
        }
      }
    }
  }

  return { categorized, aiWarning };
}

const NOOP_SEND: SyncEventSender = () => {};

export async function runAllWorkspaces(
  filterCredentialId?: number,
  onEvent?: SyncEventSender,
  kind: SyncKind = "manual"
): Promise<WorkspaceSummary[]> {
  const send = onEvent ?? NOOP_SEND;
  markSyncStart(kind);
  try {
    const workspaceIds = listAllWorkspaceIds();
    const summaries: WorkspaceSummary[] = [];
    // A login with cards in several workspaces is listed by each; scrape it once.
    const synced = new Set<number>();
    for (const workspaceId of workspaceIds) {
      const summary = await syncWorkspace(workspaceId, filterCredentialId, send, synced);
      summaries.push(summary);
    }
    return summaries;
  } finally {
    markSyncEnd();
  }
}
