import { notFound } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canCreateEvent,
  canPublishEvents,
  getMembership,
} from "@/lib/permissions";
import { EventCard } from "@/components/event/EventCard";
import { CreateEventDialog } from "@/components/event/CreateEventDialog";
import { PublishEventButton } from "@/components/event/PublishEventButton";

type Props = { params: Promise<{ orgSlug: string }> };

export default async function OrganisationPage({ params }: Props) {
  const { orgSlug } = await params;
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) notFound();

  const session = await auth();
  const membership = session?.user?.id
    ? await getMembership(session.user.id, org.id)
    : null;

  const memberView = canCreateEvent(membership);
  const canPublish = canPublishEvents(membership);

  const events = await prisma.event.findMany({
    where: {
      organisationId: org.id,
      ...(memberView ? {} : { status: "PUBLISHED" as const }),
    },
    orderBy: { startDateTime: "asc" },
  });

  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { xs: "flex-start", sm: "flex-start" },
        }}
      >
        <Box>
          <Typography variant="h3" component="h1" gutterBottom>
            {org.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            /{org.slug}
          </Typography>
          {org.description ? (
            <Typography variant="body1" color="text.secondary">
              {org.description}
            </Typography>
          ) : null}
        </Box>
        {memberView ? (
          <CreateEventDialog
            organisationSlug={org.slug}
            canPublish={canPublish}
          />
        ) : null}
      </Stack>

      <Typography variant="h5" component="h2">
        Events
      </Typography>
      {events.length === 0 ? (
        <Typography color="text.secondary">
          {memberView
            ? "No events yet. Create one to get started."
            : "No public events yet."}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {events.map((event) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={event.id}>
              <Stack spacing={1}>
                <EventCard orgSlug={org.slug} event={event} />
                {canPublish && event.status === "DRAFT" ? (
                  <PublishEventButton
                    organisationSlug={org.slug}
                    eventSlug={event.slug}
                  />
                ) : null}
              </Stack>
            </Grid>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
