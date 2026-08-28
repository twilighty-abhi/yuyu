import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { requireOrgDashboardAccess } from "@/lib/permissions";
import { canViewEventDashboard } from "@/lib/eventAccess";
import { EventManageTabs } from "@/components/dashboard/EventManageTabs";

type Props = {
  params: Promise<{ orgSlug: string; eventId: string }>;
};

function eventDateInput(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { title: true },
  });
  return { title: event ? `Manage · ${event.title}` : "Manage Event" };
}

export default async function EventManagePage({ params }: Props) {
  const { orgSlug, eventId } = await params;
  const access = await requireOrgDashboardAccess(orgSlug);
  const { organisation } = access;

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: organisation.id },
    include: { scheduleItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!event) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: organisation.id, eventId: event.id }))) notFound();

  const rsvps = await prisma.rSVP.findMany({
    where: { eventId: event.id },
    include: {
      user: true,
      answers: { include: { field: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const origin = await getRequestOrigin();
  const attendees = rsvps.map((r) => ({
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
  ] = await Promise.all([
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
  ]);

  const invites = await prisma.eventInvite.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, createdAt: true },
  });

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
          <Link
            href={`/dashboard/${organisation.slug}/event/${event.id}/check-in`}
            style={{ textDecoration: "none" }}
          >
            <Button variant="contained" size="small" sx={{ flexShrink: 0 }}>
              Check-in
            </Button>
          </Link>
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
        event={event}
        attendees={attendees}
        feedbackUrl={`${origin}/${organisation.slug}/${event.slug}/feedback`}
        feedbackForm={feedbackForm}
        feedbackFields={feedbackFields}
        invites={invites.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
        }))}
        registrationFields={registrationFields}
        referenceTime={new Date().toISOString()}
        analytics={{
          total,
          confirmed,
          waitlisted,
          pendingApproval,
          rejected,
          checkedIn,
        }}
        scheduleItems={event.scheduleItems.map((item) => ({ ...item, startDateTime: item.startDateTime.toISOString(), endDateTime: item.endDateTime.toISOString() }))}
        scheduleDate={eventDateInput(event.startDateTime, event.timezone)}
      />
    </Stack>
  );
}
