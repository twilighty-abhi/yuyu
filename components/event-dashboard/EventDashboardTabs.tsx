"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const EVENT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "guests", label: "Guests" },
  { value: "page", label: "Event page" },
  { value: "emails", label: "Emails" },
  { value: "check-in", label: "Check-in" },
  { value: "judging", label: "Judging" },
  { value: "feedback", label: "Feedback" },
  { value: "analytics", label: "Analytics" },
  { value: "settings", label: "Settings" },
] as const;

export type EventTab = (typeof EVENT_TABS)[number]["value"];

/** Old tab ids (bookmarks, links) mapped to their new home: [tab, sub-tab]. */
const LEGACY: Record<string, [EventTab, string | null]> = {
  details: ["page", "details"],
  registration: ["page", "registration"],
  invites: ["guests", "invites"],
};

export function resolveTab(value: string | null): {
  tab: EventTab;
  sub: string | null;
} {
  if (value && value in LEGACY) {
    const [tab, sub] = LEGACY[value]!;
    return { tab, sub };
  }
  return {
    tab: (EVENT_TABS.some((item) => item.value === value)
      ? value
      : "overview") as EventTab,
    sub: null,
  };
}

type TabsApi = {
  /** Switch tab (and optionally a sub-tab inside it) from anywhere in a panel. */
  openTab: (tab: string, sub?: string) => void;
  /** The latest sub-tab request; SubTabs reacts when the value is one of its own. */
  requestedSub: { value: string; nonce: number } | null;
};

const TabsContext = createContext<TabsApi>({
  openTab: () => {},
  requestedSub: null,
});

export function useEventTabs() {
  return useContext(TabsContext);
}

/** Keeps `?tab=` (and drops a stale `?sub=`) in the address bar so tabs can be linked and survive a reload. */
function writeQuery(tab: EventTab) {
  const url = new URL(window.location.href);
  if (tab === "overview") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  url.searchParams.delete("sub");
  window.history.replaceState(window.history.state, "", url);
}

const NO_HIDDEN_TABS: readonly EventTab[] = [];

/**
 * The event dashboard's tabs. Panels are rendered on the server and passed
 * in; this component only switches between them. `hidden` drops tabs that do
 * not apply to this event or person (e.g. Judging); a link to a hidden tab
 * opens Overview instead.
 */
export function EventDashboardTabs({
  panels,
  badges = {},
  hidden = NO_HIDDEN_TABS,
}: {
  panels: Partial<Record<EventTab, ReactNode>>;
  badges?: Partial<Record<EventTab, number>>;
  hidden?: readonly EventTab[];
}) {
  const searchParams = useSearchParams();
  const tabs = EVENT_TABS.filter((item) => !hidden.includes(item.value));
  const visibleTab = (value: EventTab): EventTab =>
    tabs.some((item) => item.value === value) ? value : "overview";
  const [tab, setTab] = useState<EventTab>(() =>
    visibleTab(resolveTab(searchParams.get("tab")).tab),
  );
  const [requestedSub, setRequestedSub] =
    useState<TabsApi["requestedSub"]>(null);
  const openTab = useCallback((value: string, sub?: string) => {
    const resolved = resolveTab(value);
    const next = hidden.includes(resolved.tab) ? "overview" : resolved.tab;
    setTab(next);
    writeQuery(next);
    const wanted = sub ?? resolved.sub;
    if (wanted) setRequestedSub({ value: wanted, nonce: Date.now() });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [hidden]);
  const api = useMemo(
    () => ({ openTab, requestedSub }),
    [openTab, requestedSub],
  );
  return (
    <TabsContext.Provider value={api}>
      <Tabs
        // A tab can disappear after a refresh (e.g. Judging once submissions
        // are turned off with nothing left to judge): show Overview instead.
        value={visibleTab(tab)}
        onValueChange={(value) => {
          setTab(value as EventTab);
          writeQuery(value as EventTab);
        }}
      >
        <TabsList aria-label="Manage event">
          {tabs.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
              {badges[item.value] ? (
                <span className="rounded-full bg-warning-bg px-1.5 text-xs font-bold leading-5 text-warning-fg">
                  {badges[item.value]}
                  <span className="sr-only"> need attention</span>
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((item) => (
          <TabsContent key={item.value} value={item.value} className="pt-6">
            {panels[item.value]}
          </TabsContent>
        ))}
      </Tabs>
    </TabsContext.Provider>
  );
}

/** A button that switches the event dashboard to another tab; usable from server-rendered panels. */
export function OpenTabButton({
  tab,
  sub,
  className,
  children,
}: {
  tab: string;
  sub?: string;
  className?: string;
  children: ReactNode;
}) {
  const { openTab } = useEventTabs();
  return (
    <button
      type="button"
      onClick={() => openTab(tab, sub)}
      className={className}
    >
      {children}
    </button>
  );
}
