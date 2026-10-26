"use client";

import Link from "next/link";
import { useAuthSession } from "@/components/auth/useAuthSession";
import { Button } from "@/components/ui/button";
import { OrgLogo } from "@/components/ui/display";
import { ColorModeToggle } from "./ColorModeToggle";

/**
 * Header for event-facing pages (event, programme, session, speaker, series,
 * feedback, organisation page). The organiser's identity leads, not Yuyu's.
 */
export function EventContextHeader({ organisation }: { organisation: { name: string; slug: string; logoUrl: string | null } }) {
  const { status } = useAuthSession();
  return (
    <header className="border-b border-line bg-canvas">
      <nav aria-label="Organiser navigation" className="mx-auto flex h-16 max-w-[1160px] items-center gap-3 px-4 sm:px-6">
        <Link href={`/${organisation.slug}`} className="inline-flex min-w-0 items-center gap-2.5 rounded-md">
          <OrgLogo name={organisation.name} src={organisation.logoUrl} size="sm" />
          <span className="truncate text-[15px] font-semibold text-ink">{organisation.name}</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Button asChild variant="quiet" size="sm" className="hidden sm:inline-flex">
            <Link href="/discover">Discover events</Link>
          </Button>
          <ColorModeToggle size="sm" />
          {status === "authenticated" ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <Button asChild variant="secondary" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
