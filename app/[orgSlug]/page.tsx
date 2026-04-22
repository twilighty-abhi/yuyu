import { notFound } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMembership } from "@/lib/permissions";
import { EventCard } from "@/components/event/EventCard";
import { InstanceCard } from "@/components/event/InstanceCard";
import { EventStatus } from "@prisma/client";
import EventIcon from "@mui/icons-material/Event";
import RepeatIcon from "@mui/icons-material/Repeat";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

type Props = { params: Promise<{ orgSlug: string }> };

export default async function OrganisationPage({ params }: Props) {
  const { orgSlug } = await params;
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      _count: { select: { memberships: true } },
    },
  });
  if (!org) notFound();

  const session = await auth();
  const membership = session?.user?.id
    ? await getMembership(session.user.id, org.id)
    : null;

  const events = await prisma.event.findMany({
    where: {
      organisationId: org.id,
      status: EventStatus.PUBLISHED,
    },
    orderBy: { startDateTime: "asc" },
  });

  const instances = await prisma.eventInstance.findMany({
    where: {
      startDateTime: { gte: new Date() },
      series: {
        organisationId: org.id,
        status: EventStatus.PUBLISHED,
      },
    },
    include: { series: true },
    orderBy: { startDateTime: "asc" },
    take: 48,
  });

  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.25, sm: 3 },
          borderRadius: 4,
          overflow: "hidden",
          position: "relative",
          background:
            "linear-gradient(135deg, rgba(25,118,210,0.10), rgba(156,39,176,0.08))",
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(700px circle at 0% 0%, rgba(25,118,210,0.22), transparent 55%), radial-gradient(700px circle at 100% 0%, rgba(156,39,176,0.18), transparent 55%)",
          }}
        />

        <Stack
          spacing={2.25}
          sx={{ position: "relative", alignItems: "stretch" }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={{ xs: 2, sm: 3 }}
            sx={{ justifyContent: "space-between", alignItems: { sm: "flex-start" } }}
          >
            <Stack direction="row" spacing={1.75} sx={{ alignItems: "center", minWidth: 0 }}>
              <Avatar
                variant="rounded"
                src={org.logoUrl ?? undefined}
                alt={org.name}
                sx={{
                  width: { xs: 52, sm: 60 },
                  height: { xs: 52, sm: 60 },
                  borderRadius: 3,
                  bgcolor: "action.selected",
                  color: "text.primary",
                }}
              >
                {org.name.trim().slice(0, 1).toUpperCase()}
              </Avatar>

              <Box sx={{ minWidth: 0 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ alignItems: "center", flexWrap: "wrap" }}
                >
                  <Typography
                    variant="h3"
                    component="h1"
                    sx={{ fontWeight: 750, lineHeight: 1.1 }}
                  >
                    {org.name}
                  </Typography>
                  <Chip
                    size="small"
                    label={`/${org.slug}`}
                    variant="outlined"
                    sx={{ bgcolor: "background.paper" }}
                  />
                </Stack>

                {org.description ? (
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ mt: 1, maxWidth: 72 }}
                  >
                    {org.description}
                  </Typography>
                ) : (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1, maxWidth: 72 }}
                  >
                    Community, events, and updates—check back soon for what’s next.
                  </Typography>
                )}
              </Box>
            </Stack>

            <Stack
              direction={{ xs: "row", sm: "column" }}
              spacing={1}
              sx={{
                alignItems: { xs: "flex-start", sm: "flex-end" },
                justifyContent: "flex-start",
              }}
            >
              <Button
                variant="contained"
                component="a"
                href="#events"
                endIcon={<ArrowForwardIcon />}
              >
                Browse events
              </Button>
              {membership ? (
                <Link
                  href={`/dashboard/${org.slug}`}
                  style={{ textDecoration: "none" }}
                >
                  <Button variant="outlined" component="span">
                    Organiser dashboard
                  </Button>
                </Link>
              ) : null}
            </Stack>
          </Stack>

          <Divider sx={{ borderColor: "divider" }} />

          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: "wrap", columnGap: 1, rowGap: 1 }}
          >
            <Chip
              icon={<EventIcon />}
              label={`${events.length} published event${events.length === 1 ? "" : "s"}`}
              variant="outlined"
              sx={{ bgcolor: "background.paper" }}
            />
            <Chip
              icon={<RepeatIcon />}
              label={`${instances.length} upcoming series instance${instances.length === 1 ? "" : "s"}`}
              variant="outlined"
              sx={{ bgcolor: "background.paper" }}
            />
          </Stack>
        </Stack>
      </Paper>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "baseline" }, justifyContent: "space-between" }}
      >
        <Typography variant="h5" component="h2" id="events" sx={{ fontWeight: 700 }}>
          Events
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Upcoming and recently published by {org.name}.
        </Typography>
      </Stack>
      {events.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 2.5, sm: 3 },
            borderRadius: 3,
            bgcolor: "action.hover",
          }}
        >
          <Stack spacing={1}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              No published events yet
            </Typography>
            <Typography color="text.secondary">
              When {org.name} publishes an event, it’ll show up here.
            </Typography>
            {membership ? (
              <Box sx={{ pt: 0.5 }}>
                <Link
                  href={`/dashboard/${org.slug}`}
                  style={{ textDecoration: "none" }}
                >
                  <Button variant="contained" component="span">
                    Create an event
                  </Button>
                </Link>
              </Box>
            ) : null}
          </Stack>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {events.map((event) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={event.id}>
              <EventCard orgSlug={org.slug} event={event} />
            </Grid>
          ))}
        </Grid>
      )}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "baseline" }, justifyContent: "space-between", pt: 1 }}
      >
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          Upcoming series
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Recurring sessions and next occurrences.
        </Typography>
      </Stack>
      {instances.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 2.5, sm: 3 },
            borderRadius: 3,
            bgcolor: "action.hover",
          }}
        >
          <Stack spacing={1}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              No upcoming series instances
            </Typography>
            <Typography color="text.secondary">
              Recurring events will appear here as soon as they’re scheduled.
            </Typography>
          </Stack>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {instances.map((instance) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={instance.id}>
              <InstanceCard
                orgSlug={org.slug}
                instanceId={instance.id}
                title={instance.series.title}
                description={instance.series.description}
                startDateTime={instance.startDateTime}
                endDateTime={instance.endDateTime}
                timezone={instance.series.timezone}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
