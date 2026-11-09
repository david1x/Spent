"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronsUpDown, Loader2, LockKeyhole, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAccess } from "@/components/access-provider";
import { signOut } from "@/lib/auth-api";

/**
 * Who's signed in, with Sign out, at the foot of the sidebar. Only when
 * sign-in is on: with it off there's no account and nothing to sign out of.
 */
export function AccountMenu() {
  const t = useTranslations("nav");
  const router = useRouter();
  const { signInOn, username, readOnly } = useAccess();
  const { isMobile, setOpenMobile } = useSidebar();
  const [signingOut, setSigningOut] = useState(false);
  if (!signInOn || !username) return null;

  const initial = username.trim().charAt(0).toUpperCase() || "?";
  const leave = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // A full load, so nothing from this session stays on screen.
      window.location.assign("/login");
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={t("signedInAs", { name: username })}
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {initial}
            </div>
            <div className="flex min-w-0 flex-1 flex-col text-start group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">
                <bdi>{username}</bdi>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {readOnly ? t("viewOnlyAccount") : t("ownerAccount")}
              </span>
            </div>
            <ChevronsUpDown className="ms-auto size-4 shrink-0 opacity-60 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-[14rem]">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal text-muted-foreground">
                {t("signedInAs", { name: username })}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                router.push("/settings/security");
              }}
            >
              <LockKeyhole className="size-4" />
              {t("accountSecurity")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={signingOut} onClick={() => void leave()}>
              {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
