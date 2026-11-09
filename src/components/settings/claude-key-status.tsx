"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Check, CircleAlert, CircleCheck, Copy, Eye, EyeOff, Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClaudeKeyStatus, testClaudeKey, type ClaudeKeyCheck } from "@/lib/api";

export const CLAUDE_KEY_QUERY = ["claude-key"] as const;

const TONE = {
  good: "text-[color-mix(in_oklch,var(--status-on-track)_75%,var(--foreground))]",
  warn: "text-[color-mix(in_oklch,var(--status-heads-up)_70%,var(--foreground))]",
  bad: "text-[color-mix(in_oklch,var(--status-over)_80%,var(--foreground))]",
} as const;

const CHECK_TONE: Record<ClaudeKeyCheck, keyof typeof TONE> = {
  ok: "good",
  rejected: "bad",
  unreachable: "warn",
  error: "warn",
  missing: "warn",
};

/**
 * Whether a Claude key is saved, its masked form, and Show / Copy / Test.
 * Test checks what's typed in the field when there is something, else the
 * saved key.
 */
export function ClaudeKeyStatus({ typedKey }: { typedKey: string }) {
  const t = useTranslations("settings.ai.key");
  const { data: status, isPending } = useQuery({
    queryKey: CLAUDE_KEY_QUERY,
    queryFn: () => getClaudeKeyStatus(),
  });
  // The full key lives only in this component's state, never in the query cache.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reveal = useMutation({
    mutationFn: () => getClaudeKeyStatus(true),
    onSuccess: (s) => setRevealed(s.key ?? null),
  });
  const test = useMutation({ mutationFn: (key: string) => testClaudeKey(key || undefined) });

  if (isPending || !status) {
    return <div className="h-[4.25rem] animate-pulse rounded-lg bg-muted/60" aria-hidden />;
  }

  const saved = status.state === "saved";
  const shown = revealed ?? status.hint;
  const copy = async () => {
    const key = revealed ?? (await getClaudeKeyStatus(true)).key;
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (plain http on another device). Show it instead so it can be copied by hand.
      setRevealed(key);
    }
  };
  const canTest = saved || typedKey.trim().length > 0;
  // A result belongs to the key it tested; typing something else clears it.
  const current = test.variables === typedKey.trim();
  const result = current ? test.data?.result : undefined;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-[min(100%,16rem)] flex-1 items-center gap-2">
          {saved ? (
            <CircleCheck className={`size-4 shrink-0 ${TONE.good}`} />
          ) : (
            <CircleAlert className={`size-4 shrink-0 ${status.state === "missing" ? TONE.warn : TONE.bad}`} />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium">{t(status.state)}</div>
            {saved && shown ? (
              <code dir="ltr" className="block break-all font-mono text-xs text-muted-foreground">
                {shown}
              </code>
            ) : (
              <div className="text-xs text-muted-foreground">{t(`${status.state}Hint`)}</div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {saved && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={reveal.isPending}
                onClick={() => (revealed ? setRevealed(null) : reveal.mutate())}
              >
                {reveal.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : revealed ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
                {revealed ? t("hide") : t("show")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void copy()}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t("copied") : t("copy")}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!canTest || test.isPending}
            onClick={() => test.mutate(typedKey.trim())}
          >
            {test.isPending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            {typedKey.trim() ? t("testTyped") : t("test")}
          </Button>
        </div>
      </div>
      {result && !test.isPending && (
        <p role="status" className={`flex items-center gap-1.5 text-xs ${TONE[CHECK_TONE[result]]}`}>
          {result === "ok" ? <CircleCheck className="size-3.5" /> : <CircleAlert className="size-3.5" />}
          {t(`result.${result}`)}
        </p>
      )}
      {current && test.isError && !test.isPending && (
        <p role="status" className={`flex items-center gap-1.5 text-xs ${TONE.warn}`}>
          <CircleAlert className="size-3.5" />
          {t("result.error")}
        </p>
      )}
    </div>
  );
}
