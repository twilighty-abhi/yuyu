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

function statusChip(status: Event["status"]) {
  if (status === "DRAFT") {
    return (
      <Chip label="Draft" size="small" color="warning" variant="outlined" />
    );
  }
  if (status === "HIDDEN") {
    return <Chip label="Hidden" size="small" color="default" variant="outlined" />;
  }
  return null;
}

export function EventCard(props: {
  orgSlug: string;
  /** Defaults to public event URL. */
  href?: string;
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
  > & {
    tags?: string[] | null;
  };
}) {
  const { orgSlug, event } = props;
  const href = props.href ?? `/${orgSlug}/${event.slug}`;
  const desc =
    event.description.length > 120
      ? `${event.description.slice(0, 117)}…`
      : event.description;
  const tags = Array.isArray(event.tags) ? event.tags : [];

  return (
    <Card variant="outlined">
      <Link
        href={href}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <CardActionArea component="div">
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
              {statusChip(event.status)}
              {event.isOnline ? (
                <Chip label="Online" size="small" variant="outlined" />
              ) : null}
              {tags.slice(0, 3).map((t) => (
                <Chip key={t} label={t} size="small" variant="outlined" />
              ))}
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
      </Link>
    </Card>
  );
}
