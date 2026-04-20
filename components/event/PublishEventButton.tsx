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
      variant="outlined"
      color="primary"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          void publishEvent({
            organisationSlug: props.organisationSlug,
            eventSlug: props.eventSlug,
          });
        });
      }}
    >
      Publish
    </Button>
  );
}
