"use client";

import { forwardRef, useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ElementRef, type ReactNode, type Ref } from "react";
import Link from "next/link";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/* ---------- Underline tabs (docs/DESIGN.md §4.4) ---------- */

export const Tabs = TabsPrimitive.Root;

const tabListClasses = "flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const tabClasses =
  "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[15px] font-semibold text-ink-muted transition-colors duration-[180ms] ease-yy hover:text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent [&_svg]:size-4";

/**
 * Tab rows scroll sideways on narrow screens; the active tab is scrolled into
 * view (`useActiveTabIntoView`). These hints show a faded arrow
 * on each side that has hidden tabs, so people know there is more to see;
 * clicking an arrow scrolls the row. Keyboard users keep the tabs' own
 * arrow-key navigation, so the hint buttons are skipped in the tab order.
 */
function useScrollHints<T extends HTMLElement>() {
  const node = useRef<T | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = node.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);
  const scroll = (direction: -1 | 1) => {
    const el = node.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.7), behavior: reduce ? "auto" : "smooth" });
  };
  useActiveTabIntoView(node);
  return { node, edges, scroll };
}

/** Room kept clear on each side for the faded scroll hint (§4.4), so an active tab is never hidden under it. */
const ACTIVE_TAB_MARGIN = 56;

/**
 * Where a sideways-scrolling tab row should scroll so its active tab is fully
 * visible, or null when it already is. `tab.left` is measured from the start
 * of the row's scrollable content.
 */
export function activeTabScrollTarget(
  row: { scrollLeft: number; clientWidth: number; scrollWidth: number },
  tab: { left: number; width: number },
  margin = ACTIVE_TAB_MARGIN,
): number | null {
  const maxScroll = Math.max(0, row.scrollWidth - row.clientWidth);
  if (maxScroll === 0) return null;
  const viewStart = row.scrollLeft;
  const viewEnd = row.scrollLeft + row.clientWidth;
  // Keep the margin only where there is more row to scroll to on that side.
  const startRoom = tab.left > 0 ? margin : 0;
  const endRoom = tab.left + tab.width < row.scrollWidth ? margin : 0;
  let target: number;
  if (tab.left - startRoom < viewStart) target = tab.left - startRoom;
  else if (tab.left + tab.width + endRoom > viewEnd) target = tab.left + tab.width + endRoom - row.clientWidth;
  else return null;
  const clamped = Math.min(maxScroll, Math.max(0, Math.round(target)));
  return clamped === Math.round(row.scrollLeft) ? null : clamped;
}

const ACTIVE_TAB_SELECTOR = '[data-state="active"][role="tab"], [aria-current="page"]';

/**
 * On phones a tab row scrolls sideways, so the active tab can sit off-screen
 * (a deep link to the ninth tab, or a panel switching tabs). This scrolls the
 * row, never the page, to show it: instantly on mount, smoothly when the
 * active tab changes unless reduced motion is preferred.
 */
export function useActiveTabIntoView<T extends HTMLElement>(node: { current: T | null }, margin = ACTIVE_TAB_MARGIN) {
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const reveal = (behavior: ScrollBehavior) => {
      const tab = el.querySelector<HTMLElement>(ACTIVE_TAB_SELECTOR);
      if (!tab) return;
      const rowBox = el.getBoundingClientRect();
      const tabBox = tab.getBoundingClientRect();
      const target = activeTabScrollTarget(el, { left: tabBox.left - rowBox.left + el.scrollLeft, width: tabBox.width }, margin);
      if (target === null) return;
      el.scrollTo({ left: target, behavior });
    };
    reveal("auto");
    const observer = new MutationObserver(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      reveal(reduce ? "auto" : "smooth");
    });
    observer.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-state", "aria-current"] });
    return () => observer.disconnect();
  }, [node, margin]);
}

function setRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) (ref as { current: T | null }).current = value;
    }
  };
}

function ScrollHint({ side, visible, onClick }: { side: "left" | "right"; visible: boolean; onClick: () => void }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 z-[1] flex items-center transition-opacity duration-[180ms] ease-yy",
        side === "left" ? "left-0 bg-gradient-to-r from-canvas from-55% to-transparent pr-6" : "right-0 justify-end bg-gradient-to-l from-canvas from-55% to-transparent pl-6",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={onClick}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full border border-line bg-canvas text-ink-secondary shadow-[0_1px_2px_rgba(24,24,27,0.08)] transition-colors hover:text-ink",
          visible && "pointer-events-auto",
        )}
      >
        {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </button>
    </span>
  );
}

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(function TabsList(
  { className, ...props },
  ref,
) {
  const { node, edges, scroll } = useScrollHints<HTMLDivElement>();
  return (
    <div className="relative min-w-0">
      <ScrollHint side="left" visible={edges.left} onClick={() => scroll(-1)} />
      <TabsPrimitive.List ref={setRefs(ref, node)} className={cn(tabListClasses, className)} {...props} />
      <ScrollHint side="right" visible={edges.right} onClick={() => scroll(1)} />
    </div>
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { accent?: boolean }
>(function TabsTrigger({ className, accent, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabClasses, "data-[state=active]:text-ink", accent ? "data-[state=active]:after:bg-accent" : "data-[state=active]:after:bg-primary", className)}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(function TabsContent(
  { className, ...props },
  ref,
) {
  return <TabsPrimitive.Content ref={ref} className={cn("pt-6 focus-visible:outline-none", className)} {...props} />;
});

/** Link-based underline tabs for navigation between routes. */
export function NavTabs({ items, label, className }: { items: Array<{ href: string; label: ReactNode; active: boolean }>; label: string; className?: string }) {
  const { node, edges, scroll } = useScrollHints<HTMLElement>();
  return (
    <div className="relative min-w-0">
      <ScrollHint side="left" visible={edges.left} onClick={() => scroll(-1)} />
      <nav ref={node} aria-label={label} className={cn(tabListClasses, className)}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cn(tabClasses, item.active && "text-ink after:bg-primary")}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <ScrollHint side="right" visible={edges.right} onClick={() => scroll(1)} />
    </div>
  );
}

/* ---------- Accordion ---------- */

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ value, title, children, className }: { value: string; title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <AccordionPrimitive.Item value={value} className={cn("border-b border-line", className)}>
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger className="group flex w-full items-center justify-between gap-4 py-4 text-left text-[17px] font-semibold text-ink">
          {title}
          <ChevronDown aria-hidden className="size-5 shrink-0 text-ink-muted transition-transform duration-[180ms] group-data-[state=open]:rotate-180" />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="pb-4 text-body text-ink-secondary">{children}</AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}
