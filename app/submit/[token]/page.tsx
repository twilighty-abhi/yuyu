import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveEntrantBySubmissionLink } from "@/lib/core/judging";
import { isSubmissionTokenShape } from "@/lib/submissionToken";
import { accentStyle } from "@/lib/theme/accent";
import { SubmissionSection } from "@/components/submission/SubmissionSection";

type Props = {
  params: Promise<{ token: string }>;
};

// The submission link is a bearer capability (docs/HACKATHON.md): render per
// request, never cache (dynamic pages are sent `private, no-store`), never
// index, and never leak the address through Referer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your project",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * A solo registrant's project page, reached from the link emailed on request
 * from their ticket page. A malformed, retired, or foreign token, or an event
 * that does not take submissions, is a plain 404.
 */
export default async function SubmitPage({ params }: Props) {
  const { token } = await params;
  const raw = token?.trim() ?? "";
  if (!isSubmissionTokenShape(raw)) notFound();
  const entrant = await resolveEntrantBySubmissionLink(raw);
  if (!entrant) notFound();
  const [section, accent] = await Promise.all([
    SubmissionSection({ auth: entrant, submissionRef: { submissionToken: raw }, variant: "page" }),
    prisma.event.findUnique({ where: { id: entrant.eventId }, select: { page: { select: { accentColor: true } } } }),
  ]);
  if (!section) notFound();
  return (
    <div style={accentStyle(accent?.page?.accentColor)} className="yy-accent-scope mx-auto flex w-full max-w-[640px] flex-col py-2 sm:py-6">
      {section}
    </div>
  );
}
