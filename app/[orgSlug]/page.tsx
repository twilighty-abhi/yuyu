import { notFound } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
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
import { OrgEventsContainer } from "@/components/org/OrgEventsContainer";
import { EventStatus } from "@prisma/client";
import EventIcon from "@mui/icons-material/Event";
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

  // Fetch all published events (both past and upcoming)
  const events = await prisma.event.findMany({
    where: {
      organisationId: org.id,
      status: EventStatus.PUBLISHED,
    },
    orderBy: { startDateTime: "asc" },
  });

  // Fetch all instances of published series (both past and upcoming)
  const instances = await prisma.eventInstance.findMany({
    where: {
      series: {
        organisationId: org.id,
        status: EventStatus.PUBLISHED,
      },
    },
    include: { series: true },
    orderBy: { startDateTime: "asc" },
  });

  // Merge events and instances into a unified timeline
  const merged = [
    ...events.map((event) => ({
      kind: "event" as const,
      id: `e-${event.id}`,
      startDateTime: event.startDateTime,
      endDateTime: event.endDateTime,
      title: event.title,
      description: event.description,
      event,
    })),
    ...instances.map((instance) => ({
      kind: "instance" as const,
      id: `i-${instance.id}`,
      startDateTime: instance.startDateTime,
      endDateTime: instance.endDateTime,
      title: instance.series.title,
      description: instance.series.description,
      instance,
    })),
  ];

  merged.sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime());

  // Count upcoming occurrences
  const now = new Date();
  const upcomingCount = merged.filter((item) => new Date(item.startDateTime) >= now).length;

  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      {/* Organisation Profile Header Card */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.25, sm: 3 },
          borderRadius: 4,
          overflow: "hidden",
          position: "relative",
          background:
            "linear-gradient(135deg, rgba(124, 245, 182, 0.08) 0%, rgba(185, 174, 255, 0.06) 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(700px circle at 0% 0%, rgba(124, 245, 182, 0.12), transparent 55%), radial-gradient(700px circle at 100% 0%, rgba(185, 174, 255, 0.1), transparent 55%)",
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
                    variant="h4"
                    component="h1"
                    sx={{ fontWeight: 800, lineHeight: 1.1 }}
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

                <Typography
                  variant="body1"
                  color="text.secondary"
                  sx={{ mt: 1, maxWidth: 600, lineHeight: 1.5 }}
                >
                  {org.description || "Community, events, and updates—check back soon for what’s next."}
                </Typography>
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
              {merged.length > 0 && (
                <Button
                  variant="contained"
                  component="a"
                  href="#events-list"
                  endIcon={<ArrowForwardIcon />}
                  sx={{
                    background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                    color: "#061814",
                    fontWeight: 700,
                  }}
                >
                  Browse events
                </Button>
              )}
              {membership ? (
                <Link
                  href={`/dashboard/${org.slug}`}
                  style={{ textDecoration: "none" }}
                >
                  <Button variant="outlined" component="span" sx={{ width: "100%" }}>
                    Dashboard
                  </Button>
                </Link>
              ) : null}
            </Stack>
          </Stack>

          <Divider sx={{ borderColor: "rgba(255,255,255,0.06)" }} />

          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: "wrap", columnGap: 1, rowGap: 1 }}
          >
            {merged.length > 0 && (
              <Chip
                icon={<EventIcon />}
                label={`${merged.length} total event${merged.length === 1 ? "" : "s"}`}
                variant="outlined"
                sx={{ bgcolor: "background.paper" }}
              />
            )}
            {upcomingCount > 0 && (
              <Chip
                label={`${upcomingCount} upcoming`}
                variant="outlined"
                color="primary"
                sx={{ bgcolor: "rgba(124, 245, 182, 0.08)", color: "#7CF5B6", borderColor: "rgba(124, 245, 182, 0.2)" }}
              />
            )}
          </Stack>
        </Stack>
      </Paper>

      {/* Main Events Area */}
      <Box id="events-list">
        {merged.length === 0 ? (
          <Paper
            variant="outlined"
            sx={{
              p: { xs: 4, sm: 6 },
              borderRadius: 4,
              textAlign: "center",
              bgcolor: "rgba(255,255,255,0.01)",
              borderColor: "rgba(255,255,255,0.06)",
            }}
          >
            <Stack spacing={2} sx={{ alignItems: "center" }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                No events scheduled yet
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 400 }}>
                This community hasn&apos;t published any events or recurring series yet. Check back soon!
              </Typography>
              {membership ? (
                <Box sx={{ pt: 1 }}>
                  <Link
                    href={`/dashboard/${org.slug}`}
                    style={{ textDecoration: "none" }}
                  >
                    <Button variant="contained" component="span">
                      Create your first event
                    </Button>
                  </Link>
                </Box>
              ) : null}
            </Stack>
          </Paper>
        ) : (
          <OrgEventsContainer orgSlug={org.slug} items={merged} />
        )}
      </Box>
    </Stack>
  );
}

