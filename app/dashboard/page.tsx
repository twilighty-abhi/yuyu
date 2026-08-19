import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BusinessIcon from "@mui/icons-material/Business";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EventIcon from "@mui/icons-material/Event";

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
    },
  });

  // 2. Fetch Metrics across all user's organisations
  const totalEventsCount = await prisma.event.count({
    where: {
      organisation: { memberships: { some: { userId: session.user.id } } },
      status: "PUBLISHED",
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
    <Stack spacing={4} sx={{ py: { xs: 3, sm: 5 }, px: { xs: 1, sm: 2 } }}>
      {/* ── HEADER (APPLE HIG MINIMALIST STYLE) ── */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { xs: "stretch", sm: "flex-end" },
          gap: 2,
          p: { xs: 2.5, sm: 3.5 },
          border: `1px solid ${APPLE_COLORS.border}`,
          borderRadius: "24px",
          background: "linear-gradient(120deg, rgba(10,132,255,0.14), rgba(255,255,255,0.035) 55%, rgba(48,209,88,0.08))",
          boxShadow: "0 18px 45px rgba(0,0,0,0.16)",
        }}
      >
        <Stack spacing={0.5}>
          <Typography
            variant="overline"
            sx={{ color: APPLE_COLORS.blue, fontWeight: 700, letterSpacing: "1.6px", lineHeight: 1.3 }}
          >
            Workspace overview
          </Typography>
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
            Welcome back, {userName}. Everything you need to run your events, in one place.
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

      {/* ── PRIMARY METRIC ── */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              borderRadius: "16px",
              backgroundColor: APPLE_COLORS.background,
              borderColor: APPLE_COLORS.border,
              background: "linear-gradient(145deg, rgba(10,132,255,0.2), rgba(28,28,30,0.96) 68%)",
              boxShadow: "0 14px 30px rgba(10,132,255,0.08)",
              minHeight: 144,
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
                  Active Events
                </Typography>
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 700,
                    color: APPLE_COLORS.textPrimary,
                    letterSpacing: "-1px",
                  }}
                >
                  {totalEventsCount}
                </Typography>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 44,
                  height: 44,
                  borderRadius: "14px",
                  color: "#fff",
                  backgroundColor: "rgba(10,132,255,0.78)",
                }}
              >
                <EventIcon sx={{ fontSize: 24 }} />
              </Box>
            </Stack>
            <Typography variant="caption" sx={{ display: "block", mt: 2, color: "rgba(255,255,255,0.62)" }}>
              Published across your workspaces
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* ── TWO COLUMN LISTS (HIG GROUPED LAYOUT) ── */}
      <Grid container spacing={4}>
        {/* Left Column: Organisations */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={2}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
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
                  <Typography variant="body2" sx={{ color: APPLE_COLORS.textSecondary }}>
                    Your workspaces
                  </Typography>
                </Stack>

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
                      boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                      "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.06)",
                        transform: "translateY(-2px)",
                        borderColor: "rgba(10,132,255,0.35)",
                      },
                      transition: "background-color 0.15s ease, transform 0.15s ease, border-color 0.15s ease",
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
                                {org.description ? (
                                  <Typography
                                    variant="caption"
                                    sx={{ color: "rgba(255,255,255,0.52)", display: "block", mt: 0.75 }}
                                    noWrap
                                  >
                                    {org.description}
                                  </Typography>
                                ) : null}
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
                              <Typography variant="body2" sx={{ color: APPLE_COLORS.textSecondary, fontWeight: 600 }}>
                                Open workspace
                              </Typography>
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
                boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
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
