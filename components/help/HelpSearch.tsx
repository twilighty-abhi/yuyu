"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { searchHelp, type HelpSearchDocument, type HelpSearchResult } from "@/lib/help/text";

type IndexState = { status: "idle" | "loading" | "error" } | { status: "ready"; documents: HelpSearchDocument[] };

function resultHref(result: HelpSearchResult) {
  return `/help/${result.slug}${result.anchor ? `#${result.anchor}` : ""}`;
}

/**
 * Search box for the guide. The index (plain text of every article the viewer
 * may read) loads on first focus and is searched in the browser. Press "/"
 * anywhere on a guide page to jump here.
 */
export function HelpSearch({ size = "md", autoFocus = false }: { size?: "md" | "lg"; autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState<IndexState>({ status: "idle" });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const loadIndex = () => {
    if (index.status === "loading" || index.status === "ready") return;
    setIndex({ status: "loading" });
    fetch("/api/help/search-index", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { documents: HelpSearchDocument[] }) => setIndex({ status: "ready", documents: body.documents }))
      .catch(() => setIndex({ status: "error" }));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(
    () => (index.status === "ready" && query.trim() ? searchHelp(index.documents, query) : []),
    [index, query],
  );
  const showList = open && query.trim().length > 0;

  const go = (result: HelpSearchResult) => {
    setOpen(false);
    setQuery("");
    router.push(resultHref(result));
  };

  return (
    <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label htmlFor={`${listId}-input`} className="sr-only">Search the guide</label>
      <SearchInput
        ref={inputRef}
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Search the guide"
        value={query}
        className={cn(size === "lg" && "min-h-14 text-body-l")}
        onFocus={() => { loadIndex(); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onClear={() => { setQuery(""); inputRef.current?.focus(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setActive((value) => (value + 1) % results.length); }
          else if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActive((value) => (value - 1 + results.length) % results.length); }
          else if (event.key === "Enter" && showList && results[active]) { event.preventDefault(); go(results[active]); }
          else if (event.key === "Escape") { setOpen(false); }
        }}
      />
      {showList ? (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-[16px] border border-line bg-canvas shadow-[0_1px_2px_rgba(24,24,27,.04),0_24px_48px_rgba(24,24,27,.08)]">
          {index.status === "ready" && results.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="Guide search results" className="max-h-[60vh] overflow-y-auto p-1.5">
              {results.map((result, position) => (
                <li key={`${result.slug}-${result.anchor ?? ""}`} id={`${listId}-${position}`} role="option" aria-selected={position === active}>
                  <Link
                    href={resultHref(result)}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(position)}
                    onClick={() => { setOpen(false); setQuery(""); }}
                    className={cn("flex flex-col gap-0.5 rounded-xl px-3 py-2.5", position === active ? "bg-emphasis" : "hover:bg-emphasis/70")}
                  >
                    <span className="text-caption text-ink-muted">{result.section}{result.heading ? ` · ${result.heading}` : ""}</span>
                    <span className="text-label text-ink">{result.title}</span>
                    <span className="line-clamp-2 text-caption text-ink-secondary">{result.snippet}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p id={listId} role="status" className="px-4 py-3.5 text-body-ui text-ink-muted">
              {index.status === "error" ? "Search isn't available right now. Browse the sections instead." : index.status === "ready" ? `Nothing in the guide matches “${query.trim()}”.` : "Loading…"}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
