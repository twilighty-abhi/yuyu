"use client";

import Alert from "@mui/material/Alert";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useToast } from "@/components/feedback/ToastProvider";

type Endpoint = {
  title: string;
  scope: string;
  description: string;
  request: string;
  response: string;
};

type ScopeReference = {
  scope: string;
  capability: string;
  includes: string;
  excludes: string;
};

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function CodeBlock(props: { label: string; value: string }) {
  const { showToast } = useToast();
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle2">{props.label}</Typography>
        <Button
          size="small"
          startIcon={<ContentCopyOutlinedIcon />}
          onClick={() => void copyToClipboard(props.value).then(() => showToast(`${props.label} copied`, "success"))}
        >
          Copy
        </Button>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          overflowX: "auto",
          borderRadius: 2,
          bgcolor: "action.hover",
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: "pre",
        }}
      >
        {props.value}
      </Box>
    </Stack>
  );
}

function EndpointReference({ endpoint }: { endpoint: Endpoint }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">{endpoint.description}</Typography>
      <CodeBlock label="Request" value={endpoint.request} />
      <CodeBlock label="Success response" value={endpoint.response} />
    </Stack>
  );
}

export function ApiDeveloperReference({ apiBaseUrl }: { apiBaseUrl: string }) {
  const token = "<credential-shown-once>";
  const eventId = "<event-id>";
  const endpoints: Endpoint[] = [
    {
      title: "List events",
      scope: "events:read",
      description: "Lists this organisation’s standalone events. Use the returned cursor unchanged to fetch the next page.",
      request: `curl --request GET --url "${apiBaseUrl}/events?limit=50" --header "Authorization: Bearer ${token}"`,
      response: `{
  "data": [
    {
      "id": "event-id",
      "title": "Product launch",
      "slug": "product-launch",
      "description": "An introduction to the new product.",
      "tags": ["product", "launch"],
      "coverImageUrl": null,
      "startDateTime": "2030-01-01T10:00:00.000Z",
      "endDateTime": "2030-01-01T11:00:00.000Z",
      "timezone": "UTC",
      "location": "Online",
      "mapLinkUrl": null,
      "isOnline": true,
      "capacity": 100,
      "status": "PUBLISHED",
      "privacyType": "PUBLIC",
      "createdAt": "2029-12-01T09:00:00.000Z"
    }
  ],
  "pagination": { "nextCursor": "opaque-cursor-or-null" }
}`,
    },
    {
      title: "Read an event",
      scope: "events:read",
      description: "Returns one event belonging to this organisation. Keep the event ID from the event-list response.",
      request: `curl --request GET --url "${apiBaseUrl}/events/${eventId}" --header "Authorization: Bearer ${token}"`,
      response: `{
  "data": {
    "id": "event-id",
    "title": "Product launch",
    "slug": "product-launch",
    "description": "An introduction to the new product.",
    "tags": ["product", "launch"],
    "coverImageUrl": null,
    "startDateTime": "2030-01-01T10:00:00.000Z",
    "endDateTime": "2030-01-01T11:00:00.000Z",
    "timezone": "UTC",
    "location": "Online",
    "mapLinkUrl": null,
    "isOnline": true,
    "capacity": 100,
    "status": "PUBLISHED",
    "privacyType": "PUBLIC",
    "createdAt": "2029-12-01T09:00:00.000Z"
  }
}`,
    },
    {
      title: "List confirmed participants",
      scope: "participants:read",
      description: "Lists minimal, confirmed-participant records only. Attendance filters and check-in timestamps require the attendance scope.",
      request: `curl --request GET --url "${apiBaseUrl}/events/${eventId}/participants?attendance=checked_in&include=attendance" --header "Authorization: Bearer ${token}"`,
      response: `{
  "data": [
    {
      "id": "rsvp-id",
      "displayName": "Participant name",
      "registeredAt": "2030-01-01T10:00:00.000Z",
      "checkedInAt": "2030-01-01T10:15:00.000Z"
    }
  ],
  "pagination": { "nextCursor": "opaque-cursor-or-null" }
}`,
    },
  ];
  const scopes: ScopeReference[] = [
    {
      scope: "events:read",
      capability: "Read standalone event metadata owned by this organisation.",
      includes: "List events and read a specific event, including draft, published, and hidden events.",
      excludes: "Participants, RSVP workflow data, contact information, registration answers, and all write operations.",
    },
    {
      scope: "participants:read",
      capability: "Read the minimal confirmed-participant roster for an event owned by this organisation.",
      includes: "RSVP ID, display name, and registration timestamp for confirmed attendees only.",
      excludes: "Email addresses, user IDs, answers, invitations, feedback linkage, attendance state/timestamps, and ticket, check-in, or certificate tokens.",
    },
    {
      scope: "participants:attendance:read",
      capability: "Filter by attendance state and opt in to check-in timestamps for the minimal participant roster.",
      includes: "checked_in/not_checked_in filtering and the nullable checkedInAt timestamp when include=attendance is sent. It also requires participants:read.",
      excludes: "Email addresses, user IDs, answers, invitations, check-in tokens, and all write operations.",
    },
  ];

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)" }}>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>Developer reference</Typography>
          <Typography variant="body2" color="text.secondary">Use this tenant-bound REST API from your backend service or automation.</Typography>
        </Box>
        <Alert severity="warning">Credentials are shown only when created. Keep them in a secret manager; never expose them in browser code, URLs, source control, or logs.</Alert>
        <Accordion variant="outlined" defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", width: "100%", pr: 1 }}>
              <Typography sx={{ fontWeight: 700 }}>Getting started</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>{apiBaseUrl}</Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <CodeBlock label="API base URL" value={apiBaseUrl} />
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
                <Chip label="Bearer authentication" size="small" />
                <Chip label="JSON responses" size="small" />
                <Chip label="No-store caching" size="small" />
                <Chip label="Maximum page size: 100" size="small" />
              </Stack>
            </Stack>
          </AccordionDetails>
        </Accordion>
        <Accordion variant="outlined">
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 700 }}>Scopes ({scopes.length})</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2} divider={<Divider flexItem />}>
              {scopes.map((scope) => (
                <Stack key={scope.scope} spacing={0.75}>
                  <Chip label={scope.scope} size="small" color="primary" variant="outlined" sx={{ alignSelf: "flex-start" }} />
                  <Typography variant="body2">{scope.capability}</Typography>
                  <Typography variant="body2" color="text.secondary"><strong>Includes:</strong> {scope.includes}</Typography>
                  <Typography variant="body2" color="text.secondary"><strong>Does not include:</strong> {scope.excludes}</Typography>
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
        {endpoints.map((endpoint) => (
          <Accordion key={endpoint.title} variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", width: "100%", pr: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>{endpoint.title}</Typography>
                <Chip label={endpoint.scope} size="small" color="primary" variant="outlined" sx={{ alignSelf: { xs: "flex-start", sm: "center" } }} />
              </Stack>
            </AccordionSummary>
            <AccordionDetails><EndpointReference endpoint={endpoint} /></AccordionDetails>
          </Accordion>
        ))}
        <Accordion variant="outlined">
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 700 }}>Pagination and errors</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.25}>
              <Typography variant="body2" color="text.secondary">Collection endpoints default to 50 items and accept `limit` from 1 through 100. When `pagination.nextCursor` is non-null, pass it back as the `cursor` query parameter. Do not inspect or construct cursors.</Typography>
              <CodeBlock label="Error response" value={`{
  "error": {
    "code": "INSUFFICIENT_SCOPE",
    "message": "The credential does not have permission for this resource."
  }
}`} />
              <Typography variant="body2" color="text.secondary">Error codes: `INVALID_REQUEST`, `INVALID_CREDENTIAL`, `INSUFFICIENT_SCOPE`, `RESOURCE_NOT_FOUND`, `RATE_LIMITED`, and `INTERNAL_ERROR`. A rate-limited response includes `Retry-After`.</Typography>
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </Paper>
  );
}
