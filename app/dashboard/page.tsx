import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BusinessIcon from "@mui/icons-material/Business";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EventIcon from "@mui/icons-material/Event";
import PeopleIcon from "@mui/icons-material/People";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your organisations, events, and RSVPs.",
};

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  // 1. Fetch Organisations the user belongs to
  const orgs = await prisma.organisation.findMany({
    where: {
      memberships: { some: { userId: session.user.id } },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      _count: { select: { events: true, memberships: true } },
    },
  });

  // 2. Fetch Metrics across all user's organisations
  const totalEventsCount = await prisma.event.count({
    where: {
      organisation: { memberships: { some: { userId: session.user.id } } },
      status: "PUBLISHED",
    },
  });

  const waitlistCount = await prisma.rSVP.count({
    where: {
      status: "WAITLISTED",
      OR: [
        { event: { organisation: { memberships: { some: { userId: session.user.id } } } } },
        { eventInstance: { series: { organisation: { memberships: { some: { userId: session.user.id } } } } } },
      ],
    },
  });

  const confirmedCount = await prisma.rSVP.count({
    where: {
      status: "CONFIRMED",
      OR: [
        { event: { organisation: { memberships: { some: { userId: session.user.id } } } } },
        { eventInstance: { series: { organisation: { memberships: { some: { userId: session.user.id } } } } } },
      ],
    },
  });

  // 3. Fetch 5 most recent RSVPs for activity stream
  const recentRsvps = await prisma.rSVP.findMany({
    where: {
      OR: [
        { event: { organisation: { memberships: { some: { userId: session.user.id } } } } },
        { eventInstance: { series: { organisation: { memberships: { some: { userId: session.user.id } } } } } },
      ],
    },
    include: {
      event: {
        select: {
          title: true,
          organisation: { select: { name: true, slug: true } },
        },
      },
      eventInstance: {
        select: {
          series: {
            select: {
              title: true,
              organisation: { select: { name: true, slug: true } },
            },
          },
        },
      },
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const userName = session.user.name || "Host";

  return (
    <Stack spacing={4} sx={{ py: 3 }}>
      {/* ── COMMAND CENTER HERO HEADER ── */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 3, sm: 4 },
          borderRadius: 4,
          overflow: "hidden",
          position: "relative",
          background:
            "linear-gradient(135deg, rgba(124, 245, 182, 0.08) 0%, rgba(185, 174, 255, 0.05) 100%)",
          borderColor: "rgba(255, 255, 255, 0.06)",
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(600px circle at 0% 0%, rgba(124, 245, 182, 0.15), transparent 55%), radial-gradient(600px circle at 100% 0%, rgba(185, 174, 255, 0.1), transparent 55%)",
          }}
        />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            position: "relative",
            justifyContent: "space-between",
            alignItems: { xs: "stretch", sm: "center" },
            zIndex: 1,
          }}
        >
          <Stack spacing={1}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <BusinessIcon sx={{ color: "#7CF5B6" }} />
              <Typography variant="h4" component="h1" sx={{ fontWeight: 900, letterSpacing: "-1px" }}>
                Welcome back, {userName}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.65)" }}>
              Manage event forms, promote waitlists, and audit checked-in tickets from your command console.
            </Typography>
          </Stack>

          <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
            <Button
              variant="contained"
              component="span"
              startIcon={<AddIcon />}
              sx={{
                alignSelf: { xs: "flex-start", sm: "center" },
                background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                color: "#061814",
                fontWeight: 700,
                borderRadius: 2.5,
                px: 3.5,
                py: 1,
                boxShadow: "0 4px 15px rgba(124, 245, 182, 0.2)",
                transition: "all 0.2s ease",
                "&:hover": {
                  transform: "translateY(-1px)",
                  background: "linear-gradient(135deg, #90ffd0 0%, #cac0ff 100%)",
                  boxShadow: "0 6px 20px rgba(124, 245, 182, 0.35)",
                },
              }}
            >
              New organisation
            </Button>
          </Link>
        </Stack>
      </Paper>

      {/* ── METRICS COUNTER ROW ── */}
      <Grid container spacing={3}>
        {[
          { label: "Active Events", val: totalEventsCount, icon: EventIcon, color: "#7CF5B6", bg: "rgba(124, 245, 182, 0.05)" },
          { label: "Waitlisted Queue", val: waitlistCount, icon: HourglassEmptyIcon, color: "#B9AEFF", bg: "rgba(185, 174, 255, 0.05)" },
          { label: "Confirmed Registrations", val: confirmedCount, icon: HowToRegIcon, color: "#90caf9", bg: "rgba(144, 202, 249, 0.05)" },
        ].map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <Grid size={{ xs: 12, md: 4 }} key={idx}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderRadius: 3.5,
                  backgroundColor: "rgba(255,255,255,0.01)",
                  borderColor: "rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.3 }}>
                    {stat.label}
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 850 }}>
                    {stat.val}
                  </Typography>
                </Stack>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: stat.bg, color: stat.color }}>
                  <Icon />
                </Box>
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      {/* ── MAIN CONTENT (TWO COLUMN LAYOUT) ── */}
      <Grid container spacing={4}>
        {/* Left Column: Organisations */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={2.5}>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: "-0.2px" }}>
              Your Organisations
            </Typography>

            {orgs.length === 0 ? (
              <Paper
                variant="outlined"
                sx={{
                  p: 6,
                  borderRadius: 4,
                  textAlign: "center",
                  backgroundColor: "rgba(255, 255, 255, 0.01)",
                  borderColor: "rgba(255, 255, 255, 0.06)",
                }}
              >
                <Stack spacing={2} sx={{ alignItems: "center" }}>
                  <Avatar
                    sx={{
                      bgcolor: "rgba(124, 245, 182, 0.08)",
                      color: "#7CF5B6",
                      width: 56,
                      height: 56,
                      border: "1px solid rgba(124, 245, 182, 0.15)",
                    }}
                  >
                    <BusinessIcon />
                  </Avatar>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    No organisations yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, lineHeight: 1.6 }}>
                    Create your first organisation to start hosting events and managing RSVPs.
                  </Typography>
                  <Box sx={{ pt: 1.5 }}>
                    <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
                      <Button
                        variant="contained"
                        component="span"
                        startIcon={<AddIcon />}
                        sx={{
                          background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                          color: "#061814",
                          fontWeight: 700,
                          borderRadius: 2.5,
                          px: 3.5,
                        }}
                      >
                        Create organisation
                      </Button>
                    </Link>
                  </Box>
                </Stack>
              </Paper>
            ) : (
              <Grid container spacing={3}>
                {orgs.map((org) => (
                  <Grid key={org.id} size={{ xs: 12, sm: 6 }}>
                    <Card
                      variant="outlined"
                      sx={{
                        height: "100%",
                        borderRadius: 4,
                        backgroundColor: "rgba(255, 255, 255, 0.01)",
                        borderColor: "rgba(255, 255, 255, 0.06)",
                        backdropFilter: "blur(20px)",
                        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                        "&:hover": {
                          transform: "translateY(-4px)",
                          borderColor: "rgba(124, 245, 182, 0.25)",
                          backgroundColor: "rgba(124, 245, 182, 0.015)",
                          boxShadow: "0 15px 40px rgba(0, 0, 0, 0.25)",
                          "& .arrow-icon": {
                            transform: "translateX(4px)",
                          },
                        },
                      }}
                    >
                      <Link
                        href={`/dashboard/${org.slug}`}
                        style={{
                          textDecoration: "none",
                          color: "inherit",
                          display: "block",
                          height: "100%",
                        }}
                      >
                        <CardActionArea component="div" sx={{ height: "100%" }}>
                          <CardContent sx={{ height: "100%", p: 3 }}>
                            <Stack spacing={2.5} sx={{ height: "100%" }}>
                              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                                <Avatar
                                  variant="rounded"
                                  src={org.logoUrl ?? undefined}
                                  alt={org.name}
                                  sx={{
                                    background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                                    color: "#061814",
                                    width: 48,
                                    height: 48,
                                    borderRadius: 2.5,
                                    fontWeight: 800,
                                  }}
                                >
                                  {org.name.trim().slice(0, 1).toUpperCase()}
                                </Avatar>
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
                                    {org.name}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }} noWrap>
                                    /{org.slug}
                                  </Typography>
                                </Box>
                              </Stack>

                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                  height: 40,
                                  lineHeight: 1.5,
                                }}
                              >
                                {org.description || "No description provided. Click to start customizing organization details."}
                              </Typography>

                              <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", columnGap: 1, rowGap: 1 }}>
                                <Chip
                                  size="small"
                                  icon={<EventIcon sx={{ fontSize: 16 }} />}
                                  label={`${org._count.events} event${org._count.events === 1 ? "" : "s"}`}
                                  variant="outlined"
                                  sx={{ height: 28, borderRadius: 1.5 }}
                                />
                                <Chip
                                  size="small"
                                  icon={<PeopleIcon sx={{ fontSize: 16 }} />}
                                  label={`${org._count.memberships} member${org._count.memberships === 1 ? "" : "s"}`}
                                  variant="outlined"
                                  sx={{ height: 28, borderRadius: 1.5 }}
                                />
                              </Stack>

                              <Box sx={{ flex: 1 }} />
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{
                                  alignItems: "center",
                                  color: "#7CF5B6",
                                  pt: 1.5,
                                  borderTop: "1px solid",
                                  borderColor: "rgba(255, 255, 255, 0.06)",
                                }}
                              >
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                  Open organiser dashboard
                                </Typography>
                                <ArrowForwardIcon
                                  className="arrow-icon"
                                  fontSize="small"
                                  sx={{ transition: "transform 0.2s ease-in-out" }}
                                />
                              </Stack>
                            </Stack>
                          </CardContent>
                        </CardActionArea>
                      </Link>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </Stack>
        </Grid>

        {/* Right Column: Activity Feed */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={2.5}>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: "-0.2px" }}>
              Recent Activity
            </Typography>

            <Paper
              variant="outlined"
              sx={{
                p: 3,
                borderRadius: 4,
                backgroundColor: "rgba(255, 255, 255, 0.01)",
                borderColor: "rgba(255, 255, 255, 0.06)",
                boxShadow: "0 10px 30px rgba(0, 0, 0, 0.15)",
              }}
            >
              {recentRsvps.length === 0 ? (
                <Typography color="text.secondary" sx={{ textAlign: "center", py: 4, fontSize: "0.875rem" }}>
                  No recent registrations or waitlist queues active.
                </Typography>
              ) : (
                <Stack spacing={2.5}>
                  {recentRsvps.map((rsvp) => {
                    const eventTitle = rsvp.event?.title ?? rsvp.eventInstance?.series?.title ?? "Event";
                    const orgName = rsvp.event?.organisation?.name ?? rsvp.eventInstance?.series?.organisation?.name ?? "";
                    const attendeeName = rsvp.user?.name ?? rsvp.guestName ?? "Guest";
                    const isConfirmed = rsvp.status === "CONFIRMED";

                    return (
                      <Stack key={rsvp.id} spacing={1}>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                          {/* Live Pulsing Dot */}
                          <Box sx={{ pt: 0.5 }}>
                            <FiberManualRecordIcon
                              sx={{
                                fontSize: 10,
                                color: isConfirmed ? "#7CF5B6" : "#B9AEFF",
                                animation: "pulse 2s infinite ease-in-out",
                                "@keyframes pulse": {
                                  "0%": { opacity: 0.4 },
                                  "50%": { opacity: 1 },
                                  "100%": { opacity: 0.4 },
                                },
                              }}
                            />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                              {attendeeName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                              {rsvp.status === "CONFIRMED" ? "Registered for" : "Joined waitlist of"} <b>{eventTitle}</b> ({orgName})
                            </Typography>
                            <Typography variant="caption" sx={{ color: "rgba(255, 255, 255, 0.4)", display: "block", mt: 0.5 }}>
                              {getTimeAgo(rsvp.createdAt)}
                            </Typography>
                          </Box>
                        </Stack>
                        <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.04)" }} />
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
