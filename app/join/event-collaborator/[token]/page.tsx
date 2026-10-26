import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashEventCollaboratorToken } from "@/lib/eventCollaboratorToken";
import { AcceptInviteButton } from "@/components/invites/AcceptInviteButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Co-organiser invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function JoinEventCollaboratorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  const url = `/join/event-collaborator/${encodeURIComponent(token)}`;
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(url)}`);
  const invite = await prisma.eventCollaboratorInvite.findUnique({
    where: { tokenHash: hashEventCollaboratorToken(token) },
    select: { email: true, usedAt: true, expiresAt: true, event: { select: { title: true } }, series: { select: { title: true } } },
  });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !session.user.email || session.user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
    return (
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-2 rounded-2xl border border-line bg-canvas p-6 text-center shadow-raised sm:p-8">
        <h1 className="text-h1 text-ink">Invite unavailable</h1>
        <p className="text-body-ui text-ink-secondary">Sign in with the invited email, or ask an organiser for a new invite.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col gap-4 rounded-2xl border border-line bg-canvas p-6 shadow-raised sm:p-8">
      <p className="text-sm text-ink-muted">Co-organiser invitation</p>
      <h1 className="text-h1 break-words text-ink">{invite.event?.title ?? invite.series?.title ?? "this event"}</h1>
      <p className="rounded-lg bg-muted px-4 py-3 text-body-ui text-ink-secondary">Accept the invitation to help manage <strong className="font-semibold text-ink">{invite.event?.title ?? invite.series?.title ?? "this event"}</strong>.</p>
      <div className="w-full [&>div]:items-stretch [&_button]:w-full">
        <AcceptInviteButton kind="collaborator" token={token} />
      </div>
      <p className="text-center text-caption text-ink-muted">Signed in as {session.user.email}</p>
    </div>
  );
}
