"use client";

import { useTransition } from "react";
import Button from "@mui/material/Button";
import { publishEvent } from "@/app/actions/event";

export function PublishEventButton(props: {
  organisationSlug: string;
  eventSlug: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="small"
      variant="contained"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          void publishEvent({
            organisationSlug: props.organisationSlug,
            eventSlug: props.eventSlug,
          });
        });
      }}
      sx={{
        backgroundColor: "#0A84FF",
        color: "#FFFFFF",
        fontWeight: 600,
        textTransform: "none",
        borderRadius: "8px",
        px: 2.5,
        "&:hover": {
          backgroundColor: "#0A84FF",
          opacity: 0.9,
        },
      }}
    >
      {pending ? "Publishing..." : "Publish Event"}
    </Button>
  );
}
