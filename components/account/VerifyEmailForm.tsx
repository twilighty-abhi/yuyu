"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { confirmEmailVerification } from "@/app/actions/auth";

export function VerifyEmailForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Stack spacing={2.5}>
      <Typography color="text.secondary">
        Confirming your email activates your account and lets you create events.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Button
        variant="contained"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await confirmEmailVerification({ token });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.replace("/login?verified=1");
            router.refresh();
          });
        }}
      >
        {pending ? "Verifying…" : "Verify email"}
      </Button>
    </Stack>
  );
}
