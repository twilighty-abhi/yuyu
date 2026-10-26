import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import Link from "next/link";
import type { MDXComponents } from "mdx/types";
import { AlertTriangle, Info, Lightbulb, Link2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { headingId } from "@/lib/help/text";
import screenshots from "@/content/help/screenshots.json";

/* Styling and building blocks for guide articles (content/help/**.mdx). */

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function Heading({ level, children }: { level: 2 | 3; children: ReactNode }) {
  const id = headingId(textOf(children));
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag id={id} className={cn("group scroll-mt-24 text-ink", level === 2 ? "mt-10 text-h3" : "mt-7 text-h4")}>
      {children}
      <a href={`#${id}`} className="ml-2 inline-flex align-middle text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
        <Link2 aria-hidden className="size-4" />
        <span className="sr-only">Link to this section</span>
      </a>
    </Tag>
  );
}

function Anchor({ href = "", children, ...props }: ComponentPropsWithoutRef<"a">) {
  const className = "font-medium text-ink underline underline-offset-4 decoration-line-strong hover:decoration-ink";
  if (href.startsWith("/") || href.startsWith("#")) {
    return <Link href={href} className={className}>{children}</Link>;
  }
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...props}>{children}</a>;
}

type CalloutKind = "tip" | "note" | "warning" | "permission";

const calloutKinds: Record<CalloutKind, { label: string; icon: ReactNode; classes: string }> = {
  tip: { label: "Tip", icon: <Lightbulb />, classes: "bg-tint-peach text-ink-secondary" },
  note: { label: "Note", icon: <Info />, classes: "bg-muted text-ink-secondary" },
  warning: { label: "Careful", icon: <AlertTriangle />, classes: "bg-warning-bg text-warning-fg" },
  permission: { label: "Who can do this", icon: <ShieldCheck />, classes: "bg-subtle text-ink-secondary border border-line" },
};

/** `<Callout kind="tip" title="…">…</Callout>`; `kind="permission"` states who can use a feature. */
export function Callout({ kind = "note", title, children }: { kind?: CalloutKind; title?: string; children: ReactNode }) {
  const { label, icon, classes } = calloutKinds[kind];
  return (
    <aside className={cn("my-6 flex gap-3 rounded-[16px] px-4 py-3.5", classes)}>
      <span aria-hidden className="mt-0.5 shrink-0 [&_svg]:size-5">{icon}</span>
      <div className="min-w-0 flex-1 text-body-ui [&>p]:my-0 [&>p+p]:mt-2 [&_ul]:my-1">
        <p className="font-semibold text-ink">{title ?? label}</p>
        {children}
      </div>
    </aside>
  );
}

/** A numbered procedure: wrap an ordered list in `<Steps>`. */
export function Steps({ children }: { children: ReactNode }) {
  return <div className="help-steps my-6">{children}</div>;
}

/** A keyboard key, e.g. `<Kbd>Enter</Kbd>`. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line-strong bg-subtle px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</kbd>;
}

const screenshotSizes: Record<string, { width: number; height: number }> = screenshots;

/**
 * A captured screen from public/help/<name>.png (see tests/help-screenshots).
 * Until a screen is captured, development shows a placeholder and production
 * shows nothing.
 */
export function Screenshot({ name, alt, caption }: { name: string; alt: string; caption?: string }) {
  const size = screenshotSizes[name];
  if (!size) {
    if (process.env.NODE_ENV === "production") return null;
    return (
      <figure className="my-6 rounded-[16px] border border-dashed border-line-strong px-4 py-8 text-center text-caption text-ink-muted">
        Screenshot not captured yet: <code>{name}</code> ({alt})
      </figure>
    );
  }
  return (
    <figure className="my-6 flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots from /public with known sizes */}
      <img src={`/help/${name}.png`} alt={alt} width={size.width} height={size.height} loading="lazy" decoding="async" className="h-auto w-full rounded-[16px] border border-line bg-subtle" />
      {caption ? <figcaption className="text-caption text-ink-muted">{caption}</figcaption> : null}
    </figure>
  );
}

/** Wide tables scroll inside the article instead of the page. */
function Table({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 overflow-x-auto rounded-[16px] border border-line">
      <table className="w-full border-collapse text-left text-body-ui">{children}</table>
    </div>
  );
}

export const helpMdxComponents: MDXComponents = {
  h1: () => null, // the page renders the title from the manifest
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  p: ({ children }) => <p className="my-4 text-body text-ink-secondary">{children}</p>,
  a: Anchor,
  ul: ({ children }) => <ul className="my-4 flex list-disc flex-col gap-1.5 pl-6 text-body text-ink-secondary marker:text-ink-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 flex list-decimal flex-col gap-1.5 pl-6 text-body text-ink-secondary marker:text-ink-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-1 [&>p]:my-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  code: ({ children }) => <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-ink">{children}</code>,
  pre: ({ children }) => (
    <pre className="my-6 overflow-x-auto rounded-[16px] bg-inverse p-4 text-mono text-on-inverse [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">{children}</pre>
  ),
  blockquote: ({ children }) => <blockquote className="my-6 border-l-4 border-line-strong pl-4 text-ink-secondary">{children}</blockquote>,
  hr: () => <hr className="my-10 border-line" />,
  table: Table,
  thead: ({ children }) => <thead className="bg-subtle">{children}</thead>,
  th: ({ children }) => <th className="border-b border-line px-4 py-2.5 text-label text-ink">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-4 py-2.5 align-top text-ink-secondary">{children}</td>,
  img: () => null, // use <Screenshot> so every image has a known size and alt text
  Callout,
  Steps,
  Kbd,
  Screenshot,
};
