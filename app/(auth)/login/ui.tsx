"use client";

import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";

const showGoogle = process.env.NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED === "1";

function GoogleMark(props: { size?: number }) {
  const size = props.size ?? 18;
  return (
    <Box
      component="svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      sx={{ display: "block" }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.48 1.22 8.9 3.4l6.6-6.6C35.52 2.8 30.12 0 24 0 14.64 0 6.56 5.38 2.6 13.2l7.74 6.02C12.2 13.1 17.62 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M47.5 24.5c0-1.62-.14-3.18-.4-4.7H24v9.02h13.2c-.58 3-2.28 5.54-4.84 7.26l7.44 5.78C44.2 37.9 47.5 31.8 47.5 24.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.34 28.52A14.5 14.5 0 0 1 9.5 24c0-1.58.26-3.1.84-4.52L2.6 13.2A23.94 23.94 0 0 0 0 24c0 3.88.94 7.54 2.6 10.8l7.74-6.28z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.12 0 11.52-2.02 15.8-5.52l-7.44-5.78c-2.06 1.4-4.7 2.22-8.36 2.22-6.38 0-11.8-3.6-13.66-9.42L2.6 34.8C6.56 42.62 14.64 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </Box>
  );
}

export function LoginForm() {
  const sp = useSearchParams();
  const callbackUrl = useMemo(() => {
    const c = sp.get("callbackUrl")?.trim();
    return c && c.startsWith("/") ? c : "/dashboard";
  }, [sp]);

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
          variant="contained"
          size="large"
          fullWidth
          disabled={!!loading}
          sx={{
            justifyContent: "center",
            gap: 1,
            backgroundColor: "rgba(255,255,255,0.96)",
            color: "rgba(0,0,0,0.86)",
            textTransform: "none",
            borderRadius: 999,
            py: 1.1,
            boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
            "&:hover": {
              backgroundColor: "rgba(255,255,255,1)",
              boxShadow: "0 14px 34px rgba(0,0,0,0.22)",
            },
          }}
          onClick={() => {
            setError(null);
            setLoading("google");
            void signIn("google", { callbackUrl });
          }}
        >
          <GoogleMark />
          Continue with Google
        </Button>
      ) : (
        <Alert severity="info" variant="outlined">
          Set <code>AUTH_GOOGLE_ID</code>, <code>AUTH_GOOGLE_SECRET</code>, and{" "}
          <code>NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED=1</code> in <code>.env</code>{" "}
          to enable Google sign-in.
        </Alert>
      )}
      <Divider
        sx={{
          color: "rgba(255,255,255,0.55)",
          borderColor: "rgba(255,255,255,0.12)",
          "&::before, &::after": { borderColor: "rgba(255,255,255,0.12)" },
        }}
      >
        or
      </Divider>
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
            callbackUrl,
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
          sx={{
            "& .MuiInputLabel-root": { color: "rgba(255,255,255,0.65)" },
            "& .MuiInputLabel-root.Mui-focused": {
              color: "rgba(255,255,255,0.85)",
            },
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              backgroundColor: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.92)",
              "& fieldset": { borderColor: "rgba(255,255,255,0.16)" },
              "&:hover fieldset": { borderColor: "rgba(255,255,255,0.26)" },
              "&.Mui-focused fieldset": {
                borderColor: "rgba(124, 245, 182, 0.65)",
              },
            },
          }}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!!loading}
          fullWidth
          sx={{
            textTransform: "none",
            borderRadius: 999,
            py: 1.1,
            background:
              "linear-gradient(90deg, rgba(124, 245, 182, 0.92), rgba(67, 214, 170, 0.92))",
            boxShadow: "0 10px 30px rgba(124, 245, 182, 0.18)",
            "&:hover": {
              background:
                "linear-gradient(90deg, rgba(124, 245, 182, 1), rgba(67, 214, 170, 1))",
            },
          }}
        >
          Email magic link
        </Button>
      </Stack>
    </Stack>
  );
}
