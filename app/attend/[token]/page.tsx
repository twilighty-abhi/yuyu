import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAttendanceTokenShape } from "@/lib/attendanceToken";
import { parseAnswerPreselect } from "@/lib/attendanceCheck";
import { resolveAttendanceCheckByToken } from "@/lib/core/attendanceCheck";
import { safeTimeZone } from "@/lib/timeZone";
import { accentStyle } from "@/lib/theme/accent";
import { formatDayLong, formatTimeRange } from "@/lib/format/datetime";
import { AttendanceReplyForm } from "@/components/attendance/AttendanceReplyForm";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ answer?: string | string[] }>;
};

// The attendance confirmation link is a bearer capability (docs/SECURITY.md):
// render per request, never cache (proxy.ts sends `private, no-store`), never
// index, and never leak the address through Referer (next.config.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Are you still coming?",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * "Are you still coming?" — the guest's answer to the organiser's attendance
 * confirmation email. Shows only this registration's own name, email and
 * answer; never other attendees, the ticket or check-in state. A malformed,
 * rotated or unknown token, or a released registration, is a plain 404.
 */
export default async function AttendPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const raw = token?.trim() ?? "";
  if (!isAttendanceTokenShape(raw)) notFound();
  const view = await resolveAttendanceCheckByToken(raw);
  if (!view) notFound();

  const timeZone = safeTimeZone(view.timezone);
  const when = `${formatDayLong(view.startDateTime, timeZone)} · ${formatTimeRange(view.startDateTime, view.endDateTime, timeZone)}`;
  const where = view.isOnline ? "Online" : view.location.trim() || null;

  return (
    <div style={accentStyle(view.accentColor)} className="yy-accent-scope mx-auto flex w-full max-w-[560px] flex-col gap-5 py-2 sm:py-6">
      <header className="flex flex-col gap-1.5">
        <p className="text-overline text-ink-muted">{view.organisationName}</p>
        <h1 className="text-h1 break-words text-ink">Are you still coming to {view.eventTitle}?</h1>
        <p className="text-body-ui text-ink-secondary">
          The organisers are checking who is still coming so they can plan. It only takes a moment.
        </p>
      </header>

      <section aria-label="Event details" className="rounded-xl border border-line bg-canvas p-5">
        <dl className="grid gap-3">
          <div>
            <dt className="text-overline text-ink-muted">When</dt>
            <dd className="break-words text-[15px] font-bold text-ink">{when}</dd>
          </div>
          {where ? (
            <div>
              <dt className="text-overline text-ink-muted">Where</dt>
              <dd className="break-words text-[15px] font-bold text-ink">{where}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <AttendanceReplyForm
        token={raw}
        attendeeName={view.attendeeName}
        attendeeEmail={view.attendeeEmail}
        teamName={view.teamName}
        initialResponse={view.response}
        initialRespondedAt={view.respondedAt}
        initialNote={view.note}
        preselect={parseAnswerPreselect(query.answer)}
        releaseOnDecline={view.releaseOnDecline}
        closed={view.closed}
        timeZone={timeZone}
      />
    </div>
  );
}
