"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  LogOut,
  MessageSquareDashed,
  MoreHorizontal,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionShell, SettingCard } from "@/components/settings/section-shell";
import {
  createShareInvite,
  getSharing,
  listWorkspaces,
  removeViewer,
  revokeShareInvite,
  setViewerWorkspaces,
  signOutViewer,
  type ShareInviteInfo,
  type ViewerInfo,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useActiveWorkspaceId } from "@/lib/workspace-store";
import type { Workspace } from "@/lib/types";

/** SQLite's datetime('now') is UTC without a zone marker. */
const sqliteDate = (value: string) => new Date(value.replace(" ", "T") + "Z");

const SHARING_KEY = ["sharing"] as const;

export default function SharingSettingsPage() {
  const t = useTranslations("sharing.settings");
  const tCommon = useTranslations("common");
  const { data, isLoading } = useQuery({ queryKey: SHARING_KEY, queryFn: getSharing });
  const { data: workspaces = [] } = useQuery<Workspace[]>({ queryKey: ["workspaces"], queryFn: listWorkspaces });

  return (
    <SectionShell title={t("title")} description={t("description")}>
      {isLoading || !data ? (
        <SettingCard>
          <div className="text-sm text-muted-foreground">{tCommon("loading")}</div>
        </SettingCard>
      ) : !data.available ? (
        <SettingCard>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="font-medium">{t("needsSignInTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("needsSignInHint")}</p>
            </div>
            <Link
              href="/settings/security"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("needsSignInAction")}
            </Link>
          </div>
        </SettingCard>
      ) : (
        <>
          <InviteCard workspaces={workspaces} inviteDays={data.inviteDays} />
          <PeopleCard viewers={data.viewers} workspaces={workspaces} />
          {data.invites.length > 0 ? <OpenInvitesCard invites={data.invites} workspaces={workspaces} /> : null}
        </>
      )}
      <WhatTheySeeCard />
    </SectionShell>
  );
}

/** Pick workspaces and make a single-use link. */
function InviteCard({ workspaces, inviteDays }: { workspaces: Workspace[]; inviteDays: number }) {
  const t = useTranslations("sharing.settings");
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState<number[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Until the owner picks, the workspace they're looking at.
  const activeId = useActiveWorkspaceId();
  const fallback = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const chosen = picked ?? (fallback ? [fallback.id] : []);

  const create = useMutation({
    mutationFn: () => createShareInvite(chosen, label),
    onSuccess: (res) => {
      setLink(`${window.location.origin}${res.path}`);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: SHARING_KEY });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failed")),
  });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <SettingCard title={t("inviteTitle")} description={t("inviteHint")}>
      {link ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={link}
              dir="ltr"
              aria-label={t("linkLabel")}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button onClick={copy} className="shrink-0 gap-1.5">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t("copiedShort") : t("copy")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("linkNote", { days: inviteDays })}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLink(null);
              setLabel("");
              setPicked(null);
            }}
          >
            {t("another")}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen.length > 0) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-label" className="text-xs text-muted-foreground">
              {t("labelField")}
            </Label>
            <Input
              id="invite-label"
              value={label}
              maxLength={60}
              placeholder={t("labelPlaceholder")}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs text-muted-foreground">{t("workspacesField")}</legend>
            <WorkspaceToggles
              workspaces={workspaces}
              selected={chosen}
              onChange={(ids) => setPicked(ids)}
            />
          </fieldset>
          <Button type="submit" disabled={chosen.length === 0 || create.isPending} className="gap-1.5">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {t("createLink")}
          </Button>
        </form>
      )}
    </SettingCard>
  );
}

/** One chip per workspace, pressed when shared. */
function WorkspaceToggles({
  workspaces,
  selected,
  onChange,
  disabled = false,
}: {
  workspaces: Workspace[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {workspaces.map((w) => {
        const on = selected.includes(w.id);
        return (
          <button
            key={w.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? selected.filter((id) => id !== w.id) : [...selected, w.id])}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              on
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >
            {on ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
            <bdi className="max-w-[12rem] truncate">{w.name}</bdi>
          </button>
        );
      })}
    </div>
  );
}

function PeopleCard({ viewers, workspaces }: { viewers: ViewerInfo[]; workspaces: Workspace[] }) {
  const t = useTranslations("sharing.settings");
  return (
    <SettingCard title={t("peopleTitle")} description={viewers.length ? t("peopleHint") : undefined}>
      {viewers.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
          <UserPlus className="h-4 w-4 shrink-0" />
          {t("peopleEmpty")}
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {viewers.map((v) => (
            <PersonRow key={v.id} viewer={v} workspaces={workspaces} />
          ))}
        </ul>
      )}
    </SettingCard>
  );
}

function PersonRow({ viewer, workspaces }: { viewer: ViewerInfo; workspaces: Workspace[] }) {
  const t = useTranslations("sharing.settings");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: SHARING_KEY });

  const share = useMutation({
    mutationFn: (ids: number[]) => setViewerWorkspaces(viewer.id, ids),
    onSuccess: refresh,
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failed")),
  });
  const signOut = useMutation({
    mutationFn: () => signOutViewer(viewer.id),
    onSuccess: () => {
      toast.success(t("signedOutToast", { name: viewer.username }));
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failed")),
  });
  const remove = useMutation({
    mutationFn: () => removeViewer(viewer.id),
    onSuccess: () => {
      toast.success(t("removedToast", { name: viewer.username }));
      setConfirmRemove(false);
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failed")),
  });

  const lastSeen = viewer.lastSeenAt
    ? t("lastActive", { when: format.relativeTime(sqliteDate(viewer.lastSeenAt), new Date()) })
    : t("notSignedIn");
  const shownIds = share.isPending && share.variables ? share.variables : viewer.workspaceIds;

  return (
    <li className="flex flex-col gap-3 px-2 py-3.5 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
          {viewer.username.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="truncate font-medium">
              <bdi>{viewer.username}</bdi>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("joined", { date: format.dateTime(sqliteDate(viewer.createdAt), { dateStyle: "medium" }) })}
              {" · "}
              {lastSeen}
            </div>
          </div>
          {workspaces.length > 1 ? (
            <WorkspaceToggles
              workspaces={workspaces}
              selected={shownIds}
              disabled={share.isPending}
              onChange={(ids) => share.mutate(ids)}
            />
          ) : null}
          {shownIds.length === 0 ? <p className="text-xs text-destructive">{t("nothingShared")}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("personMenu", { name: viewer.username })}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={viewer.activeSessions === 0} onClick={() => signOut.mutate()}>
              <LogOut className="h-3.5 w-3.5" />
              {t("signOutEverywhere")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmRemove(true)}>
              <UserMinus className="h-3.5 w-3.5" />
              {t("stopSharing")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="font-serif text-xl font-normal">
            {t("removeTitle", { name: viewer.username })}
          </DialogTitle>
          <DialogDescription className="text-sm">{t("removeHint")}</DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()} className="gap-1.5">
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("stopSharing")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function OpenInvitesCard({ invites, workspaces }: { invites: ShareInviteInfo[]; workspaces: Workspace[] }) {
  const t = useTranslations("sharing.settings");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: number) => revokeShareInvite(id),
    onSuccess: () => {
      toast.success(t("revokedToast"));
      void queryClient.invalidateQueries({ queryKey: SHARING_KEY });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failed")),
  });
  const nameOf = (id: number) => workspaces.find((w) => w.id === id)?.name ?? `#${id}`;

  return (
    <SettingCard title={t("openTitle")} description={t("openHint")}>
      <ul className="-mx-2 divide-y divide-border">
        {invites.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                <bdi>{inv.label || t("unnamedInvite")}</bdi>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                <bdi>{inv.workspaceIds.map(nameOf).join(", ")}</bdi>
                {" · "}
                {t("expires", { date: format.dateTime(sqliteDate(inv.expiresAt), { dateStyle: "medium" }) })}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending && revoke.variables === inv.id}
              onClick={() => revoke.mutate(inv.id)}
            >
              {t("revoke")}
            </Button>
          </li>
        ))}
      </ul>
    </SettingCard>
  );
}

function WhatTheySeeCard() {
  const t = useTranslations("sharing.settings");
  const rows = [
    { Icon: Eye, text: t("canSee") },
    { Icon: MessageSquareDashed, text: t("canSuggest") },
    { Icon: EyeOff, text: t("cannot") },
  ];
  return (
    <SettingCard title={t("whatTitle")}>
      <ul className="space-y-2.5">
        {rows.map(({ Icon, text }) => (
          <li key={text} className="flex gap-2.5 text-sm text-muted-foreground">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground/60" />
            <span className="text-pretty">{text}</span>
          </li>
        ))}
      </ul>
    </SettingCard>
  );
}
