"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { acceptEventCollaboratorInvite, acceptOrganisationInvite } from "@/app/actions/invite-acceptance";

export function AcceptInviteButton(props: { kind: "organisation" | "collaborator"; token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Button variant="contained" disabled={pending} onClick={() => startTransition(async () => {
        setError(null);
        const result = props.kind === "organisation" ? await acceptOrganisationInvite(props.token) : await acceptEventCollaboratorInvite(props.token);
        if (!result.ok || !result.data) {
          setError(result.ok ? "This invite is unavailable." : result.error);
          return;
        }
        router.replace(result.data.href);
        router.refresh();
      })}>
        {pending ? "Accepting…" : "Accept invite"}
      </Button>
    </Stack>
  );
}
