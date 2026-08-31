"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { updateAccountPassword } from "@/app/actions/account";

export function AccountPasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const title = hasPassword ? "Change password" : "Add a password";
  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const passwordsDoNotMatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: "16px" }}
    >
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (newPassword.length < 8) {
            setError("New password must be at least 8 characters.");
            return;
          }
          if (newPassword !== confirmPassword) {
            setError("New passwords do not match.");
            return;
          }
          startTransition(async () => {
            const result = await updateAccountPassword({
              currentPassword,
              newPassword,
              confirmPassword,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            await signOut({ callbackUrl: "/login" });
          });
        }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h6">{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {hasPassword
              ? "Changing your password signs you out on every device."
              : "Add email-and-password sign-in alongside your Google account. You will be signed out after it is set."}
          </Typography>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {hasPassword ? (
          <TextField
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
            fullWidth
          />
        ) : null}
        <TextField
          label="New password"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          helperText="At least 8 characters."
          error={passwordTooShort}
          slotProps={{ htmlInput: { minLength: 8, maxLength: 128 } }}
          required
          fullWidth
        />
        <TextField
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          error={passwordsDoNotMatch}
          helperText={passwordsDoNotMatch ? "Passwords do not match." : " "}
          required
          fullWidth
        />
        <Button
          type="submit"
          variant="contained"
          disabled={
            pending ||
            !newPassword ||
            !confirmPassword ||
            passwordTooShort ||
            passwordsDoNotMatch
          }
          sx={{ alignSelf: "flex-start" }}
        >
          {pending ? "Saving…" : title}
        </Button>
      </Stack>
    </Paper>
  );
}
