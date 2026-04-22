import Link from "next/link";
import { auth } from "@/lib/auth";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import MailOutlineOutlinedIcon from "@mui/icons-material/MailOutlineOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";

export default async function HomePage() {
  const session = await auth();
  const getStartedHref = session?.user ? "/dashboard" : "/login";

  return (
    <Stack spacing={{ xs: 6, md: 8 }} sx={{ py: { xs: 3, md: 6 } }}>
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 4,
          border: "1px solid",
          borderColor: "divider",
          px: { xs: 2.5, sm: 4, md: 6 },
          py: { xs: 4, sm: 5, md: 7 },
          background:
            "radial-gradient(900px 520px at 12% 10%, rgba(103, 80, 164, 0.22), transparent 55%), radial-gradient(760px 460px at 88% 22%, rgba(156, 77, 255, 0.18), transparent 55%)",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: -2,
            background:
              "linear-gradient(135deg, rgba(103, 80, 164, 0.14) 0%, rgba(255,255,255,0.04) 55%, rgba(156, 77, 255, 0.10) 100%)",
            pointerEvents: "none",
          }}
        />

        <Grid container spacing={{ xs: 3, md: 5 }} sx={{ position: "relative" }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Stack spacing={2.25} sx={{ maxWidth: 720 }}>
              <Typography
                variant="overline"
                sx={{ letterSpacing: 1.4, color: "primary.main" }}
              >
                YUYU EVENTS
              </Typography>
              <Typography
                variant="h2"
                component="h1"
                sx={{
                  fontWeight: 750,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.05,
                }}
              >
                Host events people actually show up to.
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Create an organisation, publish events, share a link, and manage
                RSVPs with approvals, waitlists, invites, and a clean dashboard.
              </Typography>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ pt: 0.5 }}
              >
                <Link href={getStartedHref} style={{ textDecoration: "none" }}>
                  <Button
                    variant="contained"
                    size="large"
                    component="span"
                    endIcon={<ArrowForwardIcon />}
                    fullWidth
                    sx={{ px: 3.25 }}
                  >
                    Get started
                  </Button>
                </Link>
                <Link href="/discover" style={{ textDecoration: "none" }}>
                  <Button
                    variant="outlined"
                    size="large"
                    component="span"
                    fullWidth
                    sx={{ px: 3.25 }}
                  >
                    Browse events
                  </Button>
                </Link>
              </Stack>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.25}
                sx={{ pt: 1 }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    color: "text.secondary",
                  }}
                >
                  <ShieldOutlinedIcon sx={{ fontSize: 18 }} />
                  <Typography variant="body2" color="inherit">
                    Sign in with Google or email magic link
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: { xs: "none", sm: "block" },
                    color: "divider",
                  }}
                >
                  ·
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    color: "text.secondary",
                  }}
                >
                  <LinkOutlinedIcon sx={{ fontSize: 18 }} />
                  <Typography variant="body2" color="inherit">
                    Public event pages + shareable links
                  </Typography>
                </Box>
              </Stack>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <Box
              sx={{
                height: "100%",
                minHeight: { xs: 220, md: 360 },
                borderRadius: 3,
                border: "1px solid",
                borderColor: "divider",
                background:
                  "linear-gradient(135deg, rgba(103, 80, 164, 0.20), rgba(255,255,255,0.06))",
                p: 2.25,
              }}
            >
              <Stack spacing={1.5}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Everything you need to run a great event
                </Typography>
                <Divider />
                <Stack spacing={1.25}>
                  <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                    <EventAvailableOutlinedIcon color="primary" />
                    <Typography variant="body2" color="text.secondary">
                      Draft → publish workflow with privacy controls
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                    <GroupsOutlinedIcon color="primary" />
                    <Typography variant="body2" color="text.secondary">
                      Approvals, waitlist, and attendee management
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                    <MailOutlineOutlinedIcon color="primary" />
                    <Typography variant="body2" color="text.secondary">
                      Invite guests by email with a dedicated panel
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                    <InsightsOutlinedIcon color="primary" />
                    <Typography variant="body2" color="text.secondary">
                      Quick analytics and a clean overview dashboard
                    </Typography>
                  </Box>
                </Stack>
                <Box sx={{ pt: 0.5 }}>
                  <Link href="/dashboard" style={{ textDecoration: "none" }}>
                    <Button
                      variant="text"
                      component="span"
                      endIcon={<ArrowForwardIcon />}
                      sx={{ px: 0.5 }}
                    >
                      Go to dashboard
                    </Button>
                  </Link>
                </Box>
              </Stack>
            </Box>
          </Grid>
        </Grid>
      </Box>

      <Box>
        <Stack spacing={1} sx={{ mb: 2.5 }}>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 750 }}>
            Features
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
            Designed for organizers who want fewer no-shows and a smoother guest
            experience.
          </Typography>
        </Stack>

        <Grid container spacing={2}>
          {[
            {
              title: "Organisations",
              desc: "Create an org and manage events with role-based access.",
              icon: ShieldOutlinedIcon,
            },
            {
              title: "Event pages",
              desc: "Clean public pages with timezone-aware schedules.",
              icon: LinkOutlinedIcon,
            },
            {
              title: "RSVP lifecycle",
              desc: "Confirmed, waitlisted, pending approval, and rejected flows.",
              icon: GroupsOutlinedIcon,
            },
            {
              title: "Invites + outreach",
              desc: "Send invites and track recent invitations from one place.",
              icon: MailOutlineOutlinedIcon,
            },
            {
              title: "Analytics",
              desc: "At-a-glance metrics for response pipeline and totals.",
              icon: InsightsOutlinedIcon,
            },
            {
              title: "Capacity friendly",
              desc: "Set caps and monitor fill to keep events comfortable.",
              icon: EventAvailableOutlinedIcon,
            },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <Grid key={f.title} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card variant="outlined" sx={{ height: "100%" }}>
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack spacing={1.25}>
                      <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                        <Box
                          sx={{
                            width: 40,
                            height: 40,
                            borderRadius: 2,
                            display: "grid",
                            placeItems: "center",
                            backgroundColor: "rgba(103, 80, 164, 0.12)",
                            border: "1px solid rgba(103, 80, 164, 0.20)",
                          }}
                        >
                          <Icon sx={{ fontSize: 22, color: "primary.main" }} />
                        </Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {f.title}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {f.desc}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Box>

      <Box>
        <Grid container spacing={{ xs: 2, md: 3 }}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 750 }}>
              How it works
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 1, maxWidth: 520 }}
            >
              A simple flow for public events and private communities.
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <Stack spacing={2}>
              {[
                {
                  n: "01",
                  title: "Create your organisation",
                  desc: "Set up your team space and keep management access controlled.",
                },
                {
                  n: "02",
                  title: "Publish an event",
                  desc: "Choose privacy, capacity, and schedule details—then share your link.",
                },
                {
                  n: "03",
                  title: "Manage responses",
                  desc: "Approve guests, handle waitlists, send invites, and review analytics.",
                },
              ].map((s) => (
                <Card key={s.n} variant="outlined">
                  <CardContent sx={{ p: 2.5 }}>
                    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
                      <Box
                        sx={{
                          fontFamily: "var(--font-geist-mono)",
                          fontWeight: 700,
                          color: "primary.main",
                          mt: 0.25,
                          minWidth: 42,
                        }}
                      >
                        {s.n}
                      </Box>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {s.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {s.desc}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Grid>
        </Grid>
      </Box>

      <Box
        sx={{
          borderRadius: 4,
          border: "1px solid",
          borderColor: "divider",
          p: { xs: 3, sm: 4 },
          background:
            "linear-gradient(135deg, rgba(103, 80, 164, 0.12) 0%, rgba(255,255,255,0.02) 50%, rgba(156, 77, 255, 0.10) 100%)",
        }}
      >
        <Grid container spacing={2} sx={{ alignItems: "center" }}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>
              Ready to host your next event?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Create an organisation, publish an event, and start collecting RSVPs
              in minutes.
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Stack direction={{ xs: "column", sm: "row", md: "column" }} spacing={1.5}>
              <Link href={getStartedHref} style={{ textDecoration: "none" }}>
                <Button
                  variant="contained"
                  size="large"
                  component="span"
                  endIcon={<ArrowForwardIcon />}
                  fullWidth
                >
                  Get started
                </Button>
              </Link>
              <Link href="/discover" style={{ textDecoration: "none" }}>
                <Button variant="outlined" size="large" component="span" fullWidth>
                  Explore events
                </Button>
              </Link>
            </Stack>
          </Grid>
        </Grid>
      </Box>
    </Stack>
  );
}
