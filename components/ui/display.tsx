import { type HTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Repeat, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { DotFace } from "@/components/brand/DotFace";
import { AvatarImage } from "./avatar-image";
import type { DotFaceMood } from "@/components/brand/patterns";

/* ---------- Chips (docs/DESIGN.md §4.5) ---------- */

export type ChipTone = "neutral" | "success" | "warning" | "danger" | "accent" | "ink" | "outline";

const chipTones: Record<ChipTone, string> = {
  neutral: "bg-muted text-ink-secondary",
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
  accent: "bg-accent-soft text-accent-text",
  ink: "bg-primary text-on-primary",
  outline: "border border-line-strong bg-canvas text-ink-secondary",
};

/**
 * A small status/label pill. Long labels truncate to one line by default; pass
 * `wrap` when every word matters (e.g. user-named award badges) so the label
 * wraps onto further lines instead of being cut off.
 */
export function Chip({ tone = "neutral", icon, className, children, size = "md", wrap = false }: { tone?: ChipTone; icon?: ReactNode; className?: string; children: ReactNode; size?: "sm" | "md"; wrap?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-[13px]",
        wrap && "items-start whitespace-normal rounded-xl [&>span:first-child]:mt-px",
        chipTones[tone],
        className,
      )}
    >
      {icon ? <span aria-hidden className="inline-flex">{icon}</span> : null}
      <span className={wrap ? "min-w-0 break-words [overflow-wrap:anywhere]" : "truncate"}>{children}</span>
    </span>
  );
}

/* ---------- Cards ---------- */

export function Card({ className, children, padding = "md", as = "div", ...props }: HTMLAttributes<HTMLElement> & { padding?: "none" | "sm" | "md" | "lg"; as?: "div" | "section" | "article" }) {
  const Component = as;
  return (
    <Component
      className={cn(
        "rounded-lg border border-line bg-canvas",
        padding === "sm" && "p-4",
        padding === "md" && "p-5",
        padding === "lg" && "p-6 sm:p-8",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export function CardHeader({ title, description, action, className, titleAs: Title = "h2" }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; titleAs?: "h2" | "h3" | "h4" }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <Title className="text-title text-ink">{title}</Title>
        {description ? <p className="mt-1 text-body-ui text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ---------- Callout / banner ---------- */

export type CalloutTone = "warning" | "info" | "success" | "danger";

const calloutTones: Record<CalloutTone, { classes: string; icon: ReactNode }> = {
  warning: { classes: "bg-warning-bg text-warning-fg", icon: <AlertTriangle /> },
  info: { classes: "bg-muted text-ink-secondary", icon: <Info /> },
  success: { classes: "bg-success-bg text-success-fg", icon: <CheckCircle2 /> },
  danger: { classes: "bg-danger-bg text-danger-fg", icon: <XCircle /> },
};

export function Callout({ tone = "info", title, children, action, className, role }: { tone?: CalloutTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; role?: "alert" | "status" }) {
  const { classes, icon } = calloutTones[tone];
  return (
    <div role={role} className={cn("flex flex-col gap-3 rounded-lg px-4 py-3.5 sm:flex-row sm:items-center", classes, className)}>
      <span aria-hidden className="hidden shrink-0 sm:inline-flex [&_svg]:size-5">{icon}</span>
      <div className="min-w-0 flex-1 text-body-ui">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "opacity-90")}>{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ---------- Empty state ---------- */

/**
 * Empty, success or error message in a card. On Yuyu's own screens pass a dot
 * face `mood` (Sleepy for empty lists, Sad for errors); organiser-facing pages
 * leave it out.
 */
export function EmptyState({ title, children, action, className, icon, mood }: { title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode; mood?: DotFaceMood }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-lg border border-line bg-canvas px-6 py-7 text-center", className)}>
      {mood ? <DotFace mood={mood} size={48} className="mb-1" /> : null}
      {icon ? <span aria-hidden className="text-ink-muted [&_svg]:size-7">{icon}</span> : null}
      {title ? <p className="text-label text-ink">{title}</p> : null}
      {children ? <div className="max-w-md text-body-ui text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ---------- Danger zone ---------- */

export function DangerZone({ title, description, action, className, children }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border-[1.5px] border-danger-border bg-canvas p-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-sans text-label text-danger-fg">{title}</h3>
          {description ? <p className="mt-1 text-body-ui text-ink-secondary">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ---------- Avatar & org logo ---------- */

export function initials(name: string | null | undefined, fallback = "?") {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  return (words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[words.length - 1]![0]}`).toUpperCase();
}

const avatarSizes = { xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg", xl: "size-20 text-2xl" } as const;
type AvatarSize = keyof typeof avatarSizes;

/** Photo if present, else 1–2 initials on a tint (docs/DESIGN.md §3). */
export function Avatar({ name, src, size = "md", tone = "neutral", className }: { name?: string | null; src?: string | null; size?: AvatarSize; tone?: "neutral" | "accent" | "success" | "warning" | "ink"; className?: string }) {
  const toneClass = {
    neutral: "bg-emphasis text-ink-secondary",
    accent: "bg-accent-soft text-accent-text",
    success: "bg-success-bg text-success-fg",
    warning: "bg-warning-bg text-warning-fg",
    ink: "bg-primary text-on-primary",
  }[tone];
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold", avatarSizes[size], toneClass, className)}>
      {src ? (
        <AvatarImage src={src} fallback={<span aria-hidden>{initials(name)}</span>} />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      {name ? <span className="sr-only">{name}</span> : null}
    </span>
  );
}

const logoSizes = { sm: "size-8 rounded-[9px] text-xs", md: "size-10 rounded-[10px] text-sm", lg: "size-14 rounded-[14px] text-lg", xl: "size-24 rounded-[24px] text-3xl" } as const;

/** Square organisation logo; falls back to initials on ink. */
export function OrgLogo({ name, src, size = "md", className }: { name: string; src?: string | null; size?: keyof typeof logoSizes; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden border border-line font-bold", logoSizes[size], src ? "bg-canvas" : "bg-primary text-on-primary", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- organisation logos are served by the app's own upload route
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
    </span>
  );
}

/* ---------- Date block (docs/DESIGN.md §4.6) ---------- */

export function DateBlock({ month, day, tone = "accent", color, size = "md", series = false, className }: { month: string; day: string; tone?: "accent" | "draft" | "ink"; /** Explicit header colour (validated hex), e.g. an event's own accent in a dashboard list. */ color?: string; size?: "sm" | "md" | "lg"; series?: boolean; className?: string }) {
  const header = color ? "text-white" : tone === "accent" ? "bg-accent text-on-accent" : tone === "draft" ? "bg-ink-disabled text-white" : "bg-primary text-on-primary";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 flex-col overflow-hidden rounded-md border border-line bg-canvas text-center",
        size === "sm" && "w-[50px]",
        size === "md" && "w-14",
        size === "lg" && "w-[68px]",
        className,
      )}
    >
      <span className={cn("block py-0.5 text-[11px] font-bold tracking-[0.08em]", size === "lg" && "text-xs", header)} style={color ? { backgroundColor: color } : undefined}>{month}</span>
      <span
        className={cn(
          "flex items-center justify-center font-display font-extrabold leading-none text-ink",
          size === "sm" && "h-8 text-xl",
          size === "md" && "h-10 text-2xl",
          size === "lg" && "h-12 text-[30px]",
        )}
      >
        {series ? <Repeat className="size-5" /> : day}
      </span>
    </span>
  );
}

/* ---------- Progress & stat tile ---------- */

export function ProgressBar({ value, max, tone = "accent", className, label }: { value: number; max: number; tone?: "accent" | "ink" | "success" | "warning"; className?: string; label?: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = { accent: "bg-accent", ink: "bg-primary", success: "bg-success-solid", warning: "bg-warning-solid" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-track", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-[360ms] ease-yy", fill)} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function StatTile({ label, value, hint, progress, tone = "default", className, href }: { label: ReactNode; value: ReactNode; hint?: ReactNode; progress?: { value: number; max: number; tone?: "accent" | "ink" | "success" | "warning" }; tone?: "default" | "attention"; className?: string; href?: string }) {
  const body = (
    <>
      <span className="block text-sm text-ink-muted">{label}</span>
      <span className="mt-1 block font-display text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-ink">{value}</span>
      {hint ? <span className="mt-0.5 block text-caption text-ink-muted">{hint}</span> : null}
      {progress ? <ProgressBar className="mt-2.5" value={progress.value} max={progress.max} tone={progress.tone ?? "accent"} /> : null}
    </>
  );
  const classes = cn("block rounded-lg border p-4", tone === "attention" ? "border-transparent bg-warning-bg [&_span]:text-warning-fg" : "border-line bg-canvas", href && "transition-colors hover:bg-subtle", className);
  return href ? <Link href={href} className={classes}>{body}</Link> : <div className={classes}>{body}</div>;
}

/* ---------- Skeleton ---------- */

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-muted", className)} />;
}

/* ---------- Page headings ---------- */

export function PageHeader({ kicker, title, description, actions, className }: { kicker?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {kicker ? <p className="mb-1.5 text-body-ui text-ink-muted">{kicker}</p> : null}
        <h1 className="break-words text-h1 text-ink">{title}</h1>
        {description ? <p className="mt-2 max-w-[640px] text-body-ui text-ink-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

export function SectionHeading({ title, description, action, className, as: Heading = "h2" }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; as?: "h2" | "h3" }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <Heading className="text-h4 text-ink">{title}</Heading>
        {description ? <p className="mt-1 text-body-ui text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Settings row: label column (title + helper) on the left, fields on the right. */
export function SettingsRow({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-4 border-b border-line py-6 last:border-b-0 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:gap-10", className)}>
      <div>
        <h3 className="font-sans text-label text-ink">{title}</h3>
        {description ? <p className="mt-1 text-caption text-ink-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ---------- Key/value list ---------- */

export function DetailList({ items, className }: { items: Array<{ label: ReactNode; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]", className)}>
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-overline text-ink-muted">{item.label}</dt>
          <dd className="min-w-0 text-body-ui text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
