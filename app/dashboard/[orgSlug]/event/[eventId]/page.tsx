import { notFound } from "next/navigation";
import { EventPermission } from "@prisma/client";
import Link from "next/link";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { isOrgAdmin, requireOrgDashboardAccess } from "@/lib/permissions";
import { canViewEventDashboard } from "@/lib/eventAccess";
import { EventManageTabs } from "@/components/dashboard/EventManageTabs";
import { EventReportDownloadButton } from "@/components/reports/EventReportDownloadButton";
import { toEventClientDto } from "@/lib/eventDto";

type Props = {
  params: Promise<{ orgSlug: string; eventId: string }>;
};
const MAX_BROWSER_ATTENDEES = 250;

export const metadata = { title: "Manage event", robots: { index: false, follow: false } };

export default async function EventManagePage({ params }: Props) {
  const { orgSlug, eventId } = await params;
  const access = await requireOrgDashboardAccess(orgSlug);
  const { organisation } = access;

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: organisation.id },
    include: { page: { include: { sections: { orderBy: { sortOrder: "asc" } } } }, highlights: { orderBy: { sortOrder: "asc" } }, speakers: { orderBy: { sortOrder: "asc" } }, sponsors: { orderBy: { sortOrder: "asc" } }, resources: { orderBy: { sortOrder: "asc" } }, faqs: { orderBy: { sortOrder: "asc" } }, sessions: { orderBy: { sortOrder: "asc" }, include: { speakers: true } } },
  });
  if (!event) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: organisation.id, eventId: event.id }))) notFound();

  const isAdmin = Boolean(access.membership && isOrgAdmin(access.membership.role));
  const currentGrant = isAdmin ? null : await prisma.eventCollaborator.findFirst({
    where: { eventId: event.id, userId: access.userId },
    select: { permissions: true },
  });
  const hasPermission = (permission: EventPermission) => isAdmin || Boolean(currentGrant?.permissions.includes(permission));
  const canManageRegistrations = hasPermission(EventPermission.MANAGE_REGISTRATIONS);
  const canManageInvitations = hasPermission(EventPermission.MANAGE_INVITATIONS);
  const canCheckIn = hasPermission(EventPermission.CHECK_IN);

  const rsvps = canManageRegistrations ? await prisma.rSVP.findMany({
    where: { eventId: event.id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      answers: { include: { field: true } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_BROWSER_ATTENDEES + 1,
  }) : [];
  const attendeesTruncated = rsvps.length > MAX_BROWSER_ATTENDEES;

  const origin = await getRequestOrigin();
  const attendees = rsvps.slice(0, MAX_BROWSER_ATTENDEES).map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    guestEmail: r.guestEmail,
    guestName: r.guestName,
    user: r.user
      ? { id: r.user.id, name: r.user.name, email: r.user.email }
      : null,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    ticketUrl: `${origin}/ticket/${r.checkInToken}`,
    rawAnswers: r.answers.map((ans) => ({
      fieldId: ans.fieldId,
      valueText: ans.valueText,
      valueBool: ans.valueBool,
      valueNumber: ans.valueNumber,
      valueDate: ans.valueDate?.toISOString() ?? null,
    })),
    answers: (() => {
      const byField: Record<string, { label: string; values: string[] }> = {};
      for (const a of r.answers) {
        const label = a.field.label;
        const key = a.field.id;
        const v =
          a.valueText ??
          (a.valueBool != null ? (a.valueBool ? "Yes" : "No") : null) ??
          (a.valueNumber != null ? String(a.valueNumber) : null) ??
          (a.valueDate != null
            ? new Date(a.valueDate).toLocaleDateString()
            : null);
        if (!v) continue;
        if (!byField[key]) byField[key] = { label, values: [] };
        byField[key]!.values.push(v);
      }
      return Object.values(byField).map((x) => ({
        label: x.label,
        value: x.values.join(", "),
      }));
    })(),
  }));

  const [
    total,
    confirmed,
    waitlisted,
    pendingApproval,
    rejected,
    checkedIn,
  ] = canManageRegistrations ? await Promise.all([
    prisma.rSVP.count({ where: { eventId: event.id } }),
    prisma.rSVP.count({
      where: { eventId: event.id, status: "CONFIRMED" },
    }),
    prisma.rSVP.count({
      where: { eventId: event.id, status: "WAITLISTED" },
    }),
    prisma.rSVP.count({
      where: { eventId: event.id, status: "PENDING_APPROVAL" },
    }),
    prisma.rSVP.count({
      where: { eventId: event.id, status: "REJECTED" },
    }),
    prisma.rSVP.count({
      where: { eventId: event.id, checkedInAt: { not: null } },
    }),
  ]) : [0, 0, 0, 0, 0, 0];

  const invites = canManageInvitations ? await prisma.eventInvite.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, createdAt: true },
  }) : [];

  const [collaborators, pendingCollaboratorInvites] = isAdmin ? await Promise.all([
    prisma.eventCollaborator.findMany({
      where: { eventId: event.id },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.eventCollaboratorInvite.findMany({
      where: { eventId: event.id, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]) : [[], []];

  const form = await prisma.eventRegistrationForm.findUnique({
    where: { eventId: event.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  const registrationFields = (form?.fields ?? []).map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    sortOrder: f.sortOrder,
    options: Array.isArray(f.options)
      ? f.options.filter((x): x is string => typeof x === "string")
      : [],
  }));
  const feedbackFormRecord = await prisma.eventFeedbackForm.findUnique({
    where: { eventId: event.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  const feedbackForm = feedbackFormRecord
    ? { isOpen: feedbackFormRecord.isOpen, title: feedbackFormRecord.title, thankYouMessage: feedbackFormRecord.thankYouMessage, certificateEnabled: feedbackFormRecord.certificateEnabled }
    : null;
  const feedbackFields = (feedbackFormRecord?.fields ?? []).map((field) => ({
    id: field.id, key: field.key, label: field.label, type: field.type, required: field.required, sortOrder: field.sortOrder,
    options: Array.isArray(field.options) ? field.options.filter((value): value is string => typeof value === "string") : [],
  }));

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "stretch", sm: "flex-start" },
          justifyContent: "space-between",
        }}
      >
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          {event.title}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: "center" }}
        >
          {canCheckIn ? <Link
            href={`/dashboard/${organisation.slug}/event/${event.id}/check-in`}
            style={{ textDecoration: "none" }}
          >
            <Button variant="contained" size="small" sx={{ flexShrink: 0 }}>
              Check-in
            </Button>
          </Link> : null}
          {access.membership && isOrgAdmin(access.membership.role) && event.endDateTime < new Date() ? (
            <EventReportDownloadButton href={`/api/reports/event/${event.id}`} />
          ) : null}
          <Link
            href={`/${organisation.slug}/${event.slug}`}
            style={{ textDecoration: "none" }}
          >
            <Button
              variant="outlined"
              size="small"
              endIcon={<OpenInNewIcon />}
              sx={{ flexShrink: 0, alignSelf: { sm: "center" } }}
            >
              Event page
            </Button>
          </Link>
        </Stack>
      </Stack>

      <EventManageTabs
        organisationSlug={organisation.slug}
        event={toEventClientDto(event)}
        attendees={attendees}
        attendeesTruncated={attendeesTruncated}
        feedbackUrl={`${origin}/${organisation.slug}/${event.slug}/feedback`}
        feedbackForm={feedbackForm}
        feedbackFields={feedbackFields}
        invites={invites.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
        }))}
        registrationFields={registrationFields}
        referenceTime={new Date().toISOString()}
website={{ page: event.page, highlights: event.highlights.map((x) => ({ id: x.id, title: x.title, description: x.description, visibility: x.visibility, values: { icon: x.icon, sortOrder: x.sortOrder } })), speakers: event.speakers.map((x) => ({ id: x.id, title: x.name, description: x.bioHtml, visibility: x.visibility, values: { headline: x.headline, organisation: x.organisation, photoUrl: x.photoUrl, websiteUrl: x.websiteUrl, linkedinUrl: x.linkedinUrl, xUrl: x.xUrl, sortOrder: x.sortOrder } })), sponsors: event.sponsors.map((x) => ({ id: x.id, title: x.name, description: x.description, visibility: x.visibility, values: { logoUrl: x.logoUrl, websiteUrl: x.websiteUrl, tier: x.tier, sortOrder: x.sortOrder } })), resources: event.resources.map((x) => ({ id: x.id, title: x.title, description: x.description, visibility: x.visibility, values: { externalUrl: x.externalUrl, sortOrder: x.sortOrder } })), faqs: event.faqs.map((x) => ({ id: x.id, title: x.question, description: x.answerHtml, visibility: x.visibility, values: { sortOrder: x.sortOrder } })) }}
        canManageCollaborators={Boolean(access.membership && isOrgAdmin(access.membership.role))}
        canManageRegistrations={canManageRegistrations}
        canCheckIn={canCheckIn}
        collaborators={collaborators.map((collaborator) => ({ id: collaborator.id, name: collaborator.user.name, email: collaborator.user.email, permissions: collaborator.permissions }))}
        pendingCollaboratorInvites={pendingCollaboratorInvites.map((invite) => ({ id: invite.id, email: invite.email, expiresAt: invite.expiresAt.toISOString() }))}
        analytics={{
          total,
          confirmed,
          waitlisted,
          pendingApproval,
          rejected,
          checkedIn,
        }}
      />
    </Stack>
  );
}
