"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthSession } from "@/components/auth/useAuthSession";
import { DotLockup } from "@/components/brand/DotLockup";
import { DotMark } from "@/components/brand/DotMark";
import { GITHUB_URL } from "@/lib/openSource";


const publicLinks = [
  { label: "Discover", href: "/discover" },
  { label: "Features", href: "/features" },
  { label: "Self-host", href: "/#self-host" },
  { label: "About", href: "/about" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

const linkClasses = "text-body-ui text-ink-secondary underline-offset-4 transition-colors hover:text-ink hover:underline";

/** Yuyu site footer (Figma 121:1333). "Hosted on Idlistack" lives here, never in the top nav. */
export function SiteFooter() {
  const pathname = usePathname();
  const { status } = useAuthSession();
  const links = status === "authenticated" ? [{ label: "Dashboard", href: "/dashboard" }, { label: "Account", href: "/account" }, ...publicLinks] : publicLinks;

  return (
    <footer className="mt-auto border-t border-line bg-canvas">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-5 px-4 py-10 sm:px-6 xl:px-0">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2.5">
            <Link href="/" className="inline-flex items-center self-start" aria-label="Yuyu home">
              <DotLockup size="md" label={null} />
            </Link>
            <p className="text-body-ui text-ink-secondary">Free events, run by communities.</p>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} aria-current={pathname === link.href ? "page" : undefined} className={linkClasses}>
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={linkClasses}>GitHub</a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="border-t border-line pt-5 text-caption text-ink-muted">
          Built by{" "}
          <a href="https://abhiramnj.com" target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-ink hover:underline">Abhiram</a>
          {" · Hosted on "}
          <a href="https://idlistack.com" target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-ink hover:underline">Idlistack</a>
        </p>
      </div>
    </footer>
  );
}

/** Compact footer for event-facing pages: the organiser leads, Yuyu steps back. */
export function EventFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-canvas">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-3 px-4 py-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Link href="/" className="inline-flex items-center gap-2 hover:text-ink">
          <DotMark size={18} label={null} />
          <span>Free event, powered by Yuyu</span>
        </Link>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">Privacy</Link>
          <span aria-hidden>·</span>
          <Link href="/terms" className="underline underline-offset-4 hover:text-ink">Terms</Link>
          <span aria-hidden>·</span>
          <span>
            Hosted on{" "}
            <a href="https://idlistack.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-ink">Idlistack</a>
          </span>
        </p>
      </div>
    </footer>
  );
}

/** Credit under an embedded event (inside the organiser's iframe): opens Yuyu in a new tab. */
export function EmbedCredit() {
  return (
    <footer className="flex justify-center px-4 py-5">
      <a href="/" target="_blank" rel="noopener" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <DotMark size={18} label={null} />
        <span>Free event, powered by Yuyu</span>
      </a>
    </footer>
  );
}
