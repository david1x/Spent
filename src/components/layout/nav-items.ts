import {
  ArrowLeftRight,
  LayoutDashboard,
  Settings as SettingsIcon,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  /** Key in the `nav` message namespace. */
  labelKey: "home" | "budget" | "transactions" | "settings";
  Icon: LucideIcon;
  match: (pathname: string) => boolean;
  /** Shows the review queue count next to the item. */
  showReviewBadge?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    labelKey: "home",
    Icon: LayoutDashboard,
    match: (p) => p === "/",
  },
  {
    href: "/budget",
    labelKey: "budget",
    Icon: Wallet,
    match: (p) => p.startsWith("/budget"),
  },
  {
    href: "/transactions",
    labelKey: "transactions",
    Icon: ArrowLeftRight,
    match: (p) => p.startsWith("/transactions"),
    showReviewBadge: true,
  },
  {
    href: "/settings",
    labelKey: "settings",
    Icon: SettingsIcon,
    match: (p) => p.startsWith("/settings"),
  },
];
