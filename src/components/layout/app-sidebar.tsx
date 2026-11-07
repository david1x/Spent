"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_ITEMS } from "./nav-items";
import { useReviewCount } from "./use-review-count";
import { WorkspaceSwitcher } from "./workspace-switcher";

// Active item reads as a raised card on the cream sidebar (per the redesign
// mock). In dark mode card and sidebar share a color, so fall back to accent.
const NAV_BUTTON_CLASS =
  "[&>svg]:text-muted-foreground data-active:bg-card data-active:shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.04)] data-active:hover:bg-card data-active:[&>svg]:text-primary dark:data-active:bg-sidebar-accent dark:data-active:hover:bg-sidebar-accent";

export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const reviewCount = useReviewCount();
  const { isMobile, setOpenMobile } = useSidebar();

  // The mobile drawer should close once the user picks a destination.
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 pb-1 pt-3">
        <Link
          href="/"
          onClick={closeOnMobile}
          className="-mx-1 flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors duration-200 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <img
            src="/logo_lightmode.svg"
            alt="Spent"
            className="h-7 w-auto shrink-0 dark:hidden"
          />
          <img
            src="/logo_darkmode.svg"
            alt="Spent"
            className="hidden h-7 w-auto shrink-0 dark:block"
          />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="font-serif text-[17px] font-semibold leading-tight tracking-tight">
              Spent
            </div>
            <div className="mt-px text-[10px] font-semibold leading-tight tracking-[0.08em] text-muted-foreground">
              {t("brandTagline")}
            </div>
          </div>
        </Link>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV_ITEMS.map((item) => {
                const label = t(item.labelKey);
                const badge =
                  item.showReviewBadge && reviewCount != null && reviewCount > 0
                    ? reviewCount
                    : null;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={
                        <Link
                          href={item.href}
                          onClick={closeOnMobile}
                          aria-current={item.match(pathname) ? "page" : undefined}
                          aria-label={
                            badge != null
                              ? t("withReviewCount", { label, count: badge })
                              : undefined
                          }
                        >
                          <item.Icon />
                          <span>{label}</span>
                        </Link>
                      }
                      isActive={item.match(pathname)}
                      tooltip={label}
                      className={NAV_BUTTON_CLASS}
                    />
                    {badge != null && (
                      <SidebarMenuBadge
                        aria-hidden
                        className="rounded-full bg-[color-mix(in_oklch,var(--status-heads-up)_22%,transparent)] px-1.5 text-[11px] font-semibold text-[color-mix(in_oklch,var(--status-heads-up)_45%,var(--foreground))]!"
                      >
                        {badge > 99 ? "99+" : badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <a
                  href="https://github.com/Shaya16/Spent"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Star />
                  <span>{t("starOnGitHub")}</span>
                </a>
              }
              tooltip={t("starOnGitHub")}
              className="text-muted-foreground hover:text-sidebar-accent-foreground"
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
