"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthApiError } from "@/lib/auth-api";
import { cn } from "@/lib/utils";

/** The translated message for an auth API error, falling back to the server's text. */
export function useAuthErrorMessage() {
  const t = useTranslations("auth.errors");
  return (err: unknown): string => {
    if (err instanceof AuthApiError && err.code && t.has(err.code)) return t(err.code);
    return err instanceof Error ? err.message : t("generic");
  };
}

/**
 * The 6-digit code box. With `allowRecovery` it can switch to a recovery
 * code, which is letters and a dash.
 */
export function CodeInput({
  id,
  value,
  onChange,
  recovery = false,
  autoFocus,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  recovery?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) =>
        onChange(recovery ? e.target.value.slice(0, 20) : e.target.value.replace(/\D/g, "").slice(0, 6))
      }
      inputMode={recovery ? "text" : "numeric"}
      autoComplete={recovery ? "off" : "one-time-code"}
      autoCapitalize="none"
      spellCheck={false}
      autoFocus={autoFocus}
      disabled={disabled}
      dir="ltr"
      placeholder={recovery ? "abcde-fghij" : "000000"}
      className={cn(
        "h-12 text-center font-mono text-xl",
        recovery ? "tracking-[0.12em]" : "tracking-[0.5em]"
      )}
    />
  );
}

export const codeReady = (code: string, recovery: boolean) =>
  recovery ? code.replace(/[^a-z0-9]/gi, "").length === 10 : /^\d{6}$/.test(code);

/** Recovery codes, shown once, with copy and download. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useTranslations("auth.recovery");
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (plain http on another device); the codes are still on screen.
    }
  };

  const download = () => {
    const blob = new Blob([`${t("fileHeader")}\n\n${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spent-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl border border-border bg-muted/40 px-5 py-4" dir="ltr">
        {codes.map((code) => (
          <li key={code} className="font-mono text-sm tracking-wider">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("copied") : t("copy")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={download}>
          <Download className="h-3.5 w-3.5" />
          {t("download")}
        </Button>
      </div>
    </div>
  );
}
