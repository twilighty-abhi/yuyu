"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SiteHeader, YuyuWordmark } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

/** Yuyu's own pages: site header + footer, centred content. */
const SITE_PREFIXES = ["/about", "/features", "/discover", "/search", "/privacy", "/terms", "/join/", "/ticket/", "/team/", "/submit/", "/crew/"];
/** Pages that render their own complete chrome (app shell, kiosk, embed, split sign-in). */
const OWN_CHROME_PREFIXES = ["/dashboard", "/account", "/super-admin", "/embed/", "/login"];
/** Auth flows: minimal header with the logo only. */
const AUTH_PREFIXES = ["/reset-password", "/verify-email", "/super-admin-mfa"];

/** "/x" matches "/x" and "/x/..."; "/x/" matches only "/x/..." (a section with sub-pages). */
function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => (prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/** Full-bleed marketing pages that lay out their own sections. */
const FULL_BLEED = ["/", "/about", "/features", "/discover"];

export type ChromeKind = "site" | "auth" | "own";

export function chromeFor(pathname: string): ChromeKind {
  if (pathname === "/") return "site";
  if (matches(pathname, AUTH_PREFIXES)) return "auth";
  if (matches(pathname, OWN_CHROME_PREFIXES)) return "own";
  if (matches(pathname, SITE_PREFIXES)) return "site";
  // Everything else is organiser context (/:org, /:org/:event, ...); the
  // [orgSlug] layout renders the organiser-branded header and footer.
  return "own";
}

/**
 * Chooses the chrome for a route without moving any route files. Server
 * layouts that need data (dashboard, organiser pages) render their own
 * chrome and are classed as "own" here.
 */
export function ChromeSwitch({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const kind = chromeFor(pathname);

  if (kind === "site") {
    return (
      <>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {FULL_BLEED.includes(pathname) ? children : <div className="mx-auto w-full max-w-[1160px] px-4 py-8 sm:px-6 sm:py-10">{children}</div>}
        </main>
        <SiteFooter />
      </>
    );
  }

  if (kind === "auth") {
    return (
      <>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <header className="px-4 py-5 sm:px-8">
          <YuyuWordmark />
        </header>
        <main id="main-content" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 focus:outline-none sm:pt-12">
          {children}
        </main>
      </>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {children}
    </>
  );
}
