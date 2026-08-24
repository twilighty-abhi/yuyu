"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { verifySuperAdminMfa } from "@/app/actions/super-admin-mfa";

export function SuperAdminMfaPrompt() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Stack sx={{ maxWidth: 480, mx: "auto", py: { xs: 5, sm: 9 } }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5} component="form" onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            setError(null);
            const result = await verifySuperAdminMfa({ code });
            if (!result.ok) { setError(result.error); return; }
            router.replace("/super-admin");
            router.refresh();
          });
        }}>
          <Stack spacing={0.75}>
            <Typography variant="h4" component="h1">Verify super-admin access</Typography>
            <Typography color="text.secondary">Enter a current code from your authenticator app. This separate verification expires after 10 minutes.</Typography>
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            label="Six-digit authenticator code"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            value={code}
          />
          <Button type="submit" variant="contained" disabled={pending || code.length !== 6}>
            {pending ? "Verifying…" : "Verify and continue"}
          </Button>
          <Typography variant="body2" color="text.secondary">MFA is required for this panel. Set it up from Account security if it is not enabled.</Typography>
        </Stack>
      </Paper>
    </Stack>
  );
}
