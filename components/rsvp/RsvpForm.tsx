"use client";

import { useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { submitRsvp } from "@/app/actions/rsvp";

export function RsvpForm(props: { orgSlug: string; eventSlug: string }) {
  const { orgSlug, eventSlug } = props;
  const { data: session, status } = useSession();
  const [guestEmail, setGuestEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (status === "loading") {
    return <Typography color="text.secondary">Loading…</Typography>;
  }

  if (done) {
    return (
      <Alert severity="success">
        You&apos;re on the list. See you at the event.
      </Alert>
    );
  }

  if (session?.user) {
    return (
      <Box>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Button
          variant="contained"
          size="large"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await submitRsvp({ orgSlug, eventSlug });
              if (!res.ok) setError(res.error);
              else setDone(true);
            });
          }}
        >
          RSVP
        </Button>
      </Box>
    );
  }

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await submitRsvp({ orgSlug, eventSlug, guestEmail });
          if (!res.ok) setError(res.error);
          else setDone(true);
        });
      }}
    >
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        RSVP with your email
      </Typography>
      <TextField
        name="guestEmail"
        label="Email"
        type="email"
        required
        fullWidth
        value={guestEmail}
        onChange={(e) => setGuestEmail(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Button variant="contained" size="large" disabled={pending} type="submit">
        RSVP
      </Button>
    </Box>
  );
}
