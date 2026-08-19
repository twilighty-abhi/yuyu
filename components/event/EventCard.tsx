import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Link from "next/link";
import type { Event } from "@prisma/client";
import { EventCountdownBadge } from "@/components/event/EventCountdownBadge";

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
  /** Denser presentation for collection pages such as Discover. */
  compact?: boolean;
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
  const { orgSlug, event, compact = false } = props;
  const href = props.href ?? `/${orgSlug}/${event.slug}`;
  const desc =
    event.description.length > 120
      ? `${event.description.slice(0, 117)}…`
      : event.description;
  const tags = Array.isArray(event.tags) ? event.tags : [];

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        overflow: "hidden",
        borderRadius: "18px",
        borderColor: "rgba(255,255,255,0.09)",
        backgroundColor: "rgba(28,28,30,0.92)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
        transition: "transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
        "&:hover": {
          transform: "translateY(-3px)",
          borderColor: "rgba(10,132,255,0.42)",
          boxShadow: "0 18px 32px rgba(0,0,0,0.2)",
        },
      }}
    >
      <Link
        href={href}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <CardActionArea component="div" sx={{ height: "100%" }}>
          {event.coverImageUrl ? (
            <CardMedia
              component="img"
              height={compact ? "96" : "140"}
              image={event.coverImageUrl}
              alt=""
              sx={{ objectFit: "cover", display: "block" }}
            />
          ) : null}
          <CardContent sx={{ p: compact ? 1.75 : 2.5, "&:last-child": { pb: compact ? 1.75 : 2.5 } }}>
            <Stack direction="row" spacing={0.75} sx={{ mb: compact ? 1 : 1.5, flexWrap: "wrap" }}>
              {statusChip(event.status)}
              <Chip
                label={event.isOnline ? "Online" : "In person"}
                size="small"
                variant="outlined"
                sx={
                  event.isOnline
                    ? { borderColor: "rgba(10,132,255,0.45)", color: "#72B7FF" }
                    : { borderColor: "rgba(48,209,88,0.4)", color: "#7CE6A2" }
                }
              />
              <EventCountdownBadge
                startAt={event.startDateTime.toISOString()}
                endAt={event.endDateTime.toISOString()}
              />
              {tags.slice(0, 3).map((t) => (
                <Chip key={t} label={t} size="small" variant="outlined" />
              ))}
            </Stack>
            <Typography variant="h6" component="h3" sx={{ fontWeight: 700, letterSpacing: "-0.25px", mb: 0.5, lineHeight: 1.25 }}>
              {event.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: compact ? 0.75 : 1.25 }}>
              {formatEventRange(
                event.startDateTime,
                event.endDateTime,
                event.timezone,
              )}
            </Typography>
            {desc ? (
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: compact ? 2 : undefined, WebkitBoxOrient: "vertical", overflow: compact ? "hidden" : undefined }}>
                {desc}
              </Typography>
            ) : null}
          </CardContent>
        </CardActionArea>
      </Link>
    </Card>
  );
}
