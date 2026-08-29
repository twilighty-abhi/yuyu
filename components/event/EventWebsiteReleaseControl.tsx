"use client";

import { useTransition } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { setEventPagePublished } from "@/app/actions/event-website";

export function EventWebsiteReleaseControl({ organisationSlug, eventId, isPublished }: { organisationSlug: string; eventId: string; isPublished: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Alert severity={isPublished ? "success" : "warning"}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}><Typography>{isPublished ? "This event website is public." : "This event website is private. Only authorized organizers can preview it."}</Typography><Button color={isPublished ? "warning" : "primary"} variant="contained" disabled={pending} onClick={() => startTransition(async () => { const result = await setEventPagePublished({ organisationSlug, eventId, isPublished: !isPublished }); if (result.ok) router.refresh(); })}>{isPublished ? "Unpublish website" : "Publish website"}</Button></Stack></Alert>;
}
