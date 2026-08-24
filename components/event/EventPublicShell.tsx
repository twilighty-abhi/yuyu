"use client";

import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import Avatar from "@mui/material/Avatar";
import AvatarGroup from "@mui/material/AvatarGroup";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Rating from "@mui/material/Rating";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import CalendarTodayOutlinedIcon from "@mui/icons-material/CalendarTodayOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import { RsvpForm } from "@/components/rsvp/RsvpForm";
import { CancelRsvpButton } from "@/components/ticket/CancelRsvpButton";
import type { RegistrationFieldDefinition } from "@/components/rsvp/registrationTypes";

export type EventPublicAvatar = {
  id: string;
  label: string;
  imageUrl: string | null;
};

type Props = {
  orgSlug: string;
  orgName: string;
  orgDescription: string;
  event: {
    id: string;
    slug: string;
    title: string;
    description: string;
    coverImageUrl: string | null;
    location: string;
    mapLinkUrl: string | null;
    isOnline: boolean;
    timezone: string;
    status: string;
    privacyType: string;
    capacity: number | null;
    showRegistrationCount: boolean;
  };
  confirmedCount: number | null;
  showRsvp: boolean;
  full: boolean;
  canManage: boolean;
  isPast: boolean;
  datePrimary: string;
  timeRange: string;
  tzLabel: string;
  attendeeSummary: string;
  avatars: EventPublicAvatar[];
  registrationFields: RegistrationFieldDefinition[];
};

function stringAvatar(name: string) {
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length >= 2
      ? `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase()
      : (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return initials;
}

export function EventPublicShell(props: Props) {
  const {
    orgSlug,
    orgName,
    orgDescription,
    event,
    confirmedCount,
    showRsvp,
    full,
    canManage,
    isPast,
    datePrimary,
    timeRange,
    tzLabel,
    attendeeSummary,
    avatars,
    registrationFields,
  } = props;

  const lsKey = `yuyu:rsvp:${orgSlug}:e:${event.slug}`;
  const feedbackKey = `yuyu:feedback:${orgSlug}:e:${event.slug}`;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [localTicketToken] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = window.localStorage.getItem(lsKey);
      const parsed = saved ? (JSON.parse(saved) as { ticketToken?: string }) : null;
      return parsed?.ticketToken ?? "";
    } catch {
      return "";
    }
  });
  const [feedbackOpen, setFeedbackOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const fb = window.localStorage.getItem(feedbackKey);
      const already = Boolean(fb);
      if (!isPast || already) return false;
      const saved = window.localStorage.getItem(lsKey);
      const parsed = saved ? (JSON.parse(saved) as { ticketToken?: string }) : null;
      return Boolean(parsed?.ticketToken);
    } catch {
      return false;
    }
  });
  const [stars, setStars] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const publicConfirmedCount = confirmedCount ?? 0;
  const goingLabel = isPast ? "went" : "going";
  const hasLocalTicket = mounted && Boolean(localTicketToken);

  return (
    <Box
      sx={{
        minHeight: "70vh",
        py: { xs: 2, md: 4 },
        bgcolor: (theme) =>
          theme.palette.mode === "dark"
            ? "rgba(30, 58, 50, 0.35)"
            : "rgba(232, 245, 240, 0.85)",
        borderRadius: { md: 3 },
        px: { xs: 0, md: 2 },
        width: "100%",
        maxWidth: "100%",
        overflowX: "hidden",
      }}
    >
      <Grid
        container
        spacing={{ xs: 2, md: 3 }}
        sx={{ alignItems: "flex-start", minWidth: 0, width: "100%" }}
      >
        <Grid size={{ xs: 12, md: 4 }} sx={{ minWidth: 0 }}>
          <Stack spacing={2.5} sx={{ position: { md: "sticky" }, top: { md: 88 }, minWidth: 0 }}>
            <Paper
              elevation={0}
              sx={{
                borderRadius: 3,
                overflow: "hidden",
                bgcolor: "background.paper",
                boxShadow: (t) =>
                  t.palette.mode === "dark"
                    ? "0 4px 24px rgba(0,0,0,0.35)"
                    : "0 4px 24px rgba(15, 80, 60, 0.08)",
              }}
            >
              {event.coverImageUrl ? (
                <Box
                  component="img"
                  src={event.coverImageUrl}
                  alt=""
                  sx={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <Box
                  sx={{
                    aspectRatio: "1 / 1",
                    bgcolor: "primary.light",
                    opacity: 0.35,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Typography
                    variant="h5"
                    color="primary.dark"
                    sx={{ px: 2, textAlign: "center", maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}
                  >
                    {event.title}
                  </Typography>
                </Box>
              )}
            </Paper>

            {canManage ? (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "background.paper" }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  You have manage access for this event.
                </Typography>
                <Button
                  component={Link}
                  href={`/dashboard/${orgSlug}/event/${event.id}`}
                  variant="contained"
                  fullWidth
                  sx={{ borderRadius: 999 }}
                >
                  Manage
                </Button>
              </Paper>
            ) : null}

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: "background.paper" }}>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.08 }}>
                Presented by
              </Typography>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ mt: 1, mb: 1, alignItems: "center" }}
              >
                <Avatar sx={{ bgcolor: "primary.main", width: 40, height: 40 }}>
                  {orgName.slice(0, 1)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {orgName}
                  </Typography>
                </Box>
              </Stack>
              <Button
                component={Link}
                href={`/${orgSlug}`}
                variant="outlined"
                size="small"
                fullWidth
                sx={{ mt: 1, borderRadius: 999 }}
              >
                View organisation
              </Button>
              {orgDescription ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2, lineHeight: 1.6 }}>
                  {orgDescription.length > 220
                    ? `${orgDescription.slice(0, 217)}…`
                    : orgDescription}
                </Typography>
              ) : null}
            </Paper>

            {event.showRegistrationCount ? (
              <Paper
                variant="outlined"
                sx={{ p: 2.5, borderRadius: 2, bgcolor: "background.paper" }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                  {publicConfirmedCount} {goingLabel}
                </Typography>
                {avatars.length > 0 ? (
                  <Stack spacing={1.5}>
                    <AvatarGroup
                      max={8}
                      sx={{
                        justifyContent: "flex-start",
                        "& .MuiAvatar-root": {
                          width: 36,
                          height: 36,
                          fontSize: "0.85rem",
                          border: "2px solid",
                          borderColor: "background.paper",
                        },
                      }}
                    >
                      {avatars.map((a) => (
                        <Avatar
                          key={a.id}
                          src={a.imageUrl ?? undefined}
                          alt=""
                          sx={{ bgcolor: "secondary.main" }}
                        >
                          {stringAvatar(a.label)}
                        </Avatar>
                      ))}
                    </AvatarGroup>
                    {attendeeSummary &&
                    attendeeSummary !== `${publicConfirmedCount} ${goingLabel}` ? (
                      <Typography variant="body2" color="text.secondary">
                        {attendeeSummary}
                      </Typography>
                    ) : null}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {publicConfirmedCount > 0 ? "Attendee details are private." : "Be the first to RSVP."}
                  </Typography>
                )}
              </Paper>
            ) : null}
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }} sx={{ minWidth: 0 }}>
          <Stack spacing={3} sx={{ minWidth: 0 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="primary" sx={{ fontWeight: 600, display: "block", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {orgName}
              </Typography>
              <Typography
                variant="h3"
                component="h1"
                sx={{
                  fontWeight: 850,
                  letterSpacing: "-0.03em",
                  mt: 0.5,
                  lineHeight: 1.12,
                  maxWidth: "100%",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  fontSize: { xs: "2.25rem", sm: "2.75rem", md: "3.25rem" },
                }}
              >
                {event.title}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 2 }}>
                {event.isOnline ? (
                  <Chip
                    icon={<VideocamOutlinedIcon sx={{ fontSize: 16 }} />}
                    label="Online"
                    size="small"
                  />
                ) : null}
                {event.status === "DRAFT" ? (
                  <Chip label="Draft preview" color="warning" size="small" />
                ) : null}
                {event.privacyType === "HIDDEN_LINK" ? (
                  <Chip label="Hidden link" size="small" variant="outlined" />
                ) : null}
                {event.privacyType === "INVITE_ONLY" ? (
                  <Chip label="Invite only" size="small" variant="outlined" />
                ) : null}
                {event.privacyType === "APPROVAL_REQUIRED" ? (
                  <Chip label="Approval required" size="small" variant="outlined" />
                ) : null}
              </Stack>
            </Box>

            <Stack spacing={2}>
              <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                <CalendarTodayOutlinedIcon color="primary" sx={{ mt: 0.25 }} />
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {datePrimary}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {timeRange} · {tzLabel}
                  </Typography>
                </Box>
              </Stack>
              {!event.isOnline && event.location ? (
                <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                  <PlaceOutlinedIcon color="primary" sx={{ mt: 0.25 }} />
                  <Typography variant="body1" sx={{ lineHeight: 1.6 }}>
                    {event.location}
                  </Typography>
                </Stack>
              ) : event.isOnline ? (
                <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                  <VideocamOutlinedIcon color="primary" sx={{ mt: 0.25 }} />
                  <Typography variant="body2" color="text.secondary">
                    Online event
                  </Typography>
                </Stack>
              ) : null}
            </Stack>

            {isPast ? (
              <Paper
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  bgcolor: (t) =>
                    t.palette.mode === "dark" ? "rgba(103, 80, 164, 0.2)" : "rgba(103, 80, 164, 0.08)",
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Thank you for joining
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  This event has ended. We hope you enjoyed it.
                </Typography>
              </Paper>
            ) : null}

            {event.description ? (
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                  About this event
                </Typography>
                <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }}>
                  {event.description}
                </Typography>
              </Box>
            ) : null}

            {!event.isOnline && event.location ? (
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  bgcolor: "background.paper",
                }}
              >
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 750 }}>
                      Location
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5, lineHeight: 1.7, overflowWrap: "anywhere", wordBreak: "break-word" }}
                    >
                      {event.location}
                    </Typography>
                  </Box>
                  <Button
                    component={Link}
                    href={
                      event.mapLinkUrl?.trim()
                        ? event.mapLinkUrl
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    size="small"
                    variant="outlined"
                    sx={{ borderRadius: 999, flexShrink: 0, alignSelf: { xs: "flex-start", sm: "center" } }}
                  >
                    Open in Maps
                  </Button>
                </Stack>
                <Box
                  sx={{
                    mt: 2,
                    borderRadius: 2,
                    overflow: "hidden",
                    border: "1px solid",
                    borderColor: "divider",
                    height: { xs: 220, sm: 260 },
                  }}
                >
                  <Box
                    component="iframe"
                    title="Map"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    sx={{ border: 0, width: "100%", height: "100%", display: "block" }}
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(event.location)}&output=embed`}
                  />
                </Box>
                {event.mapLinkUrl?.trim() ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.25 }}>
                    Tip: Share this map link with friends for easy directions.
                  </Typography>
                ) : null}
              </Paper>
            ) : null}

            {showRsvp ? (
              <Paper
                variant="outlined"
                sx={{
                  p: 3,
                  borderRadius: 2,
                  bgcolor: "background.paper",
                }}
              >
                <Stack spacing={1.25}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Registration
                  </Typography>
                  {full ? (
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                      Capacity full — you can join the waitlist.
                    </Typography>
                  ) : null}
                  {hasLocalTicket ? (
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                      <Button
                        component={Link}
                        href={`/ticket/${localTicketToken}`}
                        variant="outlined"
                        size="small"
                        sx={{ borderRadius: 999 }}
                      >
                        View ticket
                      </Button>
                      <CancelRsvpButton
                        checkInToken={localTicketToken}
                        eventPageHref={`/${orgSlug}/${event.slug}`}
                      />
                    </Stack>
                  ) : (
                    <Button
                      variant="contained"
                      size="large"
                      onClick={() => setRegisterOpen(true)}
                      sx={{ borderRadius: 999, alignSelf: "flex-start" }}
                    >
                      Register
                    </Button>
                  )}
                </Stack>

                <Dialog
                  open={registerOpen}
                  onClose={() => setRegisterOpen(false)}
                  fullWidth
                  maxWidth="sm"
                  slotProps={{
                    backdrop: {
                      sx: {
                        backdropFilter: "blur(10px)",
                        backgroundColor: "rgba(0,0,0,0.55)",
                      },
                    },
                    paper: {
                      sx: {
                        borderRadius: 4,
                        overflow: "hidden",
                      },
                    },
                  }}
                >
                  <DialogTitle sx={{ fontWeight: 750, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    Register · {event.title}
                  </DialogTitle>
                  <DialogContent sx={{ pt: 1 }}>
                    <Stack spacing={1.5}>
                      {full ? (
                        <Typography variant="body2" color="text.secondary">
                          Capacity full — you can join the waitlist.
                        </Typography>
                      ) : null}
                      {!event.isOnline && event.mapLinkUrl?.trim() ? (
                        <Button
                          component={Link}
                          href={event.mapLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          size="small"
                          variant="text"
                          sx={{
                            px: 0,
                            borderRadius: 999,
                            alignSelf: "flex-start",
                          }}
                        >
                          View venue on map
                        </Button>
                      ) : null}
                      <Divider />
                      <RsvpForm
                        orgSlug={orgSlug}
                        eventSlug={event.slug}
                        registrationFields={registrationFields}
                      />
                    </Stack>
                  </DialogContent>
                  <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setRegisterOpen(false)} color="inherit">
                      Close
                    </Button>
                  </DialogActions>
                </Dialog>

                <Dialog
                  open={feedbackOpen}
                  onClose={() => setFeedbackOpen(false)}
                  fullWidth
                  maxWidth="sm"
                  slotProps={{
                    backdrop: {
                      sx: {
                        backdropFilter: "blur(10px)",
                        backgroundColor: "rgba(0,0,0,0.55)",
                      },
                    },
                    paper: { sx: { borderRadius: 4 } },
                  }}
                >
                  <DialogTitle sx={{ fontWeight: 750, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    Feedback · {event.title}
                  </DialogTitle>
                  <DialogContent sx={{ pt: 1 }}>
                    <Stack spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        How was the event? Your feedback helps organisers improve.
                      </Typography>
                      {feedbackError ? <Alert severity="error">{feedbackError}</Alert> : null}
                      {feedbackSaved ? (
                        <Alert severity="success">Thanks — feedback saved.</Alert>
                      ) : null}
                      <Box>
                        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                          Star rating
                        </Typography>
                        <Rating
                          value={stars}
                          onChange={(_, v) => setStars(v)}
                          size="large"
                        />
                      </Box>
                      <TextField
                        label="One thing to share (optional)"
                        fullWidth
                        multiline
                        minRows={3}
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Stored only in this browser for now.
                      </Typography>
                    </Stack>
                  </DialogContent>
                  <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setFeedbackOpen(false)} color="inherit">
                      Not now
                    </Button>
                    <Button
                      variant="contained"
                      disabled={!stars || feedbackSaved}
                      onClick={() => {
                        setFeedbackError(null);
                        if (!stars) {
                          setFeedbackError("Please add a star rating.");
                          return;
                        }
                        try {
                          window.localStorage.setItem(
                            feedbackKey,
                            JSON.stringify({
                              stars,
                              text: feedbackText.trim(),
                              submittedAt: new Date().toISOString(),
                              ticketToken: localTicketToken || null,
                            }),
                          );
                          setFeedbackSaved(true);
                        } catch {
                          setFeedbackError("Could not save feedback in this browser.");
                        }
                      }}
                    >
                      Submit
                    </Button>
                  </DialogActions>
                </Dialog>
              </Paper>
            ) : (
              <Typography color="text.secondary">
                RSVP opens when the event is published.
              </Typography>
            )}
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
