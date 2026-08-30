"use client";

import { useState } from "react";
import Link from "next/link";
import type { EventPermission } from "@prisma/client";
import type { EventClientDto } from "@/lib/eventDto";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Button from "@mui/material/Button";
import { EditEventForm } from "@/components/event/EditEventForm";
import { AttendeeTable, type AttendeeRow } from "@/components/attendees/AttendeeTable";
import { ExportCsvButton } from "@/components/attendees/ExportCsvButton";
import { EventInvitePanel } from "@/components/invites/EventInvitePanel";
import { EventManageOverview } from "@/components/dashboard/EventManageOverview";
import { EventAnalyticsPanel } from "@/components/dashboard/EventAnalyticsPanel";
import { EventManageMore } from "@/components/dashboard/EventManageMore";
import { FeedbackFormEditor } from "@/components/feedback/FeedbackFormEditor";
import {
  EventRegistrationFormEditor,
  type RegistrationFieldRow,
} from "@/components/registration/EventRegistrationFormEditor";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import QrCodeScannerOutlinedIcon from "@mui/icons-material/QrCodeScannerOutlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import { ManualRsvpDialog } from "@/components/attendees/ManualRsvpDialog";
import { useRouter } from "next/navigation";
import { CollaboratorInvitePanel } from "@/components/event/CollaboratorInvitePanel";
import { EventWebsiteManager } from "@/components/event/EventWebsiteManager";
import { EventWebsiteReleaseControl } from "@/components/event/EventWebsiteReleaseControl";

type InviteRow = { id: string; email: string; createdAt: string };

export function EventManageTabs(props: {
  organisationSlug: string;
  event: EventClientDto;
  attendees: AttendeeRow[];
  attendeesTruncated: boolean;
  invites: InviteRow[];
  registrationFields: RegistrationFieldRow[];
  feedbackUrl: string;
  feedbackForm: { isOpen: boolean; title: string; thankYouMessage: string; certificateEnabled: boolean } | null;
  feedbackFields: RegistrationFieldRow[];
  referenceTime: string;
  analytics: {
    total: number;
    confirmed: number;
    waitlisted: number;
    pendingApproval: number;
    rejected: number;
    checkedIn: number;
  };
  website: { page: { isPublished: boolean; tagline: string; logoUrl: string | null; accentColor: string | null; aboutHtml: string; sections: Array<{ type: string; isVisible: boolean; sortOrder: number }> } | null; highlights: Array<{ id: string; title: string; description: string; visibility: string; values: Record<string, string | number | null> }>; speakers: Array<{ id: string; title: string; description: string; visibility: string; values: Record<string, string | number | null> }>; sponsors: Array<{ id: string; title: string; description: string; visibility: string; values: Record<string, string | number | null> }>; resources: Array<{ id: string; title: string; description: string; visibility: string; values: Record<string, string | number | null> }>; faqs: Array<{ id: string; title: string; description: string; visibility: string; values: Record<string, string | number | null> }> };
  canManageCollaborators: boolean;
  collaborators: Array<{ id: string; name: string | null; email: string | null; permissions: EventPermission[] }>;
  pendingCollaboratorInvites: Array<{ id: string; email: string; expiresAt: string }>;
  canManageRegistrations: boolean;
  canCheckIn: boolean;
}) {
  const { organisationSlug, event, attendees, attendeesTruncated, invites, analytics, registrationFields, feedbackUrl, feedbackForm, feedbackFields, referenceTime, website, canManageCollaborators, canManageRegistrations, canCheckIn, collaborators, pendingCollaboratorInvites } = props;
  const [tab, setTab] = useState(0);
  const [manualRsvpOpen, setManualRsvpOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab label="Overview" />
        <Tab label="Event Page & Program" />
        <Tab label="Details" />
        <Tab label="Attendees" />
        <Tab label="Analytics" />
        <Tab label="Invites" />
        <Tab label="Registration form" />
        <Tab label="Feedback" />
        <Tab label="Check-in" />
        <Tab label="More & delete" />
      </Tabs>
      {tab === 0 ? (
        <EventManageOverview
          organisationSlug={organisationSlug}
          event={event}
          analytics={analytics}
          invites={invites}
          recentRegistrations={attendees.slice(0, 5)}
          referenceTime={referenceTime}
          onOpenTab={setTab}
        />
      ) : null}
      {tab === 1 ? <Stack spacing={3}><Paper variant="outlined" sx={{ p: 2.5 }}><Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}><div><Typography variant="h6">Programme schedule</Typography><Typography variant="body2" color="text.secondary">Add sessions, adjust planned times, and apply live cascading delays from the dedicated schedule workspace.</Typography></div><Button component={Link} href={`/dashboard/${organisationSlug}/event/${event.id}/schedule`} variant="outlined">Open schedule</Button></Stack></Paper><EventWebsiteManager organisationSlug={organisationSlug} eventId={event.id} eventSlug={event.slug} {...website} /></Stack> : null}
      {tab === 2 ? (
        <Stack spacing={3}>
          <EventWebsiteReleaseControl
            organisationSlug={organisationSlug}
            eventId={event.id}
            isPublished={website.page?.isPublished ?? false}
          />
          <EditEventForm organisationSlug={organisationSlug} event={event} />
        </Stack>
      ) : null}
      {tab === 3 ? (
        <Stack spacing={2}>
          {!canManageRegistrations ? <Typography color="text.secondary">You do not have permission to view or manage attendee registrations.</Typography> : null}
          {canManageRegistrations ? <>
          {attendeesTruncated ? <Alert severity="warning">This browser view and its CSV/email exports are limited to the 250 most recent registrations. Use a tenant API client with participant scope for a complete, paginated dataset.</Alert> : null}
          <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button variant="contained" startIcon={<PersonAddOutlinedIcon />} onClick={() => setManualRsvpOpen(true)}>
              Add attendee
            </Button>
            <ExportCsvButton eventTitle={event.title} attendees={attendees} />
          </Stack>
          {manualRsvpOpen ? (
            <ManualRsvpDialog
              organisationSlug={organisationSlug}
              eventId={event.id}
              fields={registrationFields}
              onClose={() => setManualRsvpOpen(false)}
              onAdded={() => router.refresh()}
            />
          ) : null}
          <AttendeeTable
            organisationSlug={organisationSlug}
            eventId={event.id}
            attendees={attendees}
            canManage
            registrationFields={registrationFields}
            eventTitle={event.title}
          />
          </> : null}
        </Stack>
      ) : null}
      {tab === 4 ? (
        <EventAnalyticsPanel analytics={analytics} />
      ) : null}
      {tab === 5 ? (
        <EventInvitePanel
          organisationSlug={organisationSlug}
          eventId={event.id}
          eventHasEnded={event.endDateTime <= new Date()}
          invites={invites}
        />
      ) : null}
      {tab === 6 ? (
        <EventRegistrationFormEditor
          organisationSlug={organisationSlug}
          eventId={event.id}
          fields={registrationFields}
        />
      ) : null}
      {tab === 7 ? (
        <FeedbackFormEditor organisationSlug={organisationSlug} eventId={event.id} feedbackUrl={feedbackUrl} form={feedbackForm} fields={feedbackFields} />
      ) : null}
      {tab === 8 ? (
        <Stack spacing={2}>
          {!canCheckIn ? <Typography color="text.secondary">You do not have permission to operate check-in.</Typography> : null}
          {canCheckIn ? (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
              <QrCodeScannerOutlinedIcon color="primary" sx={{ fontSize: 40 }} />
              <Typography variant="h6" component="h2">
                Check-in station
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Scan attendee QR codes from their ticket page, paste ticket URLs,
                search by name, and export who arrived. Use override for waitlist
                or pending approvals at the door.
              </Typography>
              <Button
                component={Link}
                href={`/dashboard/${organisationSlug}/event/${event.id}/check-in`}
                variant="contained"
                size="large"
              >
                Open check-in page
              </Button>
            </Stack>
          </Paper>
          ) : null}
        </Stack>
      ) : null}
      {tab === 9 ? (
        <Stack spacing={2}>{canManageCollaborators ? <CollaboratorInvitePanel organisationSlug={organisationSlug} eventId={event.id} collaborators={collaborators} pendingInvites={pendingCollaboratorInvites} /> : null}<EventManageMore organisationSlug={organisationSlug} event={event} /></Stack>
      ) : null}
    </>
  );
}
