"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronsUpDown,
  CircleHelp,
  Home,
  LogOut,
  Menu as MenuIcon,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Repeat,
  Settings,
  Sun,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShellOrganisation, ShellUser } from "@/lib/appShell";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/lib/sidebar";
import { DotMark } from "@/components/brand/DotMark";
import { useAppColorMode } from "@/components/providers";
import { Avatar, OrgLogo } from "@/components/ui/display";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/menu";
import { YuyuWordmark } from "./SiteHeader";

const roleLabel: Record<ShellOrganisation["role"], string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
};

/** Shows a tooltip with the label only when the sidebar is collapsed to icons. */
function RailTip({ collapsed, label, children }: { collapsed: boolean; label: string; children: ReactNode }) {
  return collapsed ? <Tooltip content={label} side="right">{children}</Tooltip> : <>{children}</>;
}

function NavItem({
  href,
  icon,
  children,
  active,
  indent = false,
  collapsed,
  onNavigate,
  badge,
}: {
  href: string;
  icon: ReactNode;
  children: string;
  active: boolean;
  indent?: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  badge?: ReactNode;
}) {
  return (
    <RailTip collapsed={collapsed} label={children}>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? children : undefined}
        className={cn(
          "relative flex min-h-10 items-center gap-2.5 rounded-xl border border-transparent text-[15px] text-ink-secondary transition-colors hover:bg-emphasis/70 hover:text-ink [&_svg]:size-[18px] [&_svg]:shrink-0",
          collapsed ? "justify-center px-0" : "px-3",
          indent && !collapsed && "pl-10 text-sm",
          active && "border-line bg-canvas font-semibold text-ink shadow-[0_1px_2px_rgba(24,24,27,0.05)] hover:bg-canvas",
        )}
      >
        <span aria-hidden className="inline-flex">{icon}</span>
        {collapsed ? null : <span className="min-w-0 flex-1 truncate">{children}</span>}
        {badge}
      </Link>
    </RailTip>
  );
}

function currentOrganisationSlug(pathname: string | null) {
  const match = /^\/dashboard\/([^/]+)/.exec(pathname ?? "");
  if (!match || match[1] === "org" || match[1] === "security") return null;
  return decodeURIComponent(match[1]!);
}

function PendingBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  if (count <= 0) return null;
  const label = `${count} waiting for approval`;
  return collapsed ? (
    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-warning-solid" title={label}>
      <span className="sr-only">{label}</span>
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-warning-bg px-[7px] text-xs font-bold leading-5 text-warning-fg" title={label}>
      {count}
      <span className="sr-only"> waiting for approval</span>
    </span>
  );
}

/** The person's menu: account, light/dark mode and sign out. */
function AccountMenu({ user, collapsed, onNavigate }: { user: ShellUser; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const { mode, toggleColorMode } = useAppColorMode();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = user.name ?? user.email ?? "Account";
  return (
    <Menu>
      <MenuTrigger
        ref={triggerRef}
        aria-label={collapsed ? `Account menu for ${name}` : undefined}
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-line bg-canvas text-left transition-colors hover:bg-subtle data-[state=open]:bg-subtle",
          collapsed ? "justify-center p-1.5" : "p-2",
          pathname.startsWith("/account") && "ring-1 ring-line-strong",
        )}
      >
        <Avatar name={user.name ?? user.email} src={user.image} size="sm" className="size-8 text-[11px]" />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{name}</span>
              {user.email && user.name ? <span className="block truncate text-caption text-ink-muted">{user.email}</span> : null}
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
          </>
        )}
      </MenuTrigger>
      <MenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} className="min-w-[232px]">
        <MenuLabel>{name}</MenuLabel>
        <MenuItem asChild icon={<UserRound />}>
          <Link href="/account" onClick={onNavigate}>Account settings</Link>
        </MenuItem>
        <MenuItem asChild icon={<CircleHelp />}>
          <Link href="/help" onClick={onNavigate}>Help and guide</Link>
        </MenuItem>
        <MenuItem
          icon={mode === "dark" ? <Sun /> : <Moon />}
          onSelect={() => {
            // Reveal the new mode from the account button, which stays on screen.
            const rect = triggerRef.current?.getBoundingClientRect();
            toggleColorMode(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
          }}
        >
          {mode === "dark" ? "Light mode" : "Dark mode"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => void signOut({ callbackUrl: "/" })}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function SidebarContents({
  user,
  organisations,
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  user: ShellUser;
  organisations: ShellOrganisation[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const slug = currentOrganisationSlug(pathname);
  const current = slug ? organisations.find((organisation) => organisation.slug === slug) ?? null : null;
  const base = current ? `/dashboard/${current.slug}` : "";
  const isAdmin = current?.role === "OWNER" || current?.role === "ADMIN";
  const isMember = current && current.role !== "COLLABORATOR";
  const onEventsPage = Boolean(current) && (pathname === base || pathname.startsWith(`${base}/event/`));

  return (
    <div className={cn("flex h-full flex-col gap-4 py-3.5", collapsed ? "px-2.5" : "px-3")}>
      <div className={cn("flex items-center gap-2 pt-1", collapsed ? "flex-col" : "justify-between pl-2")}>
        {collapsed ? (
          <Link href="/dashboard" aria-label="Yuyu home" className="inline-flex rounded-md p-1">
            <DotMark size={28} label={null} />
          </Link>
        ) : (
          <YuyuWordmark href="/dashboard" />
        )}
        {onToggleCollapsed ? (
          <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} size="sm" variant="quiet" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
        ) : null}
      </div>

      {current ? (
        <>
          <Menu>
            <MenuTrigger
              aria-label={collapsed ? `Switch organisation, current: ${current.name}` : undefined}
              className={cn(
                "group w-full overflow-hidden rounded-xl border border-line bg-canvas text-left transition-colors hover:border-line-strong",
                collapsed && "flex justify-center p-1.5",
              )}
            >
              {collapsed ? (
                <OrgLogo name={current.name} src={current.logoUrl} size="md" />
              ) : (
                <>
                  <span aria-hidden className="yy-dot-strip block h-5" />
                  <span className="flex items-center gap-2.5 px-2.5 pb-2.5">
                    <OrgLogo name={current.name} src={current.logoUrl} size="md" className="-mt-3 border-2 border-canvas" />
                    <span className="min-w-0 flex-1 pt-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{current.name}</span>
                      <span className="block text-caption text-ink-muted">{roleLabel[current.role]}</span>
                    </span>
                    <ChevronsUpDown aria-hidden className="mt-1 size-4 shrink-0 text-ink-muted" />
                    <span className="sr-only">Switch organisation</span>
                  </span>
                </>
              )}
            </MenuTrigger>
            <MenuContent align="start" side={collapsed ? "right" : "bottom"} className="min-w-[240px]">
              <MenuLabel>Organisations</MenuLabel>
              {organisations.map((organisation) => (
                <MenuItem key={organisation.slug} asChild>
                  <Link href={`/dashboard/${organisation.slug}`} onClick={onNavigate}>
                    <span className="flex items-center gap-2.5">
                      <OrgLogo name={organisation.name} src={organisation.logoUrl} size="sm" />
                      <span className="min-w-0 truncate">{organisation.name}</span>
                    </span>
                  </Link>
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem asChild icon={<Home />}>
                <Link href="/dashboard" onClick={onNavigate}>All organisations</Link>
              </MenuItem>
              <MenuItem asChild icon={<Plus />}>
                <Link href="/dashboard/org/new" onClick={onNavigate}>New organisation</Link>
              </MenuItem>
            </MenuContent>
          </Menu>

          <nav aria-label="Organisation" className="flex flex-col gap-1">
            {collapsed ? null : <p className="px-3 pb-0.5 text-overline text-ink-muted">Workspace</p>}
            <NavItem href={base} icon={<CalendarDays />} active={onEventsPage} collapsed={collapsed} onNavigate={onNavigate}>Events</NavItem>
            {isMember ? (
              <NavItem href={`${base}#series`} icon={<Repeat />} active={pathname.startsWith(`${base}/series/`)} collapsed={collapsed} onNavigate={onNavigate}>Series</NavItem>
            ) : null}
            {isMember ? (
              <NavItem href={`${base}/members`} icon={<Users />} active={pathname.startsWith(`${base}/members`)} collapsed={collapsed} onNavigate={onNavigate}>Members</NavItem>
            ) : null}
            {isAdmin ? (
              // API access lives inside Settings (owners only), not in the menu.
              <NavItem href={`${base}/settings`} icon={<Settings />} active={pathname.startsWith(`${base}/settings`)} collapsed={collapsed} onNavigate={onNavigate}>Settings</NavItem>
            ) : null}
          </nav>
        </>
      ) : (
        <nav aria-label="Workspace" className="flex flex-col gap-1">
          <NavItem href="/dashboard" icon={<Home />} active={pathname === "/dashboard"} collapsed={collapsed} onNavigate={onNavigate}>Home</NavItem>
          {collapsed ? <span aria-hidden className="mx-auto my-2 h-px w-6 bg-line" /> : <p className="mt-4 px-3 pb-0.5 text-overline text-ink-muted">Organisations</p>}
          {organisations.map((organisation) => (
            <RailTip key={organisation.slug} collapsed={collapsed} label={organisation.name}>
              <Link
                href={`/dashboard/${organisation.slug}`}
                onClick={onNavigate}
                aria-label={collapsed ? organisation.name : undefined}
                className={cn(
                  "relative flex min-h-10 items-center gap-2.5 rounded-xl text-[15px] text-ink-secondary transition-colors hover:bg-emphasis/70 hover:text-ink",
                  collapsed ? "justify-center" : "px-3",
                )}
              >
                <OrgLogo name={organisation.name} src={organisation.logoUrl} size="sm" className="size-6 rounded-[7px] text-[10px]" />
                {collapsed ? null : <span className="min-w-0 flex-1 truncate">{organisation.name}</span>}
                <PendingBadge count={organisation.pendingApprovals} collapsed={collapsed} />
              </Link>
            </RailTip>
          ))}
          <NavItem href="/dashboard/org/new" icon={<Plus />} active={pathname === "/dashboard/org/new"} collapsed={collapsed} onNavigate={onNavigate}>New organisation</NavItem>
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {current && current.role !== "COLLABORATOR" ? (
          <RailTip collapsed={collapsed} label="View public page">
            <Link
              href={`/${current.slug}`}
              onClick={onNavigate}
              aria-label={collapsed ? "View public page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1 rounded-xl text-sm font-medium text-ink-secondary underline-offset-4 hover:text-ink",
                collapsed ? "justify-center hover:bg-emphasis/70" : "px-3 hover:underline",
              )}
            >
              {collapsed ? null : "View public page"}
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </RailTip>
        ) : null}
        <AccountMenu user={user} collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/**
 * Dashboard app shell (docs/DESIGN.md §4.13): a 224px sidebar on desktop that
 * collapses to a 68px icon rail (remembered in a cookie so the server renders
 * the same width), and a top bar with a menu sheet below the md breakpoint.
 */
export function AppShell({ user, organisations, initialCollapsed = false, children }: { user: ShellUser; organisations: ShellOrganisation[]; initialCollapsed?: boolean; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? SIDEBAR_COLLAPSED : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
      return next;
    });
  };
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 overflow-y-auto overflow-x-hidden border-r border-line bg-subtle transition-[width] duration-200 ease-yy motion-reduce:transition-none md:block",
          collapsed ? "w-[68px]" : "w-[224px]",
        )}
      >
        <SidebarContents user={user} organisations={organisations} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-subtle/95 px-4 backdrop-blur-md md:hidden">
        <YuyuWordmark href="/dashboard" />
        <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogPrimitive.Trigger asChild>
            <IconButton label="Open navigation menu">
              <MenuIcon />
            </IconButton>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(17,17,19,0.48)]" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[min(280px,86vw)] overflow-y-auto border-r border-line bg-subtle shadow-float focus:outline-none">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Dashboard navigation</DialogPrimitive.Description>
              <DialogPrimitive.Close asChild>
                <IconButton label="Close navigation menu" size="sm" className="absolute right-3 top-3 z-10">
                  <X />
                </IconButton>
              </DialogPrimitive.Close>
              <SidebarContents user={user} organisations={organisations} onNavigate={() => setMenuOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 md:px-10 md:py-9">
        <div className="mx-auto w-full max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
