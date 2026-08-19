"use client";

import type { Event } from "@prisma/client";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import EditCalendarOutlinedIcon from "@mui/icons-material/EditCalendarOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import MailOutlineOutlinedIcon from "@mui/icons-material/MailOutlineOutlined";
import QrCodeScannerOutlinedIcon from "@mui/icons-material/QrCodeScannerOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import type { AttendeeRow } from "@/components/attendees/AttendeeTable";
import { PublishEventButton } from "@/components/event/PublishEventButton";

function asDate(value: Event["startDateTime"]): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function formatRecapWhen(start: Date, end: Date, timeZone: string) {
  const primary = start.toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
  const endT =
    start.toDateString() === end.toDateString()
      ? end.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        })
      : end.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        });
  return { primary, endHint: `Ends ${endT}` };
}

function privacyLabel(p: Event["privacyType"]) {
  switch (p) {
    case "PUBLIC":
      return "Public";
    case "HIDDEN_LINK":
      return "Hidden link";
    case "APPROVAL_REQUIRED":
      return "Approval required";
    case "INVITE_ONLY":
      return "Invite only";
    default:
      return p;
  }
}

function statusLabel(s: AttendeeRow["status"]) {
  switch (s) {
    case "CONFIRMED":
      return "Confirmed";
    case "WAITLISTED":
      return "Waitlisted";
    case "PENDING_APPROVAL":
      return "Pending";
    case "REJECTED":
      return "Rejected";
    default:
      return s;
  }
}

function attendeeLabel(row: AttendeeRow) {
  return row.user?.name?.trim() || row.user?.email || row.guestEmail || "Guest";
}

function attendeeEmail(row: AttendeeRow) {
  return row.user?.email ?? row.guestEmail ?? "—";
}

function initials(row: AttendeeRow) {
  const n = attendeeLabel(row);
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return n.slice(0, 2).toUpperCase();
}

type InviteRow = { id: string; email: string; createdAt: string };

export function EventManageOverview(props: {
  organisationSlug: string;
  event: Event;
  analytics: {
    total: number;
    confirmed: number;
    waitlisted: number;
    pendingApproval: number;
    rejected: number;
    checkedIn: number;
  };
  invites: InviteRow[];
  recentRegistrations: AttendeeRow[];
  onOpenTab: (index: number) => void;
}) {
  const { organisationSlug, event, analytics, invites, recentRegistrations, onOpenTab } =
    props;
  const start = asDate(event.startDateTime);
  const end = asDate(event.endDateTime);
  const now = new Date();
  const hasEnded = end < now;
  const isDraft = event.status === "DRAFT";

  const { primary: whenPrimary, endHint } = formatRecapWhen(
    start,
    end,
    event.timezone,
  );

  const cap = event.capacity ?? null;
  const fillPct =
    cap && cap > 0
      ? Math.min(100, Math.round((analytics.confirmed / cap) * 100))
      : null;

  const publicHref = `/${organisationSlug}/${event.slug}`;

  const shortcuts = [
    {
      tab: 1,
      title: "Details",
      description: "Title, schedule, location, cover image, and publishing.",
      icon: EditCalendarOutlinedIcon,
    },
    {
      tab: 2,
      title: "Attendees",
      description: "RSVPs, approvals, waitlist, and guest management.",
      icon: GroupsOutlinedIcon,
    },
    {
      tab: 3,
      title: "Analytics",
      description: "Response counts and pipeline at a glance.",
      icon: InsightsOutlinedIcon,
    },
    {
      tab: 4,
      title: "Invites",
      description: "Email invites and outreach for this event.",
      icon: MailOutlineOutlinedIcon,
    },
    {
      tab: 5,
      title: "Check-in",
      description: "QR scanning, manual codes, search, and attendance export.",
      icon: QrCodeScannerOutlinedIcon,
    },
  ] as const;

  return (
    <Stack spacing={3}>
      {isDraft ? (
        <Paper
          variant="outlined"
          sx={{
            p: 3,
            borderRadius: "12px",
            backgroundColor: "#1C1C1E",
            borderColor: "rgba(255, 255, 255, 0.08)",
            boxShadow: "none",
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{
              justifyContent: "space-between",
              alignItems: { xs: "stretch", sm: "center" },
            }}
          >
            <Stack spacing={0.5}>
              <Typography variant="body1" sx={{ fontWeight: 600, color: "#FFFFFF" }}>
                This event is currently in Draft
              </Typography>
              <Typography variant="body2" sx={{ color: "#8E8E93" }}>
                Publish this event to allow guests to register, view details, and receive tickets.
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => onOpenTab(1)}
                sx={{
                  color: "#FFFFFF",
                  borderColor: "rgba(255, 255, 255, 0.12)",
                  textTransform: "none",
                  fontWeight: 600,
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    borderColor: "rgba(255, 255, 255, 0.2)",
                  },
                }}
              >
                Edit Details
              </Button>
              <PublishEventButton
                organisationSlug={organisationSlug}
                eventSlug={event.slug}
              />
            </Stack>
          </Stack>
        </Paper>
      ) : null}
      {hasEnded && !isDraft ? (
        <Alert severity="success" variant="outlined">
          This event has ended. Thank you for hosting.
        </Alert>
      ) : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: "100%" }}>
            <Stack spacing={1.5}>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <Typography variant="subtitle2" color="text.secondary">
                  Event recap
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.75}
                  useFlexGap
                  sx={{ flexWrap: "wrap" }}
                >
                  {event.status !== "PUBLISHED" ? (
                    <Chip size="small" label={event.status} variant="outlined" />
                  ) : null}
                  <Chip
                    size="small"
                    label={privacyLabel(event.privacyType)}
                    variant="outlined"
                  />
                </Stack>
              </Stack>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "flex-start" }}
              >
                <CalendarMonthOutlinedIcon
                  sx={{ mt: 0.25, color: "text.secondary", fontSize: 20 }}
                />
                <Box>
                  <Typography variant="body2">{whenPrimary}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {endHint}
                  </Typography>
                </Box>
              </Stack>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "flex-start" }}
              >
                {event.isOnline ? (
                  <VideocamOutlinedIcon
                    sx={{ mt: 0.25, color: "text.secondary", fontSize: 20 }}
                  />
                ) : (
                  <PlaceOutlinedIcon
                    sx={{ mt: 0.25, color: "text.secondary", fontSize: 20 }}
                  />
                )}
                <Typography variant="body2">
                  {event.isOnline
                    ? "Online event"
                    : event.location.trim() || "Location TBD"}
                </Typography>
              </Stack>
              <Divider />
              <Stack
                direction="row"
                spacing={2}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Confirmed
                  </Typography>
                  <Typography variant="h5" component="p">
                    {analytics.confirmed}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Capacity
                  </Typography>
                  <Typography variant="h5" component="p">
                    {cap ?? "—"}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Total responses
                  </Typography>
                  <Typography variant="h5" component="p">
                    {analytics.total}
                  </Typography>
                </Box>
              </Stack>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: "100%" }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Guests
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              <Box component="span" sx={{ fontWeight: 600 }}>
                {analytics.confirmed} going
              </Box>
              {cap != null ? (
                <Box component="span" color="text.secondary">
                  {" "}
                  · cap {cap}
                </Box>
              ) : null}
            </Typography>
            {fillPct != null ? (
              <LinearProgress
                variant="determinate"
                value={fillPct}
                sx={{
                  height: 8,
                  borderRadius: 1,
                  mb: 1,
                  "& .MuiLinearProgress-bar": { borderRadius: 1 },
                }}
                color={fillPct >= 100 ? "warning" : "success"}
              />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Set a capacity in Details to track fill.
              </Typography>
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block" }}
            >
              {analytics.waitlisted} waitlisted · {analytics.pendingApproval}{" "}
              pending approval
              {analytics.rejected > 0
                ? ` · ${analytics.rejected} rejected`
                : ""}
            </Typography>
            <Button
              size="small"
              sx={{ mt: 1.5 }}
              onClick={() => onOpenTab(2)}
              endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
            >
              All guests
            </Button>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            alignItems: { xs: "stretch", sm: "flex-start" },
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Invites
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Invite subscribers and contacts by email. Track outreach from the
              Invites tab.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              <strong>{invites.length}</strong> email invites sent
            </Typography>
          </Box>
          <Button
            variant="contained"
            onClick={() => onOpenTab(4)}
            sx={{ alignSelf: { sm: "center" }, flexShrink: 0 }}
          >
            Invite guests
          </Button>
        </Stack>
        {invites.length > 0 ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Recent invitations
            </Typography>
            <Stack divider={<Divider flexItem />} spacing={1}>
              {invites.slice(0, 5).map((inv) => (
                <Stack
                  key={inv.id}
                  direction="row"
                  spacing={1}
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                    {inv.email}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(inv.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>
        ) : null}
      </Paper>

      <Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1.5,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Recent registrations
          </Typography>
          <Button size="small" onClick={() => onOpenTab(2)}>
            All guests →
          </Button>
        </Stack>
        {recentRegistrations.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography color="text.secondary" variant="body2">
              No registrations yet. Share your event page to collect RSVPs.
            </Typography>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ overflow: "hidden" }}>
            <Stack divider={<Divider />} spacing={0}>
              {recentRegistrations.map((row) => (
                <Stack
                  key={row.id}
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: "center", px: 2, py: 1.25 }}
                >
                  <Avatar sx={{ width: 36, height: 36, fontSize: 14 }}>
                    {initials(row)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {attendeeLabel(row)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {attendeeEmail(row)}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={statusLabel(row.status)}
                    color={
                      row.status === "CONFIRMED"
                        ? "success"
                        : row.status === "WAITLISTED"
                          ? "info"
                          : row.status === "PENDING_APPROVAL"
                            ? "warning"
                            : "default"
                    }
                    variant="outlined"
                    sx={{ display: { xs: "none", sm: "flex" } }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: { xs: "none", md: "block" }, flexShrink: 0 }}
                  >
                    {new Date(row.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
          Manage this event
        </Typography>
        <Grid container spacing={2}>
          {shortcuts.map((s) => {
            const Icon = s.icon;
            return (
              <Grid size={{ xs: 12, sm: 6 }} key={s.tab}>
                <Card variant="outlined" sx={{ height: "100%" }}>
                  <CardActionArea onClick={() => onOpenTab(s.tab)}>
                    <CardContent>
                      <Stack
                        direction="row"
                        spacing={1.5}
                        sx={{ alignItems: "flex-start" }}
                      >
                        <Icon color="primary" />
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {s.title}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 0.5 }}
                          >
                            {s.description}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="primary"
                            sx={{ mt: 1, fontWeight: 500 }}
                          >
                            Open
                          </Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Box>

      <Paper
        variant="outlined"
        sx={{
          p: 2,
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Preview the public event page as guests see it.
        </Typography>
        <Button
          component={Link}
          href={publicHref}
          variant="outlined"
          endIcon={<OpenInNewIcon />}
          sx={{ flexShrink: 0 }}
        >
          Event page
        </Button>
      </Paper>
    </Stack>
  );
}
