import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Link from "next/link";

function formatRange(start: Date, end: Date, timeZone: string) {
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  };
  return `${start.toLocaleString(undefined, opts)} – ${end.toLocaleString(undefined, { timeStyle: "short", timeZone })}`;
}

export function InstanceCard(props: {
  orgSlug: string;
  instanceId: string;
  title: string;
  description: string;
  startDateTime: Date;
  endDateTime: Date;
  timezone: string;
  isOnline?: boolean;
}) {
  const {
    orgSlug,
    instanceId,
    title,
    description,
    startDateTime,
    endDateTime,
    timezone,
    isOnline,
  } = props;
  const href = `/${orgSlug}/i/${instanceId}`;
  const desc =
    description.length > 120
      ? `${description.slice(0, 117)}…`
      : description;

  return (
    <Card variant="outlined">
      <Link
        href={href}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <CardActionArea component="div">
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
              <Chip label="Series" size="small" variant="outlined" color="primary" />
              {isOnline ? (
                <Chip label="Online" size="small" variant="outlined" />
              ) : null}
            </Stack>
            <Typography variant="h6" component="h3" gutterBottom>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {formatRange(startDateTime, endDateTime, timezone)}
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
