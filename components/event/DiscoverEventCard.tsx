import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

function formatStart(start: Date, timeZone: string) {
  return start.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export function DiscoverEventCard(props: {
  orgSlug: string;
  organisationName: string;
  event: {
    slug: string;
    title: string;
    coverImageUrl: string | null;
    startDateTime: Date;
    timezone: string;
    isOnline: boolean;
  };
}) {
  const { orgSlug, organisationName, event } = props;

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        overflow: "hidden",
        borderRadius: "16px",
        borderColor: "divider",
        backgroundColor: "background.paper",
        transition: "transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
        "&:hover": {
          transform: "translateY(-2px)",
          borderColor: "primary.main",
          boxShadow: "0 14px 28px rgba(0,0,0,0.18)",
        },
      }}
    >
      <Link href={`/${orgSlug}/${event.slug}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
        <CardActionArea component="div" sx={{ minHeight: 128, display: "flex", alignItems: "stretch", textAlign: "left" }}>
          {event.coverImageUrl ? (
            <CardMedia
              component="img"
              image={event.coverImageUrl}
              alt=""
              sx={{ width: 128, minWidth: 128, minHeight: 128, objectFit: "cover" }}
            />
          ) : null}
          <CardContent sx={{ flex: 1, minWidth: 0, p: 1.75, "&:last-child": { pb: 1.75 } }}>
            <Stack spacing={0.75}>
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {event.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {formatStart(event.startDateTime, event.timezone)}
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ minWidth: 0, alignItems: "center" }}>
                <Chip
                  label={event.isOnline ? "Online" : "In person"}
                  size="small"
                  variant="outlined"
                  color={event.isOnline ? "primary" : "success"}
                />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {organisationName}
                </Typography>
              </Stack>
            </Stack>
          </CardContent>
        </CardActionArea>
      </Link>
    </Card>
  );
}
