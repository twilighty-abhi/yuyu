"use client";

import { useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { EventClientDto } from "@/lib/eventDto";
import { Copy, CopyPlus, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, PrefixInput } from "@/components/ui/field";
import { cloneEvent, deleteEvent, updateEventSlug } from "@/app/actions/event";
import { useToast } from "@/components/feedback/ToastProvider";
import { cn } from "@/lib/cn";

const noSubscription = () => () => {};

/**
 * The page origin once hydrated; "" while rendering on the server and during
 * hydration, so the embed snippets match the server HTML (React #418
 * otherwise) and gain the absolute origin straight after.
 */
function useWindowOrigin() {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

async function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for older browsers.
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

const card =
  "flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-5 sm:p-6";

/** Which sections to show; from the server-computed event capabilities (lib/eventDashboard/capabilities.ts). */
export type EventManageMoreCapabilities = {
  changeAddress: boolean;
  clone: boolean;
  embed: boolean;
  delete: boolean;
};

export function EventManageMore(props: {
  organisationSlug: string;
  event: EventClientDto;
  can: EventManageMoreCapabilities;
}) {
  const { organisationSlug, event, can } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [slug, setSlug] = useState(event.slug);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // A fresh key per opening remounts the dialog so the typed slug always starts empty.
  const [deleteKey, setDeleteKey] = useState(0);

  const origin = useWindowOrigin();
  const publicUrl = useMemo(() => {
    const path = `/${organisationSlug}/${slug}`;
    return origin ? `${origin}${path}` : path;
  }, [origin, organisationSlug, slug]);

  const embedButtonSnippet = useMemo(() => {
    const label = `Register for ${event.title}`;
    return `<a href="${publicUrl}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${label} (opens in a new tab)`)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#ffffff;color:#111111;text-decoration:none;font-family:system-ui;font-weight:600;">${escapeHtml(label)}</a>`;
  }, [event.title, publicUrl]);

  const embedPageSnippet = useMemo(() => {
    const embedUrl = `${origin}/embed/${organisationSlug}/${slug}`;
    return `<iframe src="${embedUrl}" title="${escapeHtml(`${event.title} registration`)}" style="width:100%;height:720px;border:1px solid rgba(255,255,255,0.12);border-radius:16px;overflow:hidden;"></iframe>`;
  }, [event.title, origin, organisationSlug, slug]);

  const doUpdateSlug = () => {
    startTransition(async () => {
      const res = await updateEventSlug({
        organisationSlug,
        eventId: event.id,
        slug,
      });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Event URL updated", "success");
      router.refresh();
    });
  };

  const doClone = () => {
    startTransition(async () => {
      const res = await cloneEvent({ organisationSlug, eventId: event.id });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Event cloned", "success");
      router.push(`/dashboard/${organisationSlug}/event/${res.data!.eventId}`);
    });
  };

  const doDelete = () => {
    startTransition(async () => {
      const res = await deleteEvent({ organisationSlug, eventId: event.id });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      setDeleteOpen(false);
      showToast("Event cancelled", "success");
      router.push(`/dashboard/${organisationSlug}`);
      router.refresh();
    });
  };

  const copySnippet = (value: string) => {
    void copyToClipboard(value).then(() =>
      showToast("Copied embed snippet", "success"),
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {can.changeAddress || can.clone ? (
        <div className="grid gap-5 md:grid-cols-2">
          {can.changeAddress ? (
            <section aria-labelledby="event-address-title" className={card}>
              <h2 id="event-address-title" className="text-h4 text-ink">
                Event address
              </h2>
              <Field
                label="Event address"
                hideLabel
                helperText="Lowercase letters, numbers and hyphens."
              >
                <PrefixInput
                  prefix={`/${organisationSlug}/`}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={pending}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
              </Field>
              <p className="text-caption text-warning-fg">
                Changing it breaks links you&apos;ve already shared.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={doUpdateSlug}
                  disabled={pending || slug.trim() === event.slug}
                >
                  Update
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  startIcon={<Link2 />}
                  onClick={() => {
                    void copyToClipboard(publicUrl).then(() => {
                      showToast("Copied URL", "success");
                    });
                  }}
                  disabled={pending}
                >
                  Copy link
                </Button>
              </div>
            </section>
          ) : null}

          {can.clone ? (
            <section aria-labelledby="event-clone-title" className={card}>
              <h2 id="event-clone-title" className="text-h4 text-ink">
                Run it again
              </h2>
              <p className="text-body-ui text-ink-secondary">
                Make a new event with the same information as this one. Guests
                and invites aren&apos;t copied.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                startIcon={<CopyPlus />}
                onClick={doClone}
                disabled={pending}
              >
                Clone event
              </Button>
            </section>
          ) : null}
        </div>
      ) : null}

      {can.embed ? (
        <section
          aria-labelledby="event-embed-title"
          className={cn(card, "gap-4")}
        >
          <div>
            <h2 id="event-embed-title" className="text-h4 text-ink">
              Put it on your website
            </h2>
            <p className="mt-0.5 text-body-ui text-ink-muted">
              Pick one, copy the code, paste it into your site.
            </p>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <EmbedOption
              title="A register button"
              description={`Shows “Register for ${event.title}” and opens the event page in a new tab.`}
              snippet={embedButtonSnippet}
              copyLabel="Copy button code"
              onCopy={() => copySnippet(embedButtonSnippet)}
              preview={
                <div className="flex min-h-22.5 items-center justify-center rounded-xl bg-subtle p-3">
                  <span className="max-w-full truncate rounded-full border border-line bg-canvas px-4 py-2.5 text-sm font-semibold text-ink">
                    Register for {event.title}
                  </span>
                </div>
              }
            />
            <EmbedOption
              title="The whole event page"
              description="Embeds the event page, including registration, in a frame."
              snippet={embedPageSnippet}
              copyLabel="Copy embed code"
              onCopy={() => copySnippet(embedPageSnippet)}
              preview={
                <div className="flex min-h-22.5 flex-col gap-1.5 rounded-xl bg-subtle p-2.5">
                  <span
                    className="h-7 rounded-lg bg-accent"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle, rgba(255,255,255,0.22) 1.5px, transparent 2px)",
                      backgroundSize: "10px 10px",
                    }}
                  />
                  <span className="h-2 w-3/5 rounded bg-emphasis" />
                  <span className="h-2 w-2/5 rounded bg-emphasis" />
                </div>
              }
            />
          </div>
        </section>
      ) : null}

      {can.delete ? (
        <>
          <section
            aria-labelledby="event-delete-title"
            className="flex flex-col gap-4 rounded-2xl border-[1.5px] border-danger-border bg-canvas p-5 sm:p-6 md:flex-row md:items-center"
          >
            <div className="min-w-0 flex-1">
              <h2 id="event-delete-title" className="text-h4 text-danger-fg">
                Delete event
              </h2>
              <p className="mt-0.5 text-body-ui text-ink-secondary">
                Permanently deletes this event and its registrations. This
                can&apos;t be undone. You&apos;ll type the event address to
                confirm.
              </p>
            </div>
            <Button
              variant="danger"
              className="self-start md:self-auto"
              disabled={pending}
              onClick={() => {
                setDeleteKey((key) => key + 1);
                setDeleteOpen(true);
              }}
            >
              Delete event…
            </Button>
          </section>
          <ConfirmDialog
            key={deleteKey}
            open={deleteOpen}
            title={`Delete ${event.title}?`}
            message="The event and all of its registrations will be permanently removed. This can't be undone."
            confirmLabel="Delete event"
            confirmText={event.slug}
            loading={pending}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={doDelete}
          />
        </>
      ) : null}
    </div>
  );
}

function EmbedOption({
  title,
  description,
  snippet,
  copyLabel,
  onCopy,
  preview,
}: {
  title: string;
  description: string;
  snippet: string;
  copyLabel: string;
  onCopy: () => void;
  preview: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line p-4">
      <h3 className="font-bold text-ink">{title}</h3>
      <div aria-hidden>{preview}</div>
      <p className="text-caption text-ink-muted">{description}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="secondary"
          size="sm"
          startIcon={<Copy />}
          onClick={onCopy}
        >
          {copyLabel}
        </Button>
        <details className="min-w-0 basis-full">
          <summary className="cursor-pointer text-sm font-semibold text-ink-secondary hover:text-ink">
            Show code
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg border border-line bg-subtle p-3 font-mono text-xs text-ink-secondary">
            {snippet}
          </pre>
        </details>
      </div>
    </div>
  );
}
