"use client";

import { useState, useTransition } from "react";
import Alert from "@mui/material/Alert";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { setNewUserRegistrationEnabled } from "@/app/actions/instance-settings";

export function AccountCreationControl({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
      <Stack spacing={1}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>New account creation</Typography>
        <Typography variant="body2" color="text.secondary">
          When disabled, password and Google sign-in remain available only for existing users.
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <FormControlLabel
          label={enabled ? "New users can create accounts" : "New account creation is disabled"}
          control={
            <Switch
              checked={enabled}
              disabled={pending}
              onChange={(_, checked) => {
                const previous = enabled;
                setEnabled(checked);
                setError(null);
                startTransition(async () => {
                  const result = await setNewUserRegistrationEnabled({ allowNewUserSignups: checked });
                  if (!result.ok) {
                    setEnabled(previous);
                    setError(result.error);
                  }
                });
              }}
            />
          }
        />
      </Stack>
    </Paper>
  );
}
