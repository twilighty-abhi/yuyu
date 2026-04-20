import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Link from "next/link";
import type { Event } from "@prisma/client";

function formatEventRange(start: Date, end: Date, timeZone: string) {
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  };
  return `${start.toLocaleString(undefined, opts)} – ${end.toLocaleString(undefined, { timeStyle: "short", timeZone })}`;
}

export function EventCard(props: {
  orgSlug: string;
  event: Pick<
    Event,
    | "title"
    | "slug"
    | "description"
    | "coverImageUrl"
    | "startDateTime"
    | "endDateTime"
    | "timezone"
    | "location"
    | "isOnline"
    | "status"
  >;
}) {
  const { orgSlug, event } = props;
  const href = `/${orgSlug}/${event.slug}`;
  const desc =
    event.description.length > 120
      ? `${event.description.slice(0, 117)}…`
      : event.description;

  return (
    <Card variant="outlined">
      <CardActionArea component={Link} href={href}>
        {event.coverImageUrl ? (
          <CardMedia
            component="img"
            height="140"
            image={event.coverImageUrl}
            alt=""
            sx={{ objectFit: "cover" }}
          />
        ) : null}
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
            {event.status !== "PUBLISHED" ? (
              <Chip label="Draft" size="small" color="warning" variant="outlined" />
            ) : null}
            {event.isOnline ? (
              <Chip label="Online" size="small" variant="outlined" />
            ) : null}
          </Stack>
          <Typography variant="h6" component="h3" gutterBottom>
            {event.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {formatEventRange(
              event.startDateTime,
              event.endDateTime,
              event.timezone,
            )}
          </Typography>
          {desc ? (
            <Typography variant="body2" color="text.secondary">
              {desc}
            </Typography>
          ) : null}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
