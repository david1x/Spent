import type {
  SetupStatus,
  AppSettings,
  TransactionWithCategory,
  TransactionHistory,
  DashboardSummary,
  Category,
  SyncRun,
  Budget,
  BudgetMode,
  Integration,
  Workspace,
  HomePayload,
  ActivitySnapshot,
  TransactionListAggregates,
  CardAccount,
  RoutedInCard,
  LoginCard,
  SpendingTrend,
  ImportRow,
  ImportResult,
  CategoryRequest,
} from "./types";
import type { InsightsPayload, RecurringCadence } from "./insights-types";
import { getActiveWorkspaceIdSync } from "./workspace-store";
import { AuthApiError } from "./auth-api";
import { scopeHeaderValue } from "./scope-store";

const BASE = "";

function withWorkspaceHeader(init?: RequestInit): RequestInit {
  const wsId = getActiveWorkspaceIdSync();
  const headers = new Headers(init?.headers);
  if (wsId != null && !headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", String(wsId));
  }
  // Bank bundles the user narrowed the totals to; absent means all accounts.
  const scope = scopeHeaderValue();
  if (scope && !headers.has("x-spent-scope")) {
    headers.set("x-spent-scope", scope);
  }
  return { ...init, headers };
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, withWorkspaceHeader(init));
  if (!res.ok) {
    const text = await res.text().catch(() => "Request failed");
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

export function listWorkspaces() {
  return fetchJSON<Workspace[]>("/api/workspaces");
}

export function createWorkspace(name: string) {
  return fetchJSON<Workspace>("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function renameWorkspace(id: number, name: string) {
  return fetchJSON<Workspace>(`/api/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteWorkspace(id: number) {
  return fetchJSON<{ success: boolean }>(`/api/workspaces/${id}`, {
    method: "DELETE",
  });
}

export function getSetupStatus() {
  return fetchJSON<SetupStatus>("/api/setup/status");
}

export function saveBankCredentials(
  provider: string,
  credentials: Record<string, string>,
  options?: {
    label?: string;
    credentialId?: number;
    requiresManualTwoFactor?: boolean;
  }
) {
  return fetchJSON<{ success: boolean; credentialId: number }>("/api/setup/bank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      credentials,
      ...(options?.label !== undefined ? { label: options.label } : {}),
      ...(options?.credentialId !== undefined
        ? { credentialId: options.credentialId }
        : {}),
      ...(options?.requiresManualTwoFactor !== undefined
        ? { requiresManualTwoFactor: options.requiresManualTwoFactor }
        : {}),
    }),
  });
}

export function updateIntegrationSettings(
  credentialId: number,
  updates: { requiresManualTwoFactor?: boolean; resetTwoFactorToken?: boolean }
) {
  return fetchJSON<{ success: boolean }>(`/api/integrations/${credentialId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

/** The cards under one card login (a Cal user can hold several). */
export function listCardAccounts(credentialId: number) {
  return fetchJSON<CardAccount[]>(`/api/integrations/${credentialId}/cards`);
}

/** Sets or clears which bank login pays one card's bill. */
export function setCardPaidFrom(
  credentialId: number,
  accountNumber: string,
  bankCredentialId: number | null
) {
  return fetchJSON<{ success: boolean; card: CardAccount | null }>(
    `/api/integrations/${credentialId}/cards`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountNumber, bankCredentialId }),
    }
  );
}

export function submitSyncOtp(syncRunId: number, code: string) {
  return fetchJSON<{ success: boolean }>("/api/sync/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ syncRunId, code }),
  });
}

export function testBankConnection(
  provider: string,
  options?: { credentialId?: number; credentials?: Record<string, string> }
) {
  return fetchJSON<{
    success: boolean;
    message: string;
    accountsFound?: number;
  }>("/api/setup/bank/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      ...(options?.credentialId !== undefined
        ? { credentialId: options.credentialId }
        : {}),
      ...(options?.credentials !== undefined
        ? { credentials: options.credentials }
        : {}),
    }),
  });
}

export interface ClaudeKeyStatus {
  state: "missing" | "unreadable" | "saved";
  hint: string | null;
  key?: string;
}

export function getClaudeKeyStatus(reveal = false) {
  return fetchJSON<ClaudeKeyStatus>(`/api/ai/claude-key${reveal ? "?reveal=1" : ""}`);
}

export type ClaudeKeyCheck = "ok" | "rejected" | "unreachable" | "error" | "missing";

/** Tests the typed key when given, otherwise the saved one. */
export function testClaudeKey(apiKey?: string) {
  return fetchJSON<{ result: ClaudeKeyCheck }>("/api/ai/claude-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apiKey ? { apiKey } : {}),
  });
}

export function saveAIConfig(config: {
  provider: "claude" | "ollama" | "none";
  apiKey?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
}) {
  return fetchJSON<{ success: boolean }>("/api/setup/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

export function getSettings() {
  return fetchJSON<AppSettings>("/api/settings");
}

export function updateSettings(settings: Partial<AppSettings>) {
  return fetchJSON<AppSettings>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

/** See the server-side TransactionKindFilter for what each value matches. */
export type TransactionKindFilter =
  | "expense"
  | "income"
  | "all"
  | "spending"
  | "counted_income"
  | "not_counted";
export type TransactionKind = "expense" | "income" | "transfer";
export type CategoryKindFilter = "expense" | "income";

export interface TransactionsSummary {
  income: {
    total: number;
    count: number;
    largest: TransactionWithCategory | null;
  };
  expense: {
    total: number;
    count: number;
    largest: TransactionWithCategory | null;
  };
  net: number;
  /** Outflows left out of `expense`: card bills, own-account transfers, excluded rows. */
  notCounted: { total: number; count: number };
  topMerchants: { description: string; total: number; count: number }[];
  pendingReviewCount: number;
  /** Rows with no category at all: what AI categorization works on. */
  uncategorizedCount: number;
}

export function getTransactionsSummary(params: {
  from: string;
  to: string;
  credentialIds?: number[];
  /** "12" for a whole login, "12:4321" for one card under it. */
  accounts?: string[];
}) {
  const sp = new URLSearchParams({ from: params.from, to: params.to });
  if (params.credentialIds?.length) {
    for (const id of params.credentialIds) {
      sp.append("credentialIds", String(id));
    }
  }
  for (const key of params.accounts ?? []) sp.append("accounts", key);
  return fetchJSON<TransactionsSummary>(`/api/transactions/summary?${sp}`);
}

export function getTransactions(params: {
  from?: string;
  to?: string;
  search?: string;
  category?: number;
  categoryIds?: number[];
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  kind?: TransactionKindFilter;
  provider?: string;
  credentialIds?: number[];
  /** "12" for a whole login, "12:4321" for one card under it. */
  accounts?: string[];
  /** Ask for segment counts, totals and per-day totals. */
  aggregates?: boolean;
  /** Only the review queue, any date. */
  review?: boolean;
}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === "aggregates" || key === "review") {
      if (value === true) searchParams.set(key, "1");
      return;
    }
    if (
      (key === "categoryIds" || key === "credentialIds" || key === "accounts") &&
      Array.isArray(value)
    ) {
      for (const id of value) searchParams.append(key, String(id));
      return;
    }
    searchParams.set(key, String(value));
  });
  return fetchJSON<{
    transactions: TransactionWithCategory[];
    total: number;
    aggregates?: TransactionListAggregates;
  }>(`/api/transactions?${searchParams}`);
}

export function setTransactionKind(id: number, kind: TransactionKind) {
  return fetchJSON<{ success: boolean }>(`/api/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
}

export function approveTransactionCategory(id: number) {
  return fetchJSON<{ success: boolean }>(`/api/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approve: true }),
  });
}

export function setTransactionExcluded(
  id: number,
  excluded: boolean,
  alwaysForMerchant = false,
) {
  return fetchJSON<{ success: boolean }>(`/api/transactions/${id}/exclude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ excluded, alwaysForMerchant }),
  });
}

/** Installment plan and every payment to the same merchant, for the history sheet. */
export function getTransactionHistory(id: number) {
  return fetchJSON<TransactionHistory>(`/api/transactions/${id}/history`);
}

export function getInsights() {
  return fetchJSON<InsightsPayload>("/api/insights");
}

export type InsightFeedbackAction = "dismissed" | "snoozed" | "not_recurring" | "not_unusual" | "clear";

export function sendInsightFeedback(key: string, action: InsightFeedbackAction, days?: number) {
  return fetchJSON<{ success: boolean }>("/api/insights/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, action, days }),
  });
}

/** Brings back every dismissed or snoozed insight. */
export function restoreHiddenInsights() {
  return fetchJSON<{ restored: number }>("/api/insights/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reset" }),
  });
}

/** Treats `alias` as the same merchant as `canonical`, or stops suggesting the pair. */
export function mergeMerchants(alias: string, canonical: string, dismiss = false) {
  return fetchJSON<{ success: boolean }>("/api/insights/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias, canonical, dismiss }),
  });
}

export interface RecurringTarget {
  key: string;
  merchantKey: string;
  direction: "out" | "in";
}

/** How often a recurring charge bills; "auto" goes back to detection. */
export function setRecurringCadence(target: RecurringTarget, cadence: RecurringCadence | "auto") {
  return fetchJSON<{ success: boolean }>("/api/insights/recurring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cadence", ...target, cadence }),
  });
}

/** Marks a recurring charge canceled (today) or active again. */
export function setRecurringCancelled(target: RecurringTarget, cancelled: boolean) {
  return fetchJSON<{ success: boolean }>("/api/insights/recurring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel", ...target, cancelled }),
  });
}

/** Tracks a transaction's merchant as a subscription billed at `cadence`. */
export function trackAsSubscription(transactionId: number, cadence: RecurringCadence) {
  return fetchJSON<{ success: boolean; key: string }>("/api/insights/recurring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "track", transactionId, cadence }),
  });
}

export function summarizeInsights(locale: string) {
  return fetchJSON<{ text: string; provider: "claude" | "ollama" }>("/api/insights/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
}

export interface FxStatus {
  latestDate: string | null;
  currencies: string[];
  estimatedCount: number;
}

export function getFxStatus() {
  return fetchJSON<FxStatus>("/api/fx-rates");
}

/** Adds newer Bank of Israel rates and refreshes estimated shekel amounts. */
export function updateFxRates() {
  return fetchJSON<{ added: number; changed: number; latestDate: string | null; status: FxStatus }>(
    "/api/fx-rates",
    { method: "POST" }
  );
}

export interface ExcludedMerchantRule {
  id: number;
  provider: string;
  merchantKey: string;
  createdAt: string;
}

export function listExcludedMerchants() {
  return fetchJSON<{ rules: ExcludedMerchantRule[] }>(
    `/api/excluded-merchants`,
  );
}

export function deleteExcludedMerchantRule(id: number) {
  return fetchJSON<{ success: boolean }>(`/api/excluded-merchants/${id}`, {
    method: "DELETE",
  });
}

export function getSpendingTrend(params: { from: string; to: string }) {
  const searchParams = new URLSearchParams({ from: params.from, to: params.to });
  return fetchJSON<SpendingTrend>(`/api/summary/trend?${searchParams}`);
}

export function getSummary(params: {
  from: string;
  to: string;
  months?: number;
}) {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
  });
  if (params.months) searchParams.set("months", String(params.months));
  return fetchJSON<DashboardSummary>(`/api/summary?${searchParams}`);
}

export function getHome() {
  return fetchJSON<HomePayload>(`/api/home`);
}

export function getActivity() {
  return fetchJSON<ActivitySnapshot>(`/api/activity`);
}

export function getCategories(kind?: CategoryKindFilter) {
  const qs = kind ? `?kind=${kind}` : "";
  return fetchJSON<Category[]>(`/api/categories${qs}`);
}

/**
 * Sets a transaction's category. With `applyToMerchant`, every other
 * transaction from the same merchant (same direction) gets it too.
 * `sameMerchantCount` says how many others still have a different one.
 */
export function updateTransactionCategory(id: number, categoryId: number, applyToMerchant = false) {
  return fetchJSON<{ success: boolean; applied: number; sameMerchantCount: number }>(`/api/transactions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoryId, applyToMerchant }),
  });
}

/**
 * Sets the user's name and/or note on a transaction (null clears it). With
 * `applyNameToMerchant`, the name goes on the merchant's other rows too;
 * otherwise `sameMerchantCount` says how many there are, to offer it.
 */
/** The cards under a card login, with whether each syncs and where it goes. */
export function listLoginCards(credentialId: number) {
  return fetchJSON<LoginCard[]>(`/api/integrations/${credentialId}/card-list`);
}

/** The quick card check: signs in and reads the card list. Rejects with the reason. */
export async function checkLoginCards(credentialId: number): Promise<LoginCard[]> {
  const res = await fetch(
    `/api/integrations/${credentialId}/card-list`,
    withWorkspaceHeader({ method: "POST" })
  );
  const body = (await res.json().catch(() => null)) as LoginCard[] | { message?: string } | null;
  if (!res.ok || !Array.isArray(body)) {
    throw new Error((body && !Array.isArray(body) && body.message) || "Couldn't read the card list.");
  }
  return body;
}

export function updateLoginCard(
  credentialId: number,
  change: { accountNumber: string; syncEnabled?: boolean; workspaceId?: number }
) {
  return fetchJSON<LoginCard[]>(`/api/integrations/${credentialId}/card-list`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
}

export function updateTransactionText(
  id: number,
  fields: { displayName?: string | null; note?: string | null },
  applyNameToMerchant = false
) {
  return fetchJSON<{ success: boolean; applied: number; sameMerchantCount: number }>(`/api/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, applyNameToMerchant }),
  });
}

export interface CategoryChildBreakdown {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  spent: number;
  budget: number;
  budgetMode: BudgetMode;
  isAutoBudget: boolean;
  percentSpent: number;
}

export interface CategoryDetail {
  category: {
    id: number;
    parentId: number | null;
    name: string;
    color: string;
    icon: string | null;
    kind: "expense" | "income";
    budgetMode: BudgetMode;
    isParent: boolean;
  };
  spent: number;
  budget: number;
  isAutoBudget: boolean;
  budgetSource: "own" | "rollup" | "leaf";
  vsTypical: { typical: number; percentDiff: number } | null;
  remaining: number;
  percentSpent: number;
  transactionCount: number;
  avgPerTransaction: number;
  vsLastMonth: number | null;
  prevSpent: number;
  prevPeriodLabel: string;
  dailySpend: Array<{ date: string; amount: number }>;
  topMerchants: Array<{ merchant: string; amount: number; count: number }>;
  transactions: TransactionWithCategory[];
  needsReviewTransactions: TransactionWithCategory[];
  needsReviewCount: number;
  period: { from: string; to: string };
  children: CategoryChildBreakdown[] | null;
}

export function getCategoryDetail(
  id: number,
  params: { from: string; to: string }
) {
  const sp = new URLSearchParams({ from: params.from, to: params.to });
  return fetchJSON<CategoryDetail>(`/api/categories/${id}/detail?${sp}`);
}

export function getBudgets() {
  return fetchJSON<Budget[]>("/api/budgets");
}

export function updateBudget(categoryId: number, amount: number | null) {
  return fetchJSON<{ success: boolean }>("/api/budgets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoryId, amount }),
  });
}

export function updateCategoryBudgetMode(
  categoryId: number,
  mode: BudgetMode
) {
  return fetchJSON<{ success: boolean }>(`/api/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetMode: mode }),
  });
}

export function updateCategoryCountsInSpending(
  categoryId: number,
  countsInSpending: boolean
) {
  return fetchJSON<{ success: boolean }>(`/api/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countsInSpending }),
  });
}

export function updateCategoryDescription(
  categoryId: number,
  description: string | null
) {
  return fetchJSON<{ success: boolean }>(`/api/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
}

export function setCategoryParent(
  categoryId: number,
  parentId: number | null
) {
  return fetchJSON<{ success: boolean }>(`/api/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId }),
  });
}

export function createCategory(input: {
  name: string;
  kind: CategoryKindFilter;
  isParent?: boolean;
  icon?: string;
  description?: string | null;
}) {
  return fetchJSON<Category>("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function setBudgetModesBulk(budgetedIds: number[]) {
  return fetchJSON<{ success: boolean }>("/api/categories/budget-modes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetedIds }),
  });
}

export function listIntegrations() {
  return fetchJSON<Integration[]>("/api/integrations");
}

/** Rows from a bank's exported file, mapped client-side, saved under one login. */
export function importTransactionsFile(credentialId: number, rows: ImportRow[]) {
  return fetchJSON<ImportResult>(`/api/integrations/${credentialId}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
}

export interface DeleteTransactionsResult {
  success: boolean;
  deleted: { txCount: number; syncCount: number; memoryCount: number };
}

export function deleteAllTransactions() {
  return fetchJSON<DeleteTransactionsResult>("/api/data/transactions", {
    method: "DELETE",
  });
}

export function deleteIntegration(credentialId: number) {
  return fetchJSON<{ success: boolean }>(`/api/integrations/${credentialId}`, {
    method: "DELETE",
  });
}

export interface CredentialMovePreview {
  transactionCount: number;
  duplicateCount: number;
  unmatchedCategories: string[];
  uncategorizedCount: number;
  removedLinkCount: number;
}

export function previewIntegrationMove(credentialId: number, workspaceId: number) {
  return fetchJSON<CredentialMovePreview>(
    `/api/integrations/${credentialId}/move?to=${workspaceId}`
  );
}

export function moveIntegration(credentialId: number, workspaceId: number) {
  return fetchJSON<CredentialMovePreview & { movedCount: number }>(
    `/api/integrations/${credentialId}/move`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    }
  );
}

export function previewCardMove(credentialId: number, accountNumber: string, workspaceId: number) {
  const query = new URLSearchParams({ account: accountNumber, to: String(workspaceId) });
  return fetchJSON<CredentialMovePreview>(
    `/api/integrations/${credentialId}/cards/move?${query.toString()}`
  );
}

export function moveCardToWorkspace(
  credentialId: number,
  accountNumber: string,
  workspaceId: number
) {
  return fetchJSON<CredentialMovePreview & { movedCount: number }>(
    `/api/integrations/${credentialId}/cards/move`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountNumber, workspaceId }),
    }
  );
}

/** Cards from other workspaces' logins that were moved into this workspace. */
export function listMovedInCards() {
  return fetchJSON<RoutedInCard[]>("/api/cards/moved-in");
}

export function getIntegrationCredentials(credentialId: number) {
  return fetchJSON<{
    credentials: Record<string, string> | null;
    label: string | null;
    provider: string | null;
    requiresManualTwoFactor: boolean;
    hasTwoFactorToken: boolean;
  }>(`/api/integrations/${credentialId}`);
}

export function deleteCategory(categoryId: number) {
  return fetchJSON<{
    success: boolean;
    deletedCategoryId: number;
    unassignedTransactionCount: number;
  }>(`/api/categories/${categoryId}`, {
    method: "DELETE",
  });
}

export interface CategorizeAssignment {
  transactionId: number;
  description: string;
  categoryName: string;
  isNew: boolean;
  kind: CategoryKindFilter;
}

export interface CategorizeProposal {
  name: string;
  kind: CategoryKindFilter;
  transactionIds: number[];
  samples: string[];
}

export interface CategorizePreview {
  uncategorizedCount: number;
  assignments: CategorizeAssignment[];
  proposedCategories: CategorizeProposal[];
  existingCategoryUsage: Record<string, number>;
  errors?: string[];
}

export function previewCategorize() {
  return fetchJSON<CategorizePreview>("/api/categorize/preview", {
    method: "POST",
  });
}

export function applyCategorize(payload: {
  assignments: Array<{
    transactionId: number;
    categoryName: string;
    isNew: boolean;
    kind?: CategoryKindFilter;
  }>;
  approvedNewCategoryNames: string[];
  rejectionFallbacks?: Record<string, string>;
}) {
  return fetchJSON<{
    appliedCount: number;
    createdCategoriesCount: number;
    skippedCount: number;
  }>("/api/categorize/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type SyncEventType =
  | "plan"
  | "provider-start"
  | "provider-done"
  | "provider-2fa-needed"
  | "provider-2fa-submitted"
  | "provider-2fa-manual"
  | "stage"
  | "complete"
  | "error";

export interface SyncProgressEvent {
  type: SyncEventType;
  data: Record<string, unknown>;
}

export function startSync(
  credentialId: number | undefined,
  onEvent: (event: SyncProgressEvent) => void,
  /** With a credential: read only these of its cards. */
  cards?: string[]
): { cancel: () => void } {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(
        "/api/sync",
        withWorkspaceHeader({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            credentialId != null ? { credentialId, ...(cards?.length ? { cards } : {}) } : {}
          ),
          signal: controller.signal,
        })
      );

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent({ type: currentEvent as SyncProgressEvent["type"], data });
            } catch {
              // skip malformed JSON
            }
            currentEvent = "";
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onEvent({
        type: "error",
        data: { message: "Connection to sync service lost" },
      });
    }
  })();

  return { cancel: () => controller.abort() };
}

// Placeholder for last sync info
export function getLastSync() {
  return fetchJSON<SyncRun | null>("/api/sync/last").catch(() => null);
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  speed?: number;
  etaSeconds?: number | null;
}

export interface PullEvent {
  type: "progress" | "complete" | "error";
  data: PullProgress & { message?: string };
}

export function listOllamaModels(url?: string) {
  const qs = url ? `?url=${encodeURIComponent(url)}` : "";
  return fetchJSON<{ models: string[]; error?: string }>(
    `/api/ai/ollama/models${qs}`
  );
}

export function pullOllamaModel(
  model: string,
  url: string | undefined,
  onEvent: (event: PullEvent) => void
): { cancel: () => void } {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(
        "/api/ai/ollama/pull",
        withWorkspaceHeader({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, url }),
          signal: controller.signal,
        })
      );

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent({ type: currentEvent as PullEvent["type"], data });
            } catch {
              // skip
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      onEvent({
        type: "error",
        data: { status: "error", message: "Connection to pull endpoint lost" },
      });
    }
  })();

  return { cancel: () => controller.abort() };
}

/** Like fetchJSON, but a failure carries the server's readable message. */
async function fetchWithMessage<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, withWorkspaceHeader(init));
  const body = (await res.json().catch(() => null)) as ({ message?: string } & T) | null;
  if (!res.ok) throw new Error(body?.message ?? "Request failed");
  return body as T;
}

const jsonInit = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

/** Open category suggestions in the active workspace. */
export function listCategoryRequests() {
  return fetchWithMessage<{ requests: CategoryRequest[] }>("/api/category-requests");
}

/** A viewer suggests a category; the owner approves or declines it. */
export function suggestCategory(transactionId: number, categoryId: number, note?: string) {
  return fetchWithMessage<{ request: CategoryRequest }>(
    "/api/category-requests",
    jsonInit("POST", { transactionId, categoryId, note })
  );
}

export function withdrawCategoryRequest(id: number) {
  return fetchWithMessage<{ removed: boolean }>("/api/category-requests", jsonInit("DELETE", { id }));
}

export function decideCategoryRequests(ids: number[], decision: "approve" | "decline") {
  return fetchWithMessage<{ decided: number }>("/api/category-requests/decide", jsonInit("POST", { ids, decision }));
}

export interface SharingState {
  available: boolean;
  inviteDays: number;
  viewers: ViewerInfo[];
  invites: ShareInviteInfo[];
}

export interface ViewerInfo {
  id: number;
  username: string;
  createdAt: string;
  workspaceIds: number[];
  lastSeenAt: string | null;
  activeSessions: number;
}

export interface ShareInviteInfo {
  id: number;
  label: string | null;
  workspaceIds: number[];
  createdAt: string;
  expiresAt: string;
}

export function getSharing() {
  return fetchWithMessage<SharingState>("/api/sharing");
}

export function createShareInvite(workspaceIds: number[], label: string) {
  return fetchWithMessage<{ invite: ShareInviteInfo; path: string }>(
    "/api/sharing/invites",
    jsonInit("POST", { workspaceIds, label })
  );
}

export function revokeShareInvite(id: number) {
  return fetchWithMessage<{ revoked: boolean }>("/api/sharing/invites", jsonInit("DELETE", { id }));
}

export function setViewerWorkspaces(viewerId: number, workspaceIds: number[]) {
  return fetchWithMessage<{ workspaceIds: number[] }>(
    `/api/sharing/viewers/${viewerId}`,
    jsonInit("PATCH", { workspaceIds })
  );
}

export function signOutViewer(viewerId: number) {
  return fetchWithMessage<{ ended: number }>(`/api/sharing/viewers/${viewerId}`, jsonInit("PATCH", { signOut: true }));
}

/** Throws AuthApiError, so a taken name gets its translated message. */
export async function renameViewer(viewerId: number, username: string) {
  const res = await fetch(`/api/sharing/viewers/${viewerId}`, withWorkspaceHeader(jsonInit("PATCH", { username })));
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string; username?: string } | null;
  if (!res.ok) throw new AuthApiError(body?.code, body?.message ?? "Request failed");
  return { username: body?.username ?? username };
}

export function removeViewer(viewerId: number) {
  return fetchWithMessage<{ removed: boolean }>(`/api/sharing/viewers/${viewerId}`, { method: "DELETE" });
}
