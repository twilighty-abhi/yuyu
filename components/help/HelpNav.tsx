"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type HelpNavSection = { id: string; title: string; articles: Array<{ slug: string; title: string }> };

/** The guide's sidebar: every readable section and article, with the current page marked. */
export function HelpNav({ sections }: { sections: HelpNavSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Guide" className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1.5">
          <p className="px-3 text-overline text-ink-muted">{section.title}</p>
          <ul className="flex flex-col">
            {section.articles.map((article) => {
              const href = `/help/${article.slug}`;
              const current = pathname === href;
              return (
                <li key={article.slug}>
                  <Link
                    href={href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "block rounded-xl px-3 py-1.5 text-body-ui transition-colors",
                      current ? "bg-emphasis font-semibold text-ink" : "text-ink-secondary hover:bg-emphasis/70 hover:text-ink",
                    )}
                  >
                    {article.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
