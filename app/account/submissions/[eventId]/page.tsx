import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/permissions";
import { resolveEntrantForUser } from "@/lib/core/judging";
import { SubmissionSection } from "@/components/submission/SubmissionSection";

type Props = {
  params: Promise<{ eventId: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your project",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * A signed-in entrant's project page, linked from Account → Registrations:
 * any member of a team (the team's shared submission) or the owner of a solo
 * registration. The event id alone grants nothing: it resolves only while
 * this account owns a registration on the event, and anything else is a
 * plain 404.
 */
export default async function AccountSubmissionPage({ params }: Props) {
  // The page authenticates itself; the account layout is not an authorization boundary.
  const session = await requireAuth();
  const { eventId } = await params;
  const entrant = await resolveEntrantForUser(session.user.id, eventId);
  if (!entrant) notFound();
  const section = await SubmissionSection({ auth: entrant, submissionRef: { eventId: entrant.eventId }, variant: "page" });
  if (!section) notFound();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link href="/account/registrations" className="inline-flex min-h-10 items-center gap-1.5 self-start text-[15px] font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" />
        Registrations
      </Link>
      <div className="rounded-2xl border border-line bg-canvas p-5 sm:p-6">{section}</div>
    </div>
  );
}
