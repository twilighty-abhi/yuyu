import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { helpAccessForViewer } from "@/lib/help/access";
import { adjacentHelpArticles, findHelpArticle, helpArticleHeadings } from "@/lib/help/content";
import { LegalToc } from "@/components/legal/LegalToc";

type Props = { params: Promise<{ slug: string[] }> };

async function articleFor(params: Props["params"]) {
  const { slug } = await params;
  return findHelpArticle(slug.join("/"), await helpAccessForViewer());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await articleFor(params);
  if (!article) return {};
  return { title: `${article.title} · Guide`, description: article.summary };
}

export default async function HelpArticlePage({ params }: Props) {
  // Only manifest slugs the viewer may read get this far, so the import below
  // never sees arbitrary input; admin sections are a plain 404 for others.
  const article = await articleFor(params);
  if (!article) notFound();

  const access = await helpAccessForViewer();
  const [{ default: Body }, headings] = await Promise.all([
    import(`@/content/help/${article.slug}.mdx`) as Promise<{ default: () => React.JSX.Element }>,
    helpArticleHeadings(article.slug),
  ]);
  const toc = headings.filter((heading) => heading.level === 2).map(({ id, title }) => ({ id, title }));
  const { previous, next } = adjacentHelpArticles(article.slug, access);

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,720px)_200px] xl:justify-between">
      <article className="min-w-0">
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
            <li><Link href="/help" className="underline-offset-4 hover:text-ink hover:underline">Guide</Link></li>
            <li aria-hidden>/</li>
            <li>{article.section.title}</li>
          </ol>
        </nav>
        <header className="flex flex-col gap-3 border-b border-line pb-6">
          <h1 className="text-h1 text-ink">{article.title}</h1>
          <p className="text-body-l text-ink-secondary">{article.summary}</p>
        </header>
        <div className="pt-2">
          <Body />
        </div>
        <nav aria-label="More in the guide" className="mt-12 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
          {previous ? (
            <Link href={`/help/${previous.slug}`} className="flex flex-col gap-1 rounded-[16px] border border-line px-4 py-3 transition-colors hover:bg-subtle">
              <span className="inline-flex items-center gap-1 text-caption text-ink-muted"><ArrowLeft aria-hidden className="size-3.5" /> Previous</span>
              <span className="text-label text-ink">{previous.title}</span>
            </Link>
          ) : <span />}
          {next ? (
            <Link href={`/help/${next.slug}`} className="flex flex-col gap-1 rounded-[16px] border border-line px-4 py-3 text-right transition-colors hover:bg-subtle">
              <span className="inline-flex items-center justify-end gap-1 text-caption text-ink-muted">Next <ArrowRight aria-hidden className="size-3.5" /></span>
              <span className="text-label text-ink">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      </article>
      {toc.length > 1 ? (
        <div className="hidden xl:block">
          <LegalToc sections={toc} />
        </div>
      ) : null}
    </div>
  );
}
