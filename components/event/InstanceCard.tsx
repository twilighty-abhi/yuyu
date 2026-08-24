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
  return `${start.toLocaleString("en-US", opts)} – ${end.toLocaleString("en-US", { timeStyle: "short", timeZone })}`;
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
    <Card
      variant="outlined"
      sx={{
        height: "100%",
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
          <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
            <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: "wrap" }}>
              <Chip label="Series" size="small" variant="outlined" color="primary" />
              {isOnline ? (
                <Chip label="Online" size="small" variant="outlined" />
              ) : null}
            </Stack>
            <Typography variant="h6" component="h3" sx={{ fontWeight: 700, letterSpacing: "-0.25px", mb: 0.75 }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              {formatRange(startDateTime, endDateTime, timezone)}
            </Typography>
            {desc ? (
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                {desc}
              </Typography>
            ) : null}
          </CardContent>
        </CardActionArea>
      </Link>
    </Card>
  );
}
