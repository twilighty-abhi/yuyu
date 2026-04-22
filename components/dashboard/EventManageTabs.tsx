"use client";

import { useState } from "react";
import Link from "next/link";
import type { Event } from "@prisma/client";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Button from "@mui/material/Button";
import { EditEventForm } from "@/components/event/EditEventForm";
import { AttendeeTable, type AttendeeRow } from "@/components/attendees/AttendeeTable";
import { EventInvitePanel } from "@/components/invites/EventInvitePanel";
import { EventManageOverview } from "@/components/dashboard/EventManageOverview";
import { EventAnalyticsPanel } from "@/components/dashboard/EventAnalyticsPanel";
import { EventManageMore } from "@/components/dashboard/EventManageMore";
import {
  EventRegistrationFormEditor,
  type RegistrationFieldRow,
} from "@/components/registration/EventRegistrationFormEditor";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import QrCodeScannerOutlinedIcon from "@mui/icons-material/QrCodeScannerOutlined";

type InviteRow = { id: string; email: string; createdAt: string };

export function EventManageTabs(props: {
  organisationSlug: string;
  event: Event;
  attendees: AttendeeRow[];
  invites: InviteRow[];
  registrationFields: RegistrationFieldRow[];
  analytics: {
    total: number;
    confirmed: number;
    waitlisted: number;
    pendingApproval: number;
    rejected: number;
    checkedIn: number;
  };
}) {
  const { organisationSlug, event, attendees, invites, analytics, registrationFields } = props;
  const [tab, setTab] = useState(0);

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
        <Tab label="Check-in" />
        <Tab label="More" />
      </Tabs>
      {tab === 0 ? (
        <EventManageOverview
          organisationSlug={organisationSlug}
          event={event}
          analytics={analytics}
          invites={invites}
          recentRegistrations={attendees.slice(0, 5)}
          onOpenTab={setTab}
        />
      ) : null}
      {tab === 1 ? (
        <EditEventForm organisationSlug={organisationSlug} event={event} />
      ) : null}
      {tab === 2 ? (
        <AttendeeTable
          organisationSlug={organisationSlug}
          eventId={event.id}
          attendees={attendees}
          canManage
        />
      ) : null}
      {tab === 3 ? (
        <EventAnalyticsPanel analytics={analytics} />
      ) : null}
      {tab === 4 ? (
        <EventInvitePanel
          organisationSlug={organisationSlug}
          eventId={event.id}
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
      {tab === 7 ? (
        <EventManageMore organisationSlug={organisationSlug} event={event} />
      ) : null}
    </>
  );
}
