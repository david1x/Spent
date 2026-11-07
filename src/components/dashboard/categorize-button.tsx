"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { previewCategorize } from "@/lib/api";
import { toast } from "sonner";
import { CategorizeReviewDialog } from "./categorize-review-dialog";
import type { CategorizePreview } from "@/lib/api";

interface CategorizeButtonProps {
  onApplied?: () => void;
  variant?: "outline" | "ghost";
  /** Collapse to an icon button below the `sm` breakpoint. */
  compactOnMobile?: boolean;
  className?: string;
}

export function CategorizeButton({
  onApplied,
  variant = "outline",
  compactOnMobile = false,
  className,
}: CategorizeButtonProps) {
  const t = useTranslations("dashboard");
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<CategorizePreview | null>(null);

  const mutation = useMutation({
    mutationFn: previewCategorize,
    onSuccess: (data) => {
      if (data.uncategorizedCount === 0) {
        toast.info(t("nothingToCategorize"));
        return;
      }
      setPreview(data);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("categorizationFailed"), {
        duration: Infinity,
        closeButton: true,
      });
    },
  });

  const label = mutation.isPending ? t("thinking") : t("categorize");

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        aria-label={compactOnMobile ? t("categorize") : undefined}
        className={cn(
          "gap-1.5",
          variant === "ghost" && "text-muted-foreground hover:text-foreground",
          compactOnMobile && "size-8 px-0 sm:size-auto sm:h-8 sm:px-3",
          className
        )}
      >
        {mutation.isPending ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <Tags aria-hidden className="size-3.5" />
        )}
        <span className={cn(compactOnMobile && "hidden sm:inline")}>{label}</span>
      </Button>

      {preview && (
        <CategorizeReviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onApplied={() => {
            setPreview(null);
            queryClient.invalidateQueries({ queryKey: ["summary"] });
            queryClient.invalidateQueries({ queryKey: ["transactions"] });
            queryClient.invalidateQueries({ queryKey: ["categories"] });
            onApplied?.();
          }}
        />
      )}
    </>
  );
}
