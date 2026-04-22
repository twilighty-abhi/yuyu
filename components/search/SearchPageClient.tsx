"use client";

import { useRouter } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import type { Event, EventStatus } from "@prisma/client";
import { EventCard } from "@/components/event/EventCard";

type SearchEventRow = {
  id: string;
  title: string;
  slug: string;
  description: string;
  tags?: string[] | null;
  coverImageUrl: string | null;
  startDateTime: string;
  endDateTime: string;
  timezone: string;
  location: string;
  isOnline: boolean;
  status: EventStatus;
  organisation: { slug: string; name: string };
};

function toEventCardShape(e: SearchEventRow): Pick<
  Event,
  | "title"
  | "slug"
  | "description"
  | "tags"
  | "coverImageUrl"
  | "startDateTime"
  | "endDateTime"
  | "timezone"
  | "location"
  | "isOnline"
  | "status"
> {
  return {
    title: e.title,
    slug: e.slug,
    description: e.description,
    tags: e.tags ?? [],
    coverImageUrl: e.coverImageUrl,
    startDateTime: new Date(e.startDateTime),
    endDateTime: new Date(e.endDateTime),
    timezone: e.timezone,
    location: e.location,
    isOnline: e.isOnline,
    status: e.status,
  };
}

export function SearchPageClient(props: { q: string; events: SearchEventRow[] }) {
  const router = useRouter();
  const { q, events } = props;
  const hasQuery = q.length > 0;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const nextQ = String(fd.get("q") ?? "").trim();
    const next = nextQ ? `/search?q=${encodeURIComponent(nextQ)}` : "/search";
    router.replace(next, { scroll: false });
  };

  const emptyPrompt = !hasQuery;
  const noResults =
    hasQuery && events !== null && events.length === 0;

  const showGrid = hasQuery && events !== null && events.length > 0;

  return (
    <Stack spacing={3} sx={{ py: 2, position: "relative" }}>
      <Typography variant="h3" component="h1">
        Search
      </Typography>

      <Paper variant="outlined" sx={{ p: 2 }} component="form" onSubmit={onSubmit}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} useFlexGap>
          <TextField
            key={q || "__empty__"}
            name="q"
            label="Events or organisations"
            defaultValue={q}
            fullWidth
            size="small"
            placeholder="Try a title or organisation name"
          />
          <Button type="submit" variant="contained" sx={{ alignSelf: { sm: "center" } }}>
            Search
          </Button>
        </Stack>
      </Paper>

      {emptyPrompt ? (
        <Typography color="text.secondary">Enter a query to search public events.</Typography>
      ) : null}

      {noResults ? (
        <Typography color="text.secondary">No matching public events.</Typography>
      ) : null}

      {showGrid ? (
        <Box sx={{ transition: "opacity 0.15s ease" }}>
          <Grid container spacing={2}>
            {events.map((event) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={event.id}>
                <EventCard
                  orgSlug={event.organisation.slug}
                  event={toEventCardShape(event)}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      ) : null}
    </Stack>
  );
}
