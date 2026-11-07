"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderBadge } from "@/components/setup/provider-badge";
import {
  BANK_PROVIDERS,
  type BankProviderInfo,
  type CardAccount,
  type Integration,
} from "@/lib/types";
import {
  deleteIntegration,
  getIntegrationCredentials,
  listCardAccounts,
  listIntegrations,
  listWorkspaces,
  moveIntegration,
  previewIntegrationMove,
  setCardPaidFrom,
  saveBankCredentials,
  testBankConnection,
  updateIntegrationSettings,
} from "@/lib/api";
import { TwoFactorSection } from "@/components/setup/two-factor-section";
import { Trash2, AlertTriangle, Loader2, FolderInput } from "lucide-react";
import { useActiveWorkspaceId } from "@/lib/workspace-store";
import { useSwitchWorkspace } from "@/components/layout/workspace-switcher";

export interface BankDetailSheetProps {
  open: boolean;
  mode: "edit" | "add";
  providerId: string | null;
  credentialId: number | null;
  connected?: Integration | null;
  onClose: () => void;
}

export function BankDetailSheet({
  open,
  mode,
  providerId,
  credentialId,
  connected,
  onClose,
}: BankDetailSheetProps) {
  const info = providerId
    ? BANK_PROVIDERS.find((b) => b.id === providerId) ?? null
    : null;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full p-0 sm:max-w-md! md:max-w-lg!"
      >
        {info ? (
          <SheetBody
            info={info}
            mode={mode}
            credentialId={credentialId}
            connected={connected ?? null}
            onClose={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  info,
  mode,
  credentialId,
  connected,
  onClose,
}: {
  info: BankProviderInfo;
  mode: "edit" | "add";
  credentialId: number | null;
  connected: Integration | null;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SheetHeader className="gap-3 border-b border-border/40 p-6">
        <div className="flex items-center gap-3">
          <ProviderBadge
            color={info.color}
            name={info.name}
            domain={info.domain}
            size={40}
            radius={10}
          />
          <div className="min-w-0 flex-1">
            <SheetTitle>{connected?.label ?? info.name}</SheetTitle>
            <SheetDescription className="mt-0.5">
              {mode === "add"
                ? "Connect this bank to sync transactions."
                : connected
                  ? `${info.name} · ${connected.transactionCount} transactions`
                  : info.blurb}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 p-6">
        <CredentialsForm
          key={`${info.id}-${credentialId ?? "new"}`}
          info={info}
          isEdit={mode === "edit"}
          credentialId={credentialId}
          initialLabel={connected?.label ?? ""}
          onSaved={onClose}
        />
        {mode === "edit" && connected && info.kind === "card" ? (
          <CardsSection login={connected} />
        ) : null}
        {mode === "edit" && connected ? (
          <RecentSyncCard
            lastSyncAt={connected.lastSyncAt}
            transactionCount={connected.transactionCount}
          />
        ) : null}
      </div>

      {mode === "edit" && connected ? (
        <div className="space-y-4 border-t border-border/40 p-6">
          <MoveSection credentialId={connected.id} onMoved={onClose} />
          <DangerZone credentialId={connected.id} onRemoved={onClose} />
        </div>
      ) : null}
    </div>
  );
}

function CredentialsForm({
  info,
  isEdit,
  credentialId,
  initialLabel,
  onSaved,
}: {
  info: BankProviderInfo;
  isEdit: boolean;
  credentialId: number | null;
  initialLabel: string;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(initialLabel);
  const [savedCredentialId, setSavedCredentialId] = useState<number | null>(
    credentialId
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(!isEdit);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requiresManualTwoFactor, setRequiresManualTwoFactor] = useState(false);
  const [hasTwoFactorToken, setHasTwoFactorToken] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    setSavedCredentialId(credentialId);
  }, [credentialId]);

  useEffect(() => {
    if (!isEdit || credentialId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getIntegrationCredentials(credentialId);
        if (cancelled) return;
        if (res.credentials) setCredentials(res.credentials);
        if (res.label) setLabel(res.label);
        setRequiresManualTwoFactor(res.requiresManualTwoFactor);
        setHasTwoFactorToken(res.hasTwoFactorToken);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, credentialId]);

  const allValid =
    label.trim().length > 0 &&
    info.credentialFields.every((f) => {
      const v = credentials[f.key]?.trim() ?? "";
      if (!v) return false;
      if (f.exactLength != null && v.length !== f.exactLength) return false;
      return true;
    });

  const saveOptions = (id: number | null) => ({
    label: label.trim(),
    ...(id != null ? { credentialId: id } : {}),
    requiresManualTwoFactor,
  });

  const parseApiError = (err: unknown, fallback: string): string => {
    if (!(err instanceof Error)) return fallback;
    try {
      const body = JSON.parse(err.message) as { message?: string };
      if (body.message) return body.message;
    } catch {
      /* plain text */
    }
    return err.message || fallback;
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const existingId = savedCredentialId;
      let testId = existingId;
      if (existingId != null) {
        const saved = await saveBankCredentials(
          info.id,
          credentials,
          saveOptions(existingId)
        );
        testId = saved.credentialId;
        setSavedCredentialId(testId);
      }
      const res = await testBankConnection(info.id, {
        ...(testId != null ? { credentialId: testId } : { credentials }),
      });
      setResult(res);
    } catch (err) {
      setResult({
        success: false,
        message: parseApiError(err, "Connection test failed."),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveBankCredentials(
        info.id,
        credentials,
        saveOptions(savedCredentialId)
      );
      setSavedCredentialId(saved.credentialId);
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["setupStatus"] });
      toast.success(`${info.name} credentials saved`);
      onSaved();
    } catch (err) {
      setResult({
        success: false,
        message: parseApiError(err, "Failed to save credentials."),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToken = async () => {
    if (savedCredentialId == null) return;
    setResetPending(true);
    try {
      await updateIntegrationSettings(savedCredentialId, {
        resetTwoFactorToken: true,
      });
      setHasTwoFactorToken(false);
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success(
        `Saved 2FA token cleared. Your next ${info.name} sync will ask for a fresh code.`
      );
    } catch {
      toast.error("Could not reset the 2FA token.");
    } finally {
      setResetPending(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading current values…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${info.id}-label`}>Account label</Label>
        <Input
          id={`${info.id}-label`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`e.g. Personal card, ${info.name} (2)`}
        />
        <p className="text-xs text-muted-foreground">
          Shown in your bank list. Use a distinct label when you connect the same
          bank more than once.
        </p>
      </div>

      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Credentials
      </div>
      {info.credentialFields.map((field) => {
        const value = credentials[field.key] ?? "";
        const tooShort =
          field.exactLength != null &&
          value.length > 0 &&
          value.length !== field.exactLength;
        const placeholder = field.placeholder ?? field.label;
        const hint = field.hint;
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`${info.id}-${field.key}`}>{field.label}</Label>
            <Input
              id={`${info.id}-${field.key}`}
              type={field.type}
              inputMode={field.numeric ? "numeric" : undefined}
              pattern={field.numeric ? "[0-9]*" : undefined}
              maxLength={field.maxLength ?? field.exactLength ?? undefined}
              value={value}
              onChange={(e) => {
                let next = e.target.value;
                if (field.numeric) next = next.replace(/\D/g, "");
                if (field.exactLength) next = next.slice(0, field.exactLength);
                if (field.maxLength) next = next.slice(0, field.maxLength);
                setCredentials((prev) => ({ ...prev, [field.key]: next }));
              }}
              placeholder={placeholder}
              aria-invalid={tooShort || undefined}
            />
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            {tooShort && (
              <p className="text-xs text-destructive">
                Must be exactly {field.exactLength} digits.
              </p>
            )}
          </div>
        );
      })}

      <TwoFactorSection
        info={info}
        requiresManualTwoFactor={requiresManualTwoFactor}
        hasTwoFactorToken={hasTwoFactorToken}
        onChangeManualFlag={setRequiresManualTwoFactor}
        onResetToken={handleResetToken}
        resetPending={resetPending}
        showResetButton={savedCredentialId != null}
      />

      {result && (
        <div
          className={`rounded-md p-3 text-sm ${
            result.success
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={!allValid || testing || saving}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button onClick={handleSave} disabled={!allValid || saving || testing}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

const NOT_LINKED = "__none__";

/**
 * Each card is settled by one monthly debit on a bank account. Linking a card
 * to that account lets Spent find the debit and leave it out of spending,
 * since the card's own purchases are already counted. One card login can hold
 * several cards, each billed to a different bank, so links are per card.
 */
function CardsSection({ login }: { login: Integration }) {
  const { data: integrations } = useQuery({
    queryKey: ["integrations"],
    queryFn: listIntegrations,
  });
  const { data: cards, isLoading } = useQuery({
    queryKey: ["integrations", login.id, "cards"],
    queryFn: () => listCardAccounts(login.id),
  });
  const banks = (integrations ?? []).filter(
    (i) => BANK_PROVIDERS.find((p) => p.id === i.provider)?.kind === "bank"
  );
  const bankName = (id: number | null) => {
    const bank = banks.find((b) => b.id === id);
    if (!bank) return null;
    const name = BANK_PROVIDERS.find((p) => p.id === bank.provider)?.name ?? bank.provider;
    return bank.label && bank.label !== name ? `${bank.label} · ${name}` : name;
  };

  return (
    <section>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Cards and who pays them
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        Each card&apos;s monthly bill also shows up on a bank account. Pick that account so
        Spent counts the purchases once, not twice.
      </p>
      <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">Loading cards…</div>
        ) : !cards || cards.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            Cards appear here after the first sync.
          </div>
        ) : banks.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            Connect the bank account that pays these cards to link them.
          </div>
        ) : (
          cards.map((card) => (
            <CardRow
              key={card.accountNumber}
              loginId={login.id}
              card={card}
              banks={banks}
              bankName={bankName}
            />
          ))
        )}
      </div>
    </section>
  );
}

function CardRow({
  loginId,
  card,
  banks,
  bankName,
}: {
  loginId: number;
  card: CardAccount;
  banks: Integration[];
  bankName: (id: number | null) => string | null;
}) {
  const queryClient = useQueryClient();
  const last4 = card.accountNumber.slice(-4);
  const mutation = useMutation({
    mutationFn: (bankId: number | null) => setCardPaidFrom(loginId, card.accountNumber, bankId),
    onSuccess: (result, bankId) => {
      // Every total depends on which debits count as card bills.
      queryClient.invalidateQueries();
      if (bankId === null) {
        toast.success(`Card ••${last4} unlinked. Its bills count as spending again.`);
        return;
      }
      const matched = result.card?.matchedBills ?? 0;
      const cycles = result.card?.billingCycles ?? 0;
      if (matched > 0) {
        toast.success(`Card ••${last4}: matched ${matched} of ${cycles} bills on ${bankName(bankId)}.`);
      } else {
        toast.message(
          `Card ••${last4} linked. No debit on that account matches its bill totals yet.`
        );
      }
    },
    onError: () => toast.error("Couldn't update the link."),
  });

  const status = card.paidFromCredentialId
    ? card.matchedBills > 0
      ? `${card.matchedBills} of ${card.billingCycles} bills matched and left out of spending`
      : "No matching debit found yet. Bills are matched to the shekel after each sync."
    : card.suggestion
      ? null
      : "Not linked. Its bills on a bank account count as spending.";

  return (
    <div className="space-y-2.5 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            Card <span className="font-mono text-[13px]">••{last4}</span>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {card.purchaseCount} {card.purchaseCount === 1 ? "purchase" : "purchases"} · last used{" "}
            {new Date(card.lastPurchaseAt).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </div>
        </div>
      </div>
      <Select
        value={card.paidFromCredentialId != null ? String(card.paidFromCredentialId) : NOT_LINKED}
        onValueChange={(v) => {
          if (!v) return;
          mutation.mutate(v === NOT_LINKED ? null : Number(v));
        }}
        disabled={mutation.isPending}
      >
        <SelectTrigger className="w-full" aria-label={`Bank account that pays card ${last4}`}>
          <SelectValue>
            {(value: string) =>
              value === NOT_LINKED ? "Not linked" : bankName(Number(value)) ?? "Not linked"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NOT_LINKED}>Not linked</SelectItem>
          {banks.map((b) => (
            <SelectItem key={b.id} value={String(b.id)}>
              {bankName(b.id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {card.suggestion && card.paidFromCredentialId == null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Looks like <span className="font-medium text-foreground">{bankName(card.suggestion.bankCredentialId)}</span>{" "}
            pays this card: {card.suggestion.matchingBills} of {card.billingCycles} bills match.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(card.suggestion!.bankCredentialId)}
          >
            Link it
          </Button>
        </div>
      ) : null}
      {status ? <p className="text-[11px] text-muted-foreground">{status}</p> : null}
    </div>
  );
}

function RecentSyncCard({
  lastSyncAt,
  transactionCount,
}: {
  lastSyncAt: string | null;
  transactionCount: number;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Recent sync
      </div>
      <div className="mt-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
        <div className="font-medium">
          {transactionCount} transaction{transactionCount === 1 ? "" : "s"}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {lastSyncAt
            ? `Last synced ${formatRelative(lastSyncAt)}`
            : "Never synced"}
        </div>
      </div>
    </div>
  );
}

/** Pulls the API's { error } message out of a failed fetchJSON call. */
function apiErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return raw || "Something went wrong.";
}

/** "A", "A or B", "A, B or C", "A, B, C or 2 more". */
function orList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} or ${names.length - 3} more`;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function MoveSection({
  credentialId,
  onMoved,
}: {
  credentialId: number;
  onMoved: () => void;
}) {
  const queryClient = useQueryClient();
  const activeId = useActiveWorkspaceId();
  const switchWorkspace = useSwitchWorkspace();
  const [targetId, setTargetId] = useState<number | null>(null);

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
    staleTime: 60_000,
  });
  const currentId = activeId ?? workspaces[0]?.id ?? null;
  const others = workspaces.filter((w) => w.id !== currentId);
  const target = others.find((w) => w.id === targetId) ?? null;

  const preview = useQuery({
    queryKey: ["integrationMovePreview", credentialId, targetId],
    queryFn: () => previewIntegrationMove(credentialId, targetId as number),
    enabled: target !== null,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () => moveIntegration(credentialId, targetId as number),
    onSuccess: (result) => {
      const name = target?.name ?? "the other workspace";
      const destination = targetId as number;
      void queryClient.invalidateQueries();
      toast.success(`Moved to ${name}`, {
        description: `${result.movedCount.toLocaleString()} transactions moved with it.`,
        action: { label: `Open ${name}`, onClick: () => switchWorkspace(destination) },
      });
      onMoved();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (others.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 p-4">
        <div className="flex items-start gap-3">
          <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Move to another workspace</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You only have one workspace. Create another from the workspace
              switcher in the sidebar to move this bank there.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const p = preview.data;
  return (
    <div className="rounded-xl border border-border/60 p-4">
      <div className="flex items-start gap-3">
        <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="text-sm font-medium">Move to another workspace</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Connected it to the wrong workspace? Move the login together
              with its transactions and sync history.
            </p>
          </div>
          <Select
            value={targetId != null ? String(targetId) : ""}
            onValueChange={(v) => setTargetId(v ? Number(v) : null)}
          >
            <SelectTrigger className="w-full" aria-label="Workspace to move to">
              <SelectValue placeholder="Choose a workspace">
                {target?.name ?? "Choose a workspace"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {others.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {target && preview.isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Checking what moves…
            </div>
          ) : null}
          {target && preview.isError ? (
            <p className="text-xs text-destructive">{apiErrorMessage(preview.error)}</p>
          ) : null}
          {target && p ? (
            <>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground tabular-nums">
                    {(p.transactionCount - p.duplicateCount).toLocaleString()}
                  </span>{" "}
                  transactions move to {target.name}.
                </li>
                {p.duplicateCount > 0 ? (
                  <li>
                    <span className="tabular-nums">{p.duplicateCount.toLocaleString()}</span>{" "}
                    are already in {target.name} and won&apos;t be copied twice.
                  </li>
                ) : null}
                {p.uncategorizedCount > 0 ? (
                  <li>
                    <span className="tabular-nums">{p.uncategorizedCount.toLocaleString()}</span>{" "}
                    will be uncategorized because {target.name} has no{" "}
                    {orList(p.unmatchedCategories)}{" "}
                    {p.unmatchedCategories.length === 1 ? "category" : "categories"}.
                    Run Categorize there afterwards.
                  </li>
                ) : (
                  <li>Categories carry over by name.</li>
                )}
                {p.removedLinkCount > 0 ? (
                  <li>
                    <span className="tabular-nums">{p.removedLinkCount}</span> card payment{" "}
                    {p.removedLinkCount === 1 ? "link" : "links"} to banks in this
                    workspace will be removed. You can link them again there.
                  </li>
                ) : null}
              </ul>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTargetId(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <FolderInput className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {mutation.isPending ? "Moving…" : `Move to ${target.name}`}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DangerZone({
  credentialId,
  onRemoved,
}: {
  credentialId: number;
  onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => deleteIntegration(credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["setupStatus"] });
      toast.success("Bank disconnected");
      onRemoved();
    },
  });

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Disconnect this bank</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Removes credentials. Existing transactions stay.
          </p>
          {!confirming ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Disconnect
            </Button>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Disconnecting…" : "Confirm disconnect"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso.replace(" ", "T") + "Z");
  const diffSec = (Date.now() - then.getTime()) / 1000;
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
