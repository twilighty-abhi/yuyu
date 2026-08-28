"use client";

import { useState } from "react";
import Link from "next/link";
import type { Event } from "@prisma/client";
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
import QrCodeScannerOutlinedIcon from "@mui/icons-material/QrCodeScannerOutlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import { ManualRsvpDialog } from "@/components/attendees/ManualRsvpDialog";
import { useRouter } from "next/navigation";
import { ScheduleManager } from "@/components/schedule/ScheduleManager";
import { CollaboratorInvitePanel } from "@/components/event/CollaboratorInvitePanel";

type InviteRow = { id: string; email: string; createdAt: string };

export function EventManageTabs(props: {
  organisationSlug: string;
  event: Event;
  attendees: AttendeeRow[];
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
  scheduleItems: Array<{ id: string; title: string; description: string; startDateTime: string; endDateTime: string; delayMinutes: number }>;
  scheduleDate: string;
}) {
  const { organisationSlug, event, attendees, invites, analytics, registrationFields, feedbackUrl, feedbackForm, feedbackFields, referenceTime, scheduleItems, scheduleDate } = props;
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
        <Tab label="Details" />
        <Tab label="Attendees" />
        <Tab label="Analytics" />
        <Tab label="Invites" />
        <Tab label="Registration form" />
        <Tab label="Feedback" />
        <Tab label="Schedule" />
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
      {tab === 1 ? (
        <EditEventForm organisationSlug={organisationSlug} event={event} />
      ) : null}
      {tab === 2 ? (
        <Stack spacing={2}>
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
        </Stack>
      ) : null}
      {tab === 3 ? (
        <EventAnalyticsPanel analytics={analytics} />
      ) : null}
      {tab === 4 ? (
        <EventInvitePanel
          organisationSlug={organisationSlug}
          eventId={event.id}
          eventHasEnded={event.endDateTime <= new Date()}
          invites={invites}
        />
      ) : null}
      {tab === 5 ? (
        <EventRegistrationFormEditor
          organisationSlug={organisationSlug}
          eventId={event.id}
          fields={registrationFields}
        />
      ) : null}
      {tab === 6 ? (
        <FeedbackFormEditor organisationSlug={organisationSlug} eventId={event.id} feedbackUrl={feedbackUrl} form={feedbackForm} fields={feedbackFields} />
      ) : null}
      {tab === 7 ? <ScheduleManager organisationSlug={organisationSlug} eventId={event.id} items={scheduleItems} defaultDate={scheduleDate} /> : null}
      {tab === 8 ? (
        <Stack spacing={2}>
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
        </Stack>
      ) : null}
      {tab === 9 ? (
        <Stack spacing={2}><CollaboratorInvitePanel organisationSlug={organisationSlug} eventId={event.id} /><EventManageMore organisationSlug={organisationSlug} event={event} /></Stack>
      ) : null}
    </>
  );
}
