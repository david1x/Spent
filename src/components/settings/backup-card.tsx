"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Matches MIN_PASSWORD_LENGTH in src/server/lib/backup.ts. */
const MIN_PASSWORD = 8;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}

/** Settings, Data & privacy: download everything as one password-protected file, or restore one. */
export function BackupCard() {
  const t = useTranslations("backup");
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h3 className="text-base font-semibold">{t("title")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <ExportBackup />
        <RestoreBackup />
      </div>
    </section>
  );
}

function ExportBackup() {
  const t = useTranslations("backup");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_PASSWORD && confirm === password;

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/backup/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, t("exportFailed")));
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "spent-backup.spentbackup";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setPassword("");
      setConfirm("");
      toast.success(t("exportDone"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("exportFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">{t("exportTitle")}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("exportHint")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="backup-password" className="text-xs text-muted-foreground">{t("password")}</Label>
        <Input
          id="backup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          aria-invalid={tooShort}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tooShort ? <p className="text-[11px] text-destructive">{t("tooShort", { min: MIN_PASSWORD })}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="backup-confirm" className="text-xs text-muted-foreground">{t("confirm")}</Label>
        <Input
          id="backup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          aria-invalid={mismatch}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch ? <p className="text-[11px] text-destructive">{t("mismatch")}</p> : null}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("passwordWarning")}</p>
      <Button onClick={download} disabled={!ready || busy} className="gap-1.5">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {busy ? t("exporting") : t("exportButton")}
      </Button>
    </div>
  );
}

/** Also offered by the setup wizard, so a fresh install can start from a backup. */
export function RestoreBackup({ heading = true }: { heading?: boolean }) {
  const t = useTranslations("backup");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("password", password);
      const res = await fetch("/api/backup/restore", { method: "POST", body: form });
      if (!res.ok) throw new Error(await errorMessage(res, t("restoreFailed")));
      toast.success(t("restoreDone"));
      // Everything changed underneath the app; start over from Home.
      setTimeout(() => window.location.assign("/"), 900);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("restoreFailed"));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {heading ? (
        <div>
          <div className="text-sm font-medium">{t("restoreTitle")}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("restoreHint")}</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="restore-file" className="text-xs text-muted-foreground">{t("file")}</Label>
        <Input
          id="restore-file"
          type="file"
          accept=".spentbackup,application/octet-stream"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="restore-password" className="text-xs text-muted-foreground">{t("password")}</Label>
        <Input
          id="restore-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        <span>{t("replaceWarning")}</span>
      </label>
      <Button
        variant="outline"
        onClick={restore}
        disabled={!file || password.length < MIN_PASSWORD || !understood || busy}
        className="gap-1.5"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? t("restoring") : t("restoreButton")}
      </Button>
    </div>
  );
}
