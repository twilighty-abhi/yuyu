"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useAuthSession } from "@/components/auth/useAuthSession";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu as MenuIcon, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { DotLockup } from "@/components/brand/DotLockup";
import { ColorModeToggle } from "./ColorModeToggle";

const primaryLinks = [
  { href: "/discover", label: "Discover", guestOnly: false },
  { href: "/features", label: "Features", guestOnly: true },
  { href: "/#self-host", label: "Self-host", guestOnly: false },
  { href: "/about", label: "About", guestOnly: false },
];

/** The Yuyu horizontal lockup as a home link (site header, auth pages, app shell). */
export function YuyuWordmark({ href = "/", size = "sm" }: { href?: string; size?: "sm" | "md" }) {
  return (
    <Link href={href} aria-label="Yuyu home" className="inline-flex items-center rounded-md">
      <DotLockup size={size} label={null} />
    </Link>
  );
}

/** Yuyu's own site header (docs/DESIGN.md §4.14): home, about, features, discover, legal. */
export function SiteHeader() {
  const pathname = usePathname();
  const { status } = useAuthSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = status === "authenticated";
  const links = primaryLinks.filter((link) => !(link.guestOnly && signedIn));
  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur-md">
      <nav aria-label="Main navigation" className="mx-auto flex h-[76px] max-w-[1160px] items-center gap-2 px-4 sm:gap-8 sm:px-6 xl:px-0">
        <YuyuWordmark />
        <ul className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-full px-3.5 text-label text-ink-secondary transition-colors hover:text-ink",
                  isActive(link.href) && "bg-muted font-semibold text-ink",
                )}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <ColorModeToggle />
          <div className="hidden items-center gap-2.5 md:flex">
            {signedIn ? (
              <>
                <Button asChild variant="quiet" size="sm">
                  <Link href="/account" aria-current={isActive("/account") ? "page" : undefined}>Account</Link>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void signOut({ callbackUrl: "/" })}>Sign out</Button>
                <Button asChild variant="primary" size="md">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="secondary" size="md">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild variant="primary" size="md">
                  <Link href="/login">Start organising</Link>
                </Button>
              </>
            )}
          </div>
          <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogPrimitive.Trigger asChild>
              <IconButton label="Open navigation menu" className="lg:hidden">
                <MenuIcon />
              </IconButton>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(17,17,19,0.48)] lg:hidden" />
              <DialogPrimitive.Content className="fixed inset-x-0 top-0 z-50 rounded-b-2xl border-b border-line bg-canvas p-4 shadow-float focus:outline-none lg:hidden">
                <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">Site navigation links</DialogPrimitive.Description>
                <div className="mb-3 flex items-center justify-between">
                  <YuyuWordmark />
                  <DialogPrimitive.Close asChild>
                    <IconButton label="Close navigation menu">
                      <X />
                    </IconButton>
                  </DialogPrimitive.Close>
                </div>
                <ul className="flex flex-col">
                  {[...links, ...(signedIn ? [{ href: "/dashboard", label: "Dashboard" }, { href: "/account", label: "Account" }] : [])].map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={() => setMenuOpen(false)}
                        aria-current={isActive(link.href) ? "page" : undefined}
                        className={cn("flex min-h-12 items-center rounded-md px-3 text-body font-medium text-ink", isActive(link.href) && "bg-emphasis font-semibold")}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                  {signedIn ? (
                    <Button variant="secondary" fullWidth onClick={() => { setMenuOpen(false); void signOut({ callbackUrl: "/" }); }}>
                      Sign out
                    </Button>
                  ) : (
                    <>
                      <Button asChild variant="primary" fullWidth>
                        <Link href="/login" onClick={() => setMenuOpen(false)}>Start organising</Link>
                      </Button>
                      <Button asChild variant="secondary" fullWidth>
                        <Link href="/login" onClick={() => setMenuOpen(false)}>Sign in</Link>
                      </Button>
                    </>
                  )}
                </div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </nav>
    </header>
  );
}
