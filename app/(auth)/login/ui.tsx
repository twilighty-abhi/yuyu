"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";

const showGoogle = process.env.NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED === "1";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}
      {showGoogle ? (
        <Button
          variant="outlined"
          size="large"
          disabled={!!loading}
          onClick={() => {
            setError(null);
            setLoading("google");
            void signIn("google", { callbackUrl: "/dashboard" });
          }}
        >
          Continue with Google
        </Button>
      ) : (
        <Alert severity="info">
          Set <code>AUTH_GOOGLE_ID</code>, <code>AUTH_GOOGLE_SECRET</code>, and{" "}
          <code>NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED=1</code> in <code>.env</code>{" "}
          to enable Google sign-in.
        </Alert>
      )}
      <Divider>or</Divider>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setMessage(null);
          setLoading("email");
          void signIn("email", {
            email,
            callbackUrl: "/dashboard",
            redirect: false,
          }).then((r) => {
            setLoading(null);
            if (r?.error) setError(r.error);
            else
              setMessage(
                "Check the server console for your magic link (email stub).",
              );
          });
        }}
      >
        <TextField
          label="Email"
          type="email"
          required
          fullWidth
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!!loading}
        >
          Email magic link
        </Button>
      </Stack>
    </Stack>
  );
}
