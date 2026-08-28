"use client";

import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { resendEmailVerification, signUpWithPassword } from "@/app/actions/auth";

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

const inputSx = {
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
    "& input:-webkit-autofill": {
      WebkitTextFillColor: "rgba(255,255,255,0.92)",
      WebkitBoxShadow: "0 0 0 100px #1c1c1e inset",
      caretColor: "rgba(255,255,255,0.92)",
    },
  },
};

const primaryButtonSx = {
  textTransform: "none",
  borderRadius: 999,
  py: 1.1,
  color: "rgba(6,18,14,0.92)",
  fontWeight: 600,
  background:
    "linear-gradient(90deg, rgba(124, 245, 182, 0.92), rgba(67, 214, 170, 0.92))",
  boxShadow: "0 10px 30px rgba(124, 245, 182, 0.18)",
  "&:hover": {
    background:
      "linear-gradient(90deg, rgba(124, 245, 182, 1), rgba(67, 214, 170, 1))",
  },
};

type Mode = "signin" | "signup";

export function LoginForm({ accountCreationEnabled, googleSsoConfigured }: { accountCreationEnabled: boolean; googleSsoConfigured: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const callbackUrl = useMemo(() => {
    const c = sp.get("callbackUrl")?.trim();
    return c && c.startsWith("/") && !c.startsWith("//") ? c : "/dashboard";
  }, [sp]);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(() =>
    sp.get("verified") === "1" ? "Email verified. You can now sign in." : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);

  function resetStatus() {
    setError(null);
    setMessage(null);
    setFieldErrors({});
  }

  function resetMfaChallenge() {
    setMfaRequired(false);
    setTotp("");
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    resetStatus();
    setLoading("credentials");
    let r;
    try {
      r = await signIn("credentials", {
        email,
        password,
        totp,
        redirect: false,
      });
    } catch {
      setLoading(null);
      setError("Sign-in is temporarily unavailable. Please refresh the page and try again.");
      return;
    }
    setLoading(null);
    if (!r) {
      setError("Unexpected error. Please try again.");
      return;
    }
    if (r.error) {
      if (r.code === "mfa_required") {
        setMfaRequired(true);
        return;
      }
      if (r.code === "email_verification_required") {
        setNeedsEmailVerification(true);
        setMessage("Verify your email before signing in. You can request a new link below.");
        return;
      }
      setError(mfaRequired ? "Invalid authenticator or recovery code." : "Invalid email or password.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    resetStatus();
    setLoading("signup");
    const res = await signUpWithPassword({ name, email, password });
    if (!res.ok) {
      setError(res.error);
      setFieldErrors(res.fieldErrors ?? {});
      setLoading(null);
      return;
    }
    setLoading(null);
    setNeedsEmailVerification(true);
    setMessage("Check your inbox for a link to verify your email and activate your account.");
    setMode("signin");
    setPassword("");
  }

  async function handleResendVerification() {
    resetStatus();
    setLoading("resend-verification");
    const result = await resendEmailVerification({ email });
    setLoading(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("If that account needs verification, a new link has been sent.");
  }

  const isSignUp = mode === "signup";

  if (mfaRequired) {
    return (
      <Stack component="form" spacing={2.5} onSubmit={handleSignIn}>
        <Stack spacing={0.5}>
          <Typography variant="h5" component="h2" sx={{ color: "common.white", fontWeight: 700 }}>
            Verify it&apos;s you
          </Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)" }}>
            Enter the code from your authenticator app for {email}.
          </Typography>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <TextField
          label="Authenticator or recovery code"
          required
          fullWidth
          autoFocus
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          autoComplete="one-time-code"
          helperText="Use a six-digit authenticator code or a recovery code."
          sx={inputSx}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!!loading}
          fullWidth
          sx={primaryButtonSx}
        >
          {loading === "credentials" ? "Verifying…" : "Verify and sign in"}
        </Button>

        <Button
          type="button"
          variant="text"
          disabled={!!loading}
          onClick={() => {
            resetMfaChallenge();
            resetStatus();
          }}
          sx={{ alignSelf: "center", color: "rgba(255,255,255,0.7)", textTransform: "none" }}
        >
          Use a different account
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Tabs
        value={mode}
        onChange={(_, v: Mode) => {
          setMode(v);
          resetStatus();
          resetMfaChallenge();
          setNeedsEmailVerification(false);
        }}
        variant="fullWidth"
        sx={{
          minHeight: 40,
          "& .MuiTabs-indicator": {
            backgroundColor: "rgba(124, 245, 182, 0.8)",
            height: 2,
          },
          "& .MuiTab-root": {
            minHeight: 40,
            textTransform: "none",
            color: "rgba(255,255,255,0.6)",
            fontWeight: 500,
            "&.Mui-selected": { color: "rgba(255,255,255,0.95)" },
          },
        }}
      >
        <Tab label="Sign in" value="signin" />
        {accountCreationEnabled ? <Tab label="Create account" value="signup" /> : null}
      </Tabs>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      {needsEmailVerification ? (
        <Button variant="outlined" disabled={!!loading || !email} onClick={handleResendVerification} sx={{ textTransform: "none", alignSelf: "flex-start", color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.35)" }}>
          {loading === "resend-verification" ? "Sending…" : "Resend verification email"}
        </Button>
      ) : null}

      {googleSsoConfigured ? (
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
            resetStatus();
            setLoading("google");
            void signIn("google", { callbackUrl });
          }}
        >
          <GoogleMark />
          Continue with Google
        </Button>
      ) : (
        <Alert severity="info" variant="outlined">
          Google sign-in is not configured for this instance.
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
        onSubmit={isSignUp ? handleSignUp : handleSignIn}
      >
        {isSignUp ? (
          <TextField
            label="Name"
            required
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            error={!!fieldErrors.name}
            helperText={fieldErrors.name?.[0]}
            sx={inputSx}
          />
        ) : null}
        <TextField
          label="Email"
          type="email"
          required
          fullWidth
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            resetMfaChallenge();
          }}
          autoComplete="email"
          error={!!fieldErrors.email}
          helperText={fieldErrors.email?.[0]}
          sx={inputSx}
        />
        <TextField
          label="Password"
          type="password"
          required
          fullWidth
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            resetMfaChallenge();
          }}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          slotProps={{ htmlInput: { minLength: isSignUp ? 8 : undefined, maxLength: 128 } }}
          error={!!fieldErrors.password}
          helperText={
            fieldErrors.password?.[0] ??
            (isSignUp ? "At least 8 characters." : undefined)
          }
          sx={inputSx}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!!loading}
          fullWidth
          sx={primaryButtonSx}
        >
          {isSignUp
            ? loading === "signup"
              ? "Creating account…"
              : "Create account"
            : loading === "credentials"
              ? "Signing in…"
              : "Sign in"}
        </Button>
      </Stack>

      {!isSignUp ? (
        <Box sx={{ textAlign: "right" }}>
          <Link
            component="a"
            href="/reset-password"
            underline="hover"
            sx={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "0.8125rem",
              "&:hover": { color: "rgba(255,255,255,0.9)" },
            }}
          >
            Forgot password?
          </Link>
        </Box>
      ) : null}

      {accountCreationEnabled ? <Box sx={{ textAlign: "center" }}>
        <Link
          component="button"
          type="button"
          underline="hover"
          onClick={() => {
            setMode(isSignUp ? "signin" : "signup");
            resetStatus();
            resetMfaChallenge();
            setNeedsEmailVerification(false);
          }}
          sx={{
            color: "rgba(255,255,255,0.7)",
            fontSize: "0.875rem",
            "&:hover": { color: "rgba(255,255,255,0.95)" },
          }}
        >
          {isSignUp
            ? "Already have an account? Sign in"
            : "Don't have an account? Create one"}
        </Link>
      </Box> : null}
    </Stack>
  );
}
