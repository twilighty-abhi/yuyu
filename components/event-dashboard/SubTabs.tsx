"use client";

import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useActiveTabIntoView } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { clearViewParamsFromUrl } from "@/lib/savedViews";
import { resolveTab, useEventTabs } from "./EventDashboardTabs";

export type SubTab = { value: string; label: string; count?: number; content: ReactNode };

/**
 * Segmented sub-tabs inside an event-dashboard tab (e.g. Guests: People ·
 * Invites). Honours `?sub=` and legacy `?tab=` links such as `?tab=invites`.
 */
export function SubTabs({ items, label, className }: { items: SubTab[]; label: string; className?: string }) {
  const searchParams = useSearchParams();
  const initial = (() => {
    const fromSub = searchParams.get("sub");
    const legacy = resolveTab(searchParams.get("tab")).sub;
    const wanted = fromSub ?? legacy;
    return items.some((item) => item.value === wanted) ? (wanted as string) : items[0]!.value;
  })();
  const [value, setValue] = useState(initial);
  const { requestedSub } = useEventTabs();
  const [handledRequest, setHandledRequest] = useState<number | null>(null);
  // On phones the pill row scrolls sideways: keep the active sub-tab in view.
  const listRef = useRef<HTMLDivElement>(null);
  useActiveTabIntoView(listRef, 16);
  // Another panel asked for one of our sub-tabs (e.g. Overview → Guests · Invites):
  // adjust during render, once per request (React's recommended pattern).
  if (requestedSub && requestedSub.nonce !== handledRequest && items.some((item) => item.value === requestedSub.value)) {
    setHandledRequest(requestedSub.nonce);
    setValue(requestedSub.value);
  }
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(next) => {
        setValue(next);
        const url = new URL(window.location.href);
        url.searchParams.set("sub", next);
        // List filters (saved views) belong to the sub-tab that was showing.
        clearViewParamsFromUrl(url);
        window.history.replaceState(window.history.state, "", url);
      }}
      className={cn("flex flex-col gap-5", className)}
    >
      <TabsPrimitive.List ref={listRef} aria-label={label} className="inline-flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-muted p-1 [scrollbar-width:none]">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold text-ink-secondary transition-colors hover:text-ink data-[state=active]:bg-canvas data-[state=active]:font-bold data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_rgba(24,24,27,0.08)]"
          >
            {item.label}
            {item.count != null ? <span className="font-medium text-ink-muted">{item.count}</span> : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value} className="focus-visible:outline-none">
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
