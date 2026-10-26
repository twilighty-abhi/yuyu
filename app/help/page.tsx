import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { helpAccessForViewer } from "@/lib/help/access";
import { visibleHelpSections } from "@/lib/help/content";

export const metadata: Metadata = {
  title: "Guide",
  description: "How to use Yuyu: accounts, events, registration, check-in, hackathons, feedback and more.",
};

const popular = [
  { slug: "getting-started/organiser-quick-start", label: "Run your first event" },
  { slug: "events/publishing", label: "Publish an event and choose who can see it" },
  { slug: "registration/form", label: "Ask guests questions when they register" },
  { slug: "check-in/check-in-desk", label: "Check guests in at the door" },
  { slug: "attending/your-ticket", label: "Find and use your ticket" },
  { slug: "troubleshooting/common-problems", label: "Fix emails that don't arrive" },
] as const;

export default async function HelpHome() {
  const sections = visibleHelpSections(await helpAccessForViewer());

  return (
    <div className="flex flex-col gap-12 pb-8">
      <header className="flex max-w-[680px] flex-col gap-3">
        <p className="text-overline text-ink-muted">Guide</p>
        <h1 className="text-display-m text-ink">How can we help?</h1>
        <p className="text-body-l text-ink-secondary">
          Everything Yuyu can do and how to do it, for guests, organisers and the people who run this server.
          Search above, or start with a section below.
        </p>
      </header>

      <section aria-labelledby="popular-title" className="flex flex-col gap-4">
        <h2 id="popular-title" className="text-h4 text-ink">Popular tasks</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {popular.map((item) => (
            <li key={item.slug}>
              <Link href={`/help/${item.slug}`} className="flex min-h-12 items-center justify-between gap-3 rounded-[16px] border border-line px-4 py-3 text-body-ui text-ink transition-colors hover:bg-subtle">
                {item.label}
                <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sections-title" className="flex flex-col gap-4">
        <h2 id="sections-title" className="text-h4 text-ink">Browse by topic</h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <li key={section.id} className="flex flex-col gap-3 rounded-[16px] border border-line p-5">
              <div className="flex flex-col gap-1">
                <h3 className="text-h4 text-ink">{section.title}</h3>
                <p className="text-body-ui text-ink-muted">{section.description}</p>
              </div>
              <ul className="flex flex-col gap-1.5">
                {section.articles.map((article) => (
                  <li key={article.slug}>
                    <Link href={`/help/${article.slug}`} className="text-body-ui text-ink-secondary underline-offset-4 hover:text-ink hover:underline">
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
