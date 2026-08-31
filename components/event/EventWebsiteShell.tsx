"use client";

import Link from "next/link";
import { useState } from "react";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { RsvpForm } from "@/components/rsvp/RsvpForm";
import type { RegistrationFieldDefinition } from "@/components/rsvp/registrationTypes";

type Props = {
  orgSlug: string;
  preview: boolean;
  event: {
    slug: string;
    title: string;
    coverImageUrl: string | null;
    location: string;
    isOnline: boolean;
    status: string;
    start: string;
    end: string;
    timezone: string;
    capacity: number | null;
  };
  page: {
    tagline: string;
    logoUrl: string | null;
    accentColor: string | null;
    aboutHtml: string;
    sections: Array<{ type: string; isVisible: boolean }>;
  };
  highlights: Array<{ id: string; title: string; description: string }>;
  sessions: Array<{
    id: string;
    slug: string;
    title: string;
    start: string;
    type: string;
    room: string | null;
    speakers: Array<{ slug: string; name: string }>;
  }>;
  speakers: Array<{
    id: string;
    slug: string;
    name: string;
    photoUrl: string | null;
    websiteUrl: string | null;
    headline: string;
    organisation: string;
  }>;
  sponsors: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    description: string;
    websiteUrl: string | null;
    tier: string;
  }>;
  venue: { location: string; mapLinkUrl: string | null } | null;
  faqs: Array<{ id: string; question: string; answerHtml: string }>;
  resources: Array<{
    id: string;
    title: string;
    description: string;
    href: string;
  }>;
  registrationFields: RegistrationFieldDefinition[];
  confirmedCount: number | null;
};

const fmt = (value: string, zone: string) =>
  new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  });
const ink = "#171817";
const muted = "#5d635e";
const surface = "#ffffff";
const border = "rgba(23,24,23,0.12)";
const titleSx = { fontSize: { xs: "2rem", md: "2.5rem" }, mb: 2, color: ink };
const surfaceSx = { bgcolor: surface, color: ink, borderColor: border };
function Rich({ html }: { html: string }) {
  return html ? (
    <Box
      sx={{
        "& p": { lineHeight: 1.8, my: 0 },
        "& a": { color: "primary.main" },
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : null;
}
function mapSearchQuery(location: string, mapLinkUrl: string | null) {
  if (mapLinkUrl) {
    try {
      const url = new URL(mapLinkUrl);
      const urlQuery =
        url.searchParams.get("query") ||
        url.searchParams.get("q") ||
        url.searchParams.get("destination");
      if (urlQuery) return urlQuery;
    } catch {
      // The server rejects invalid URLs, but retain a safe rendering fallback.
    }
  }
  return location.trim() || null;
}

export function EventWebsiteShell(p: Props) {
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const shown = new Set(
    p.page.sections.filter((x) => x.isVisible).map((x) => x.type),
  );
  const accent = p.page.accentColor || "#245b4f";
  const section = (type: string, child: React.ReactNode) =>
    shown.has(type) ? (
      <Box component="section" sx={{ py: { xs: 3.5, md: 5 } }}>
        {child}
      </Box>
    ) : null;
  const mapQuery = p.venue
    ? mapSearchQuery(p.venue.location, p.venue.mapLinkUrl)
    : null;
  const mapHref =
    p.venue?.mapLinkUrl ||
    (mapQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
      : null);
  const share = async () => {
    try {
      if (navigator.share)
        await navigator.share({ title: p.event.title, url: location.href });
      else await navigator.clipboard.writeText(location.href);
      setShared(true);
    } catch {
      /* sharing cancelled */
    }
  };
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f7f7f5", pb: { xs: 5, md: 8 } }}>
      {p.preview ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          Preview mode — only authorized organizers can see draft content.
        </Alert>
      ) : null}
      <Container maxWidth="lg" sx={{ pt: { xs: 2, sm: 3, md: 4 } }}>
        <Box
          sx={{
            position: "relative",
            overflow: "hidden",
            borderRadius: { xs: 3, md: 5 },
            color: "primary.contrastText",
            bgcolor: accent,
            boxShadow: "0 22px 60px rgba(21,21,21,0.18)",
          }}
        >
          <Grid container>
            {p.event.coverImageUrl ? (
              <Grid
                size={{ xs: 12, md: 5 }}
                sx={{
                  display: "flex",
                  alignItems: "stretch",
                  minHeight: { xs: 280, sm: 400, md: 520 },
                  bgcolor: "rgba(0,0,0,0.2)",
                }}
              >
                <Box
                  component="img"
                  src={p.event.coverImageUrl}
                  alt={`${p.event.title} poster`}
                  sx={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    bgcolor: "rgba(0,0,0,0.35)",
                  }}
                />
              </Grid>
            ) : null}
            <Grid size={{ xs: 12, md: p.event.coverImageUrl ? 7 : 12 }}>
              <Stack
                spacing={2.5}
                sx={{
                  position: "relative",
                  p: { xs: 3, sm: 5, md: 6 },
                  minHeight: { md: 520 },
                  justifyContent: "center",
                }}
              >
                {p.page.logoUrl ? (
                  <Avatar
                    src={p.page.logoUrl}
                    alt=""
                    variant="rounded"
                    sx={{
                      width: 68,
                      height: 68,
                      bgcolor: "rgba(255,255,255,0.16)",
                    }}
                  />
                ) : null}
                <Box>
                  <Typography
                    variant="overline"
                    sx={{
                      opacity: 0.78,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                    }}
                  >
                    You’re invited
                  </Typography>
                  <Typography
                    variant="h1"
                    sx={{
                      mt: 0.5,
                      fontSize: { xs: "2.45rem", sm: "3.7rem", md: "4.6rem" },
                      lineHeight: 0.96,
                      letterSpacing: "-0.055em",
                      fontWeight: 800,
                      maxWidth: 700,
                    }}
                  >
                    {p.event.title}
                  </Typography>
                  {p.page.tagline ? (
                    <Typography
                      variant="h6"
                      sx={{
                        mt: 2,
                        opacity: 0.92,
                        fontWeight: 400,
                        maxWidth: 580,
                      }}
                    >
                      {p.page.tagline}
                    </Typography>
                  ) : null}
                </Box>
                <Stack
                  spacing={1.25}
                  sx={{
                    fontSize: { xs: "1rem", sm: "1.0625rem" },
                    opacity: 0.97,
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.25}
                    sx={{ alignItems: "center" }}
                  >
                    <CalendarMonthOutlinedIcon fontSize="small" />
                    <Typography>
                      {fmt(p.event.start, p.event.timezone)} –{" "}
                      {fmt(p.event.end, p.event.timezone)}
                    </Typography>
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={1.25}
                    sx={{ alignItems: "center" }}
                  >
                    {p.event.isOnline ? (
                      <VideocamOutlinedIcon fontSize="small" />
                    ) : (
                      <LocationOnOutlinedIcon fontSize="small" />
                    )}
                    <Typography>
                      {p.event.isOnline
                        ? "Online event"
                        : p.event.location || "Venue details coming soon"}
                    </Typography>
                  </Stack>
                </Stack>
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: "wrap" }}
                >
                  {p.sessions.length > 0 ? (
                    <Chip
                      label={`${p.sessions.length} session${p.sessions.length === 1 ? "" : "s"}`}
                      size="small"
                      sx={{
                        bgcolor: "rgba(255,255,255,0.14)",
                        color: "inherit",
                      }}
                    />
                  ) : null}
                  {p.speakers.length > 0 ? (
                    <Chip
                      label={`${p.speakers.length} speaker${p.speakers.length === 1 ? "" : "s"}`}
                      size="small"
                      sx={{
                        bgcolor: "rgba(255,255,255,0.14)",
                        color: "inherit",
                      }}
                    />
                  ) : null}
                </Stack>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 2.25, sm: 2.5 },
                    width: "100%",
                    borderRadius: 3,
                    boxShadow: "0 12px 30px rgba(0,0,0,0.14)",
                    ...surfaceSx,
                  }}
                >
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        Join this event
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ mt: 0.25, color: muted }}
                      >
                        Reserve your free place in a few moments.
                      </Typography>
                    </Box>
                    {p.event.status === "CANCELLED" ? (
                      <Alert severity="error">Event cancelled</Alert>
                    ) : (
                      <Button
                        variant="contained"
                        size="large"
                        fullWidth
                        onClick={() => setOpen(true)}
                      >
                        Register now
                      </Button>
                    )}
                    {p.event.capacity != null && p.confirmedCount != null ? (
                      <Typography
                        variant="body2"
                        sx={{ textAlign: "center", color: muted }}
                      >
                        {p.confirmedCount} registered ·{" "}
                        {p.event.capacity - p.confirmedCount > 0
                          ? `${p.event.capacity - p.confirmedCount} places left`
                          : "At capacity"}
                      </Typography>
                    ) : null}
                    <Button onClick={share} variant="text" fullWidth>
                      {shared ? "Link copied" : "Share event"}
                    </Button>
                  </Stack>
                </Paper>
              </Stack>
            </Grid>
          </Grid>
        </Box>
      </Container>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="event-registration-title"
      >
        <DialogTitle id="event-registration-title">
          Register for {p.event.title}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <RsvpForm
              orgSlug={p.orgSlug}
              eventSlug={p.event.slug}
              registrationFields={p.registrationFields}
            />
          </Box>
        </DialogContent>
      </Dialog>
      <Container maxWidth="lg" sx={{ color: ink }}>
        {section(
          "ABOUT",
          <Paper
            variant="outlined"
            sx={{
              p: { xs: 2.5, md: 4 },
              borderRadius: 3,
              ...surfaceSx,
            }}
          >
            <Typography variant="h3" sx={titleSx}>
              About this event
            </Typography>
            {p.page.aboutHtml ? (
              <Rich html={p.page.aboutHtml} />
            ) : (
              <Typography sx={{ lineHeight: 1.8, color: muted }}>
                More event details will be shared soon. Save your place now to
                stay in the loop.
              </Typography>
            )}
          </Paper>,
        )}
        {section(
          "HIGHLIGHTS",
          p.highlights.length > 0 ? (
            <>
              <Typography variant="h3" sx={titleSx}>
                Highlights
              </Typography>
              <Grid container spacing={2}>
                {p.highlights.map((x) => (
                  <Grid key={x.id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2.5,
                        height: "100%",
                        borderRadius: 3,
                        ...surfaceSx,
                      }}
                    >
                      <Typography sx={{ fontWeight: 750, mb: 0.75 }}>
                        {x.title}
                      </Typography>
                      {x.description ? (
                        <Typography variant="body2" sx={{ color: muted }}>
                          {x.description}
                        </Typography>
                      ) : null}
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </>
          ) : null,
        )}
        {section(
          "SCHEDULE",
          p.sessions.length > 0 ? (
            <>
              <Typography variant="h3" sx={titleSx}>
                Programme
              </Typography>
              <Stack spacing={1.25}>
                {p.sessions.map((x) => (
                  <Paper
                    key={x.id}
                    component={Link}
                    href={`/${p.orgSlug}/${p.event.slug}/sessions/${x.slug}`}
                    variant="outlined"
                    sx={{
                      p: { xs: 2, sm: 2.5 },
                      ...surfaceSx,
                      textDecoration: "none",
                      borderRadius: 3,
                      transition: "0.2s",
                      "&:hover": {
                        borderColor: "primary.main",
                        transform: "translateY(-1px)",
                      },
                    }}
                  >
                    <Typography sx={{ fontWeight: 750 }}>{x.title}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, color: muted }}>
                      {fmt(x.start, p.event.timezone)} · {x.room || "Room TBA"}{" "}
                      · {x.type}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </>
          ) : null,
        )}
        {section(
          "SPEAKERS",
          p.speakers.length > 0 ? (
            <>
              <Typography variant="h3" sx={titleSx}>
                Speakers
              </Typography>
              <Grid container spacing={2}>
                {p.speakers.map((x) => (
                  <Grid key={x.id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Stack
                      component={Link}
                      href={
                        x.websiteUrl ||
                        `/${p.orgSlug}/${p.event.slug}/speakers/${x.slug}`
                      }
                      target={x.websiteUrl ? "_blank" : undefined}
                      rel={x.websiteUrl ? "noopener noreferrer" : undefined}
                      direction="row"
                      spacing={1.5}
                      sx={{
                        color: ink,
                        textDecoration: "none",
                        alignItems: "center",
                      }}
                    >
                      <Avatar
                        src={x.photoUrl || undefined}
                        alt=""
                        sx={{ width: 64, height: 64 }}
                      />
                      <Box>
                        <Typography sx={{ fontWeight: 750 }}>
                          {x.name}
                        </Typography>
                        <Typography variant="body2" sx={{ color: muted }}>
                          {[x.headline, x.organisation]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                    </Stack>
                  </Grid>
                ))}
              </Grid>
            </>
          ) : null,
        )}
        {section(
          "SPONSORS",
          p.sponsors.length > 0 ? (
            <>
              <Typography variant="h3" sx={titleSx}>
                Sponsors & partners
              </Typography>
              <Grid container spacing={2}>
                {p.sponsors.map((x) => (
                  <Grid key={x.id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Paper
                      component={x.websiteUrl ? "a" : "div"}
                      href={x.websiteUrl || undefined}
                      target="_blank"
                      rel="noreferrer"
                      variant="outlined"
                      sx={{
                        p: 2,
                        height: "100%",
                        ...surfaceSx,
                        textDecoration: "none",
                        borderRadius: 3,
                        transition: "0.2s",
                        "&:hover": x.websiteUrl
                          ? {
                              borderColor: "primary.main",
                              transform: "translateY(-1px)",
                            }
                          : undefined,
                      }}
                    >
                      <Box
                        sx={{
                          height: 104,
                          p: 1.5,
                          bgcolor: "#fff",
                          borderRadius: 2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        {x.logoUrl ? (
                          <Box
                            component="img"
                            src={x.logoUrl}
                            alt={x.name}
                            sx={{
                              width: "100%",
                              height: "100%",
                              objectFit: "contain",
                              display: "block",
                            }}
                          />
                        ) : (
                          <Typography
                            sx={{
                              color: "#171717",
                              fontWeight: 750,
                              textAlign: "center",
                            }}
                          >
                            {x.name}
                          </Typography>
                        )}
                      </Box>
                      <Typography sx={{ fontWeight: 750, mt: 1.5 }}>
                        {x.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ display: "block", mt: 0.25, color: muted }}
                      >
                        {x.tier.replaceAll("_", " ")}
                      </Typography>
                      {x.description ? (
                        <Typography
                          variant="body2"
                          sx={{ mt: 1, color: muted }}
                        >
                          {x.description}
                        </Typography>
                      ) : null}
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </>
          ) : null,
        )}
        {section(
          "VENUE",
          p.venue && !p.event.isOnline ? (
            <Paper
              variant="outlined"
              sx={{
                overflow: "hidden",
                borderRadius: 3,
                ...surfaceSx,
              }}
            >
              <Grid container>
                <Grid size={{ xs: 12, md: mapQuery ? 5 : 12 }}>
                  <Stack
                    spacing={2}
                    sx={{
                      p: { xs: 2.5, md: 4 },
                      height: "100%",
                      justifyContent: "center",
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", color: "primary.main" }}
                    >
                      <LocationOnOutlinedIcon />
                      <Typography
                        variant="overline"
                        sx={{ fontWeight: 700, letterSpacing: "0.1em" }}
                      >
                        Venue
                      </Typography>
                    </Stack>
                    <Box>
                      <Typography variant="h3" sx={{ ...titleSx, mb: 1 }}>
                        {p.venue.location || "Venue details coming soon"}
                      </Typography>
                      <Typography sx={{ lineHeight: 1.7, color: muted }}>
                        {p.venue.location
                          ? "Use the map for directions and plan your journey."
                          : "The organiser will share the venue shortly."}
                      </Typography>
                    </Box>
                    {mapHref ? (
                      <Button
                        component="a"
                        href={mapHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="contained"
                        endIcon={<OpenInNewIcon />}
                        sx={{ alignSelf: "flex-start" }}
                      >
                        Get directions
                      </Button>
                    ) : null}
                  </Stack>
                </Grid>
                {mapQuery ? (
                  <Grid
                    size={{ xs: 12, md: 7 }}
                    sx={{
                      minHeight: { xs: 260, md: 360 },
                      bgcolor: "grey.100",
                    }}
                  >
                    <Box
                      component="iframe"
                      title={`Map for ${p.venue.location || "event venue"}`}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                      sx={{
                        display: "block",
                        width: "100%",
                        height: "100%",
                        minHeight: { xs: 260, md: 360 },
                        border: 0,
                      }}
                    />
                  </Grid>
                ) : null}
              </Grid>
            </Paper>
          ) : null,
        )}
        {section(
          "FAQ",
          p.faqs.length > 0 ? (
            <>
              <Typography variant="h3" sx={titleSx}>
                Frequently asked questions
              </Typography>
              <Stack spacing={1}>
                {p.faqs.map((x) => (
                  <Accordion
                    key={x.id}
                    disableGutters
                    elevation={0}
                    sx={{
                      ...surfaceSx,
                      border: 1,
                      borderRadius: "12px !important",
                      "&::before": { display: "none" },
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      aria-controls={`faq-${x.id}-content`}
                      id={`faq-${x.id}-header`}
                    >
                      <Typography sx={{ fontWeight: 750 }}>
                        {x.question}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails id={`faq-${x.id}-content`}>
                      <Rich html={x.answerHtml} />
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Stack>
            </>
          ) : null,
        )}
        {section(
          "RESOURCES",
          p.resources.length > 0 ? (
            <>
              <Typography variant="h3" sx={titleSx}>
                Resources
              </Typography>
              <Stack spacing={1.25}>
                {p.resources.map((x) => (
                  <Paper
                    key={x.id}
                    component="a"
                    href={x.href}
                    target="_blank"
                    rel="noreferrer"
                    variant="outlined"
                    sx={{
                      p: 2.25,
                      ...surfaceSx,
                      textDecoration: "none",
                      borderRadius: 3,
                    }}
                  >
                    <Typography sx={{ fontWeight: 750 }}>{x.title}</Typography>
                    <Typography variant="body2" sx={{ color: muted }}>
                      {x.description}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </>
          ) : null,
        )}
      </Container>
    </Box>
  );
}
