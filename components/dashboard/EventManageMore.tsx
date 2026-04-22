"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Event } from "@prisma/client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import FileCopyOutlinedIcon from "@mui/icons-material/FileCopyOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import { cloneEvent, deleteEvent, updateEventSlug } from "@/app/actions/event";
import { useToast } from "@/components/feedback/ToastProvider";

function originFromWindow() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

async function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for older browsers.
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function EventManageMore(props: {
  organisationSlug: string;
  event: Event;
}) {
  const { organisationSlug, event } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [slug, setSlug] = useState(event.slug);
  const [confirmText, setConfirmText] = useState("");

  const publicUrl = useMemo(() => {
    const o = originFromWindow();
    const path = `/${organisationSlug}/${slug}`;
    return o ? `${o}${path}` : path;
  }, [organisationSlug, slug]);

  const embedButtonSnippet = useMemo(() => {
    return `<a href="${publicUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#ffffff;color:#111111;text-decoration:none;font-family:system-ui;font-weight:600;">Register for Event</a>`;
  }, [publicUrl]);

  const embedPageSnippet = useMemo(() => {
    return `<iframe src="${publicUrl}" title="${event.title.replace(/"/g, "&quot;")}" style="width:100%;height:720px;border:1px solid rgba(255,255,255,0.12);border-radius:16px;overflow:hidden;"></iframe>`;
  }, [event.title, publicUrl]);

  const doUpdateSlug = () => {
    startTransition(async () => {
      const res = await updateEventSlug({
        organisationSlug,
        eventId: event.id,
        slug,
      });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Event URL updated", "success");
      router.refresh();
    });
  };

  const doClone = () => {
    startTransition(async () => {
      const res = await cloneEvent({ organisationSlug, eventId: event.id });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Event cloned", "success");
      router.push(`/dashboard/${organisationSlug}/event/${res.data!.eventId}`);
    });
  };

  const doDelete = () => {
    startTransition(async () => {
      const res = await deleteEvent({ organisationSlug, eventId: event.id });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Event cancelled", "success");
      router.push(`/dashboard/${organisationSlug}`);
      router.refresh();
    });
  };

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <FileCopyOutlinedIcon color="primary" />
            <Typography variant="h6" component="h2">
              Clone event
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Create a new event with the same information as this one. RSVP guest
            list and invites won’t be copied.
          </Typography>
          <Box>
            <Button variant="contained" onClick={doClone} disabled={pending}>
              Clone event
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <LinkOutlinedIcon color="primary" />
            <Typography variant="h6" component="h2">
              Event page
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Change your public URL. If you’ve already shared the old link, it may
            stop working.
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap>
            <TextField
              label="Public URL slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              size="small"
              fullWidth
              helperText="lowercase letters, numbers, hyphens"
              disabled={pending}
            />
            <Button
              variant="outlined"
              onClick={doUpdateSlug}
              disabled={pending || slug.trim() === event.slug}
              sx={{ flexShrink: 0 }}
            >
              Update
            </Button>
            <Button
              variant="outlined"
              startIcon={<ContentCopyOutlinedIcon />}
              onClick={() => {
                void copyToClipboard(publicUrl).then(() => {
                  showToast("Copied URL", "success");
                });
              }}
              disabled={pending}
              sx={{ flexShrink: 0 }}
            >
              Copy
            </Button>
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", pt: 0.5 }}
          >
            <Chip size="small" label="Public URL" variant="outlined" />
            <Typography
              variant="body2"
              sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
            >
              {publicUrl}
            </Typography>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1.25}>
          <Typography variant="h6" component="h2">
            Embed event
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Add a button or an embedded page to your website.
          </Typography>

          <Stack spacing={1}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
            >
              <Typography variant="subtitle2">Embed as Button</Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyOutlinedIcon />}
                onClick={() => {
                  void copyToClipboard(embedButtonSnippet).then(() =>
                    showToast("Copied embed snippet", "success"),
                  );
                }}
              >
                Copy snippet
              </Button>
            </Stack>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: "action.hover",
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {embedButtonSnippet}
            </Paper>
          </Stack>

          <Divider />

          <Stack spacing={1}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
            >
              <Typography variant="subtitle2">Embed Event Page</Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyOutlinedIcon />}
                onClick={() => {
                  void copyToClipboard(embedPageSnippet).then(() =>
                    showToast("Copied embed snippet", "success"),
                  );
                }}
              >
                Copy snippet
              </Button>
            </Stack>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: "action.hover",
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {embedPageSnippet}
            </Paper>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3, borderColor: "error.main" }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <DeleteOutlineOutlinedIcon color="error" />
            <Typography variant="h6" component="h2">
              Cancel event
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Permanently deletes this event and its registrations. This can’t be
            undone.
          </Typography>
          <Alert severity="warning" variant="outlined">
            Type <strong>{event.slug}</strong> to confirm.
          </Alert>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap>
            <TextField
              label="Confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              size="small"
              fullWidth
              disabled={pending}
            />
            <Button
              variant="contained"
              color="error"
              onClick={doDelete}
              disabled={pending || confirmText.trim() !== event.slug}
              sx={{ flexShrink: 0 }}
            >
              Cancel event
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}

