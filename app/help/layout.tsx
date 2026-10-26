import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { helpAccessForViewer } from "@/lib/help/access";
import { visibleHelpSections } from "@/lib/help/content";
import { HelpNav } from "@/components/help/HelpNav";
import { HelpSearch } from "@/components/help/HelpSearch";

/** The guide: search and section navigation beside every page (inside the site chrome). */
export default async function HelpLayout({ children }: { children: ReactNode }) {
  const sections = visibleHelpSections(await helpAccessForViewer()).map((section) => ({
    id: section.id,
    title: section.title,
    articles: section.articles.map(({ slug, title }) => ({ slug, title })),
  }));

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
      <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-48px)] lg:self-start lg:overflow-y-auto lg:pb-6 lg:pr-1">
        <HelpSearch />
        <details className="group rounded-[16px] border border-line lg:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-label text-ink [&::-webkit-details-marker]:hidden">
            Browse the guide
            <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-line px-1 py-4">
            <HelpNav sections={sections} />
          </div>
        </details>
        <div className="hidden lg:block">
          <HelpNav sections={sections} />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
