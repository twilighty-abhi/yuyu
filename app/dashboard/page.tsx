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

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your organisations, events, and RSVPs.",
};

// Apple iOS/macOS HIG Style Constants
const APPLE_COLORS = {
  blue: "#0A84FF",
  green: "#30D158",
  orange: "#FF9F0A",
  gray: "#8E8E93",
  background: "#1C1C1E", // Secondary system background (Dark Mode)
  cardBg: "rgba(255, 255, 255, 0.04)",
  border: "rgba(255, 255, 255, 0.08)",
  textPrimary: "#FFFFFF",
  textSecondary: "#8E8E93",
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

  const userName = session.user.name || "User";

  return (
    <Stack spacing={4} sx={{ py: 4, px: { xs: 1, sm: 2 } }}>
      {/* ── HEADER (APPLE HIG MINIMALIST STYLE) ── */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { xs: "stretch", sm: "flex-end" },
          pb: 1.5,
          borderBottom: `1px solid ${APPLE_COLORS.border}`,
        }}
      >
        <Stack spacing={0.5}>
          <Typography
            variant="h4"
            component="h1"
            sx={{
              fontWeight: 700,
              letterSpacing: "-1px",
              color: APPLE_COLORS.textPrimary,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            }}
          >
            Dashboard
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: APPLE_COLORS.textSecondary, fontWeight: 400 }}
          >
            Welcome, {userName}. Review active queues and manage organisations.
          </Typography>
        </Stack>

        <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
          <Button
            variant="contained"
            component="span"
            startIcon={<AddIcon />}
            sx={{
              alignSelf: { xs: "flex-start", sm: "center" },
              backgroundColor: APPLE_COLORS.blue,
              color: "#FFFFFF",
              fontWeight: 600,
              textTransform: "none",
              borderRadius: "10px",
              px: 3,
              py: 1,
              fontSize: "0.9rem",
              boxShadow: "none",
              transition: "opacity 0.15s ease",
              "&:hover": {
                backgroundColor: APPLE_COLORS.blue,
                opacity: 0.9,
                boxShadow: "none",
              },
            }}
          >
            New Organisation
          </Button>
        </Link>
      </Stack>

      {/* ── METRICS (APPLE APP WIDGET STYLE) ── */}
      <Grid container spacing={3}>
        {[
          { label: "Active Events", val: totalEventsCount, icon: EventIcon, color: APPLE_COLORS.blue },
          { label: "Waitlisted Queue", val: waitlistCount, icon: HourglassEmptyIcon, color: APPLE_COLORS.orange },
          { label: "Confirmed Registrations", val: confirmedCount, icon: HowToRegIcon, color: APPLE_COLORS.green },
        ].map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <Grid size={{ xs: 12, md: 4 }} key={idx}>
              <Paper
                variant="outlined"
                sx={{
                  p: 3,
                  borderRadius: "16px",
                  backgroundColor: APPLE_COLORS.background,
                  borderColor: APPLE_COLORS.border,
                  boxShadow: "none",
                }}
              >
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Stack spacing={1}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: APPLE_COLORS.textSecondary,
                        fontWeight: 600,
                        fontSize: "0.8rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      {stat.label}
                    </Typography>
                    <Typography
                      variant="h3"
                      sx={{
                        fontWeight: 700,
                        color: APPLE_COLORS.textPrimary,
                        letterSpacing: "-1px",
                      }}
                    >
                      {stat.val}
                    </Typography>
                  </Stack>
                  <Box sx={{ color: stat.color }}>
                    <Icon sx={{ fontSize: 28 }} />
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      {/* ── TWO COLUMN LISTS (HIG GROUPED LAYOUT) ── */}
      <Grid container spacing={4}>
        {/* Left Column: Organisations */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={2}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: APPLE_COLORS.textPrimary,
                letterSpacing: "-0.3px",
              }}
            >
              Organisations
            </Typography>

            {orgs.length === 0 ? (
              <Paper
                variant="outlined"
                sx={{
                  p: 6,
                  borderRadius: "16px",
                  textAlign: "center",
                  backgroundColor: APPLE_COLORS.background,
                  borderColor: APPLE_COLORS.border,
                }}
              >
                <Stack spacing={2} sx={{ alignItems: "center" }}>
                  <Avatar
                    sx={{
                      bgcolor: "rgba(255,255,255,0.06)",
                      color: APPLE_COLORS.textSecondary,
                      width: 56,
                      height: 56,
                    }}
                  >
                    <BusinessIcon sx={{ fontSize: 30 }} />
                  </Avatar>
                  <Typography variant="body1" sx={{ fontWeight: 600, color: APPLE_COLORS.textPrimary }}>
                    No organisations yet
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: APPLE_COLORS.textSecondary, maxWidth: 360, lineHeight: 1.5 }}
                  >
                    Create your first organisation workspace to manage events and check-ins.
                  </Typography>
                  <Box sx={{ pt: 1 }}>
                    <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
                      <Button
                        variant="contained"
                        component="span"
                        startIcon={<AddIcon />}
                        sx={{
                          backgroundColor: APPLE_COLORS.blue,
                          color: "#FFFFFF",
                          fontWeight: 600,
                          textTransform: "none",
                          borderRadius: "10px",
                          px: 3,
                          "&:hover": {
                            backgroundColor: APPLE_COLORS.blue,
                            opacity: 0.9,
                          },
                        }}
                      >
                        Create Organisation
                      </Button>
                    </Link>
                  </Box>
                </Stack>
              </Paper>
            ) : (
              <Stack spacing={2}>
                {orgs.map((org) => (
                  <Card
                    key={org.id}
                    variant="outlined"
                    sx={{
                      borderRadius: "16px",
                      backgroundColor: APPLE_COLORS.background,
                      borderColor: APPLE_COLORS.border,
                      transition: "background-color 0.15s ease",
                      boxShadow: "none",
                      "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.06)",
                      },
                    }}
                  >
                    <Link
                      href={`/dashboard/${org.slug}`}
                      style={{
                        textDecoration: "none",
                        color: "inherit",
                        display: "block",
                      }}
                    >
                      <CardActionArea component="div">
                        <CardContent sx={{ p: 3 }}>
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            spacing={3}
                            sx={{
                              alignItems: { xs: "flex-start", sm: "center" },
                              justifyContent: "space-between",
                            }}
                          >
                            {/* Org Profile Header */}
                            <Stack direction="row" spacing={2} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
                              <Avatar
                                variant="rounded"
                                src={org.logoUrl ?? undefined}
                                alt={org.name}
                                sx={{
                                  background: "rgba(255,255,255,0.06)",
                                  color: APPLE_COLORS.textPrimary,
                                  width: 52,
                                  height: 52,
                                  borderRadius: "12px",
                                  fontWeight: 600,
                                  fontSize: "1.2rem",
                                  border: `1px solid ${APPLE_COLORS.border}`,
                                }}
                              >
                                {org.name.trim().slice(0, 1).toUpperCase()}
                              </Avatar>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  variant="body1"
                                  sx={{ fontWeight: 600, color: APPLE_COLORS.textPrimary }}
                                  noWrap
                                >
                                  {org.name}
                                </Typography>
                                <Typography
                                  variant="body2"
                                  sx={{ color: APPLE_COLORS.textSecondary, mt: 0.25 }}
                                  noWrap
                                >
                                  /{org.slug}
                                </Typography>
                              </Box>
                            </Stack>

                            {/* Info & Navigation */}
                            <Stack
                              direction="row"
                              spacing={3}
                              sx={{
                                alignItems: "center",
                                width: { xs: "100%", sm: "auto" },
                                justifyContent: { xs: "space-between", sm: "flex-end" },
                                pt: { xs: 2, sm: 0 },
                                borderTop: { xs: `1px solid ${APPLE_COLORS.border}`, sm: "none" },
                              }}
                            >
                              <Stack direction="row" spacing={1.5}>
                                <Chip
                                  size="small"
                                  icon={<EventIcon sx={{ fontSize: 14 }} />}
                                  label={`${org._count.events} event${org._count.events === 1 ? "" : "s"}`}
                                  variant="outlined"
                                  sx={{
                                    height: 24,
                                    borderRadius: "6px",
                                    borderColor: APPLE_COLORS.border,
                                    color: APPLE_COLORS.textSecondary,
                                    fontSize: "0.75rem",
                                    "& .MuiChip-icon": { color: "inherit" },
                                  }}
                                />
                                <Chip
                                  size="small"
                                  icon={<PeopleIcon sx={{ fontSize: 14 }} />}
                                  label={`${org._count.memberships} member${org._count.memberships === 1 ? "" : "s"}`}
                                  variant="outlined"
                                  sx={{
                                    height: 24,
                                    borderRadius: "6px",
                                    borderColor: APPLE_COLORS.border,
                                    color: APPLE_COLORS.textSecondary,
                                    fontSize: "0.75rem",
                                    "& .MuiChip-icon": { color: "inherit" },
                                  }}
                                />
                              </Stack>
                              <ArrowForwardIcon sx={{ color: APPLE_COLORS.textSecondary, fontSize: 18 }} />
                            </Stack>
                          </Stack>
                        </CardContent>
                      </CardActionArea>
                    </Link>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </Grid>

        {/* Right Column: Activity Feed (Grouped List Style) */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={2}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: APPLE_COLORS.textPrimary,
                letterSpacing: "-0.3px",
              }}
            >
              Activity
            </Typography>

            <Paper
              variant="outlined"
              sx={{
                p: 3,
                borderRadius: "16px",
                backgroundColor: APPLE_COLORS.background,
                borderColor: APPLE_COLORS.border,
                boxShadow: "none",
              }}
            >
              {recentRsvps.length === 0 ? (
                <Typography
                  variant="body2"
                  sx={{ color: APPLE_COLORS.textSecondary, textAlign: "center", py: 4 }}
                >
                  No recent registrations.
                </Typography>
              ) : (
                <Stack spacing={2}>
                  {recentRsvps.map((rsvp, idx) => {
                    const eventTitle = rsvp.event?.title ?? rsvp.eventInstance?.series?.title ?? "Event";
                    const orgName = rsvp.event?.organisation?.name ?? rsvp.eventInstance?.series?.organisation?.name ?? "";
                    const attendeeName = rsvp.user?.name ?? rsvp.guestName ?? "Guest";
                    const isConfirmed = rsvp.status === "CONFIRMED";

                    return (
                      <Stack key={rsvp.id} spacing={1.5}>
                        {idx > 0 && <Divider sx={{ borderColor: APPLE_COLORS.border }} />}
                        <Stack spacing={0.5}>
                          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 600, color: APPLE_COLORS.textPrimary }}
                            >
                              {attendeeName}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{ color: APPLE_COLORS.textSecondary, fontSize: "0.7rem" }}
                            >
                              {getTimeAgo(rsvp.createdAt)}
                            </Typography>
                          </Stack>
                          <Typography
                            variant="caption"
                            sx={{ color: APPLE_COLORS.textSecondary, lineHeight: 1.4 }}
                          >
                            {isConfirmed ? "Registered for" : "Waitlisted for"}{" "}
                            <span style={{ color: APPLE_COLORS.textPrimary }}>{eventTitle}</span> ({orgName})
                          </Typography>
                        </Stack>
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
