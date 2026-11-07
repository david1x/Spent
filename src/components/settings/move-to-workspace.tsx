"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderInput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listWorkspaces, type CredentialMovePreview } from "@/lib/api";
import { useSwitchWorkspace } from "@/components/layout/workspace-switcher";
import { cn } from "@/lib/utils";

/** Pulls the API's { error } message out of a failed fetchJSON call. */
export function apiErrorMessage(error: unknown): string {
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

export interface MoveToWorkspaceProps {
  /** Distinguishes the preview cache of different things being moved. */
  subjectKey: string;
  /** What is moving, as it reads in a sentence: "this bank", "card ••1234". */
  subject: string;
  /** The workspace the thing is in now; not offered as a target. */
  currentWorkspaceId: number | null;
  /** Preselected target, e.g. a card's own login workspace when bringing it back. */
  defaultTargetId?: number | null;
  preview: (workspaceId: number) => Promise<CredentialMovePreview>;
  move: (workspaceId: number) => Promise<CredentialMovePreview & { movedCount: number }>;
  onMoved?: () => void;
  onCancel?: () => void;
  /** Lists what goes along with a whole login; cards skip it. */
  carriesSyncHistory?: boolean;
  className?: string;
}

/**
 * Pick a workspace, see what moving there changes, then confirm. Used for a
 * whole bank login and for a single card.
 */
export function MoveToWorkspace({
  subjectKey,
  subject,
  currentWorkspaceId,
  defaultTargetId = null,
  preview,
  move,
  onMoved,
  onCancel,
  carriesSyncHistory = false,
  className,
}: MoveToWorkspaceProps) {
  const queryClient = useQueryClient();
  const switchWorkspace = useSwitchWorkspace();
  const [targetId, setTargetId] = useState<number | null>(defaultTargetId);

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
    staleTime: 60_000,
  });
  const others = workspaces.filter((w) => w.id !== currentWorkspaceId);
  const target = others.find((w) => w.id === targetId) ?? null;

  const previewQuery = useQuery({
    queryKey: ["workspaceMovePreview", subjectKey, targetId],
    queryFn: () => preview(targetId as number),
    enabled: target !== null,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () => move(targetId as number),
    onSuccess: (result) => {
      const name = target?.name ?? "the other workspace";
      const destination = targetId as number;
      void queryClient.invalidateQueries();
      toast.success(`Moved ${subject} to ${name}`, {
        description: `${result.movedCount.toLocaleString()} transactions moved with it.`,
        action: { label: `Open ${name}`, onClick: () => switchWorkspace(destination) },
      });
      onMoved?.();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (others.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        You only have one workspace. Create another from the workspace switcher
        in the sidebar first.
      </p>
    );
  }

  const p = previewQuery.data;
  const cancel = () => {
    setTargetId(null);
    onCancel?.();
  };

  return (
    <div className={cn("space-y-3", className)}>
      <Select
        value={targetId != null ? String(targetId) : ""}
        onValueChange={(v) => setTargetId(v ? Number(v) : null)}
      >
        <SelectTrigger className="w-full" aria-label={`Workspace to move ${subject} to`}>
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

      {target && previewQuery.isPending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking what moves…
        </div>
      ) : null}
      {target && previewQuery.isError ? (
        <p className="text-xs text-destructive">{apiErrorMessage(previewQuery.error)}</p>
      ) : null}
      {target && p ? (
        <>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground tabular-nums">
                {(p.transactionCount - p.duplicateCount).toLocaleString()}
              </span>{" "}
              transactions move to {target.name}
              {carriesSyncHistory ? ", with the sync history." : "."}
            </li>
            {!carriesSyncHistory ? (
              <li>Future syncs keep sending this card&apos;s purchases there.</li>
            ) : null}
            {p.duplicateCount > 0 ? (
              <li>
                <span className="tabular-nums">{p.duplicateCount.toLocaleString()}</span> are
                already in {target.name} and won&apos;t be copied twice.
              </li>
            ) : null}
            {p.uncategorizedCount > 0 ? (
              <li>
                <span className="tabular-nums">{p.uncategorizedCount.toLocaleString()}</span> will
                be uncategorized because {target.name} has no {orList(p.unmatchedCategories)}{" "}
                {p.unmatchedCategories.length === 1 ? "category" : "categories"}. Run Categorize
                there afterwards.
              </li>
            ) : (
              <li>Categories carry over by name.</li>
            )}
            {p.removedLinkCount > 0 ? (
              <li>
                <span className="tabular-nums">{p.removedLinkCount}</span> card payment{" "}
                {p.removedLinkCount === 1 ? "link" : "links"} will be removed. You can link{" "}
                {p.removedLinkCount === 1 ? "it" : "them"} again in {target.name}.
              </li>
            ) : null}
          </ul>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={cancel}>
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
      ) : onCancel && !target ? (
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
