"use client";

import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import { usePathname } from "next/navigation";
import Link from "next/link";

const tabs = [
  { label: "Overview", href: "/super-admin" },
  { label: "Monitoring", href: "/super-admin/monitoring" },
  { label: "Operations", href: "/super-admin/operations" },
  { label: "Orgs", href: "/super-admin/orgs" },
  { label: "Events", href: "/super-admin/events" },
  { label: "Users", href: "/super-admin/users" },
  { label: "Auth", href: "/super-admin/auth" },
  { label: "Invites", href: "/super-admin/invites" },
  { label: "Storage", href: "/super-admin/storage" },
] as const;

function getActiveTab(pathname: string): string | false {
  if (pathname === "/super-admin") return "/super-admin";
  const match = tabs
    .map((t) => t.href)
    .filter((href) => href !== "/super-admin")
    .find((href) => pathname === href || pathname.startsWith(`${href}/`));
  return match ?? false;
}

export function SuperAdminTabs() {
  const pathname = usePathname();
  const value = getActiveTab(pathname);

  return (
    <Tabs value={value} variant="scrollable" scrollButtons="auto">
      {tabs.map((t) => (
        <Tab
          key={t.href}
          label={t.label}
          component={Link}
          href={t.href}
          value={t.href}
        />
      ))}
    </Tabs>
  );
}
