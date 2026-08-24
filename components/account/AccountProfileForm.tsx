"use client";

import { useState, useTransition } from "react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { updateAccountProfile } from "@/app/actions/account";
import { useToast } from "@/components/feedback/ToastProvider";

export function AccountProfileForm(props: {
  initialName: string;
  email: string | null;
  image: string | null;
  gravatarUrl: string | null;
  createdAt: Date;
}) {
  const { email, image, gravatarUrl, createdAt } = props;
  const [name, setName] = useState(props.initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();
  const avatarSource = image ?? gravatarUrl ?? undefined;
  const initials = name.trim().slice(0, 1).toUpperCase() || "U";

  return (
    <Stack
      component="form"
      spacing={2.5}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateAccountProfile({ name });
          if (!result.ok) {
            setError(result.error);
            showToast(result.error, "error");
            return;
          }
          setName(result.data?.name ?? name.trim());
          showToast("Profile saved", "success");
        });
      }}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: "16px" }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Avatar src={avatarSource} alt={name} sx={{ width: 72, height: 72, fontSize: 28 }}>
              {initials}
            </Avatar>
            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{name || "Your profile"}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>{email ?? "No email address"}</Typography>
              <Typography variant="caption" color="text.secondary">
                {image ? "Profile image from your sign-in provider." : "Uses your Gravatar when available, otherwise your initials."}
              </Typography>
            </Stack>
          </Stack>
          <Divider />
          <TextField
            label="Display name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <TextField label="Email address" value={email ?? ""} fullWidth disabled helperText="Email changes will be available in a future update." />
          <Typography variant="caption" color="text.secondary">
            Account created {createdAt.toLocaleDateString(undefined, { dateStyle: "medium" })}
          </Typography>
          <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: "flex-start" }}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
