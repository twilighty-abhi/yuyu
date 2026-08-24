"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import QRCode from "react-qr-code";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa, revokeAllSessions } from "@/app/actions/security";

export function AccountSecurityClient(props: { mfaEnabled: boolean }) {
  const [enabled, setEnabled] = useState(props.mfaEnabled);
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (task: () => Promise<void>) => startTransition(async () => { setError(null); setMessage(null); await task(); });

  return <Stack spacing={3}>
    {error ? <Alert severity="error">{error}</Alert> : null}
    {message ? <Alert severity="success">{message}</Alert> : null}
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Authenticator MFA</Typography>
        <Typography color="text.secondary">Protect password sign-in with a six-digit authenticator code. Google sign-in remains governed by your Google account security policy.</Typography>
        {recoveryCodes.length > 0 ? <Alert severity="warning"><Typography sx={{ fontWeight: 700 }}>Save these one-time recovery codes now.</Typography><Box component="pre" sx={{ whiteSpace: "pre-wrap", mb: 0 }}>{recoveryCodes.join("\n")}</Box><Button onClick={() => void signOut({ callbackUrl: "/login" })}>I saved them — sign in again</Button></Alert> : null}
        {!enabled && !enrollment ? <Button variant="contained" disabled={pending} onClick={() => run(async () => { const result = await beginMfaEnrollment(); if (!result.ok || !result.data) setError(result.ok ? "Could not start MFA setup." : result.error); else setEnrollment(result.data); })}>Set up MFA</Button> : null}
        {enrollment ? <Stack spacing={2} sx={{ alignItems: "flex-start" }}><Box sx={{ bgcolor: "white", p: 2 }}><QRCode value={enrollment.uri} size={180} /></Box><Typography variant="body2" sx={{ wordBreak: "break-all" }}>Manual key: {enrollment.secret}</Typography><TextField label="Six-digit code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" /><Button variant="contained" disabled={pending} onClick={() => run(async () => { const result = await confirmMfaEnrollment({ code }); if (!result.ok || !result.data) setError(result.ok ? "Could not enable MFA." : result.error); else { setEnabled(true); setEnrollment(null); setRecoveryCodes(result.data.recoveryCodes); setCode(""); } })}>Verify and enable</Button></Stack> : null}
        {enabled && recoveryCodes.length === 0 ? <Stack direction={{ xs: "column", sm: "row" }} spacing={1}><TextField label="Authenticator or recovery code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" /><Button color="error" variant="outlined" disabled={pending} onClick={() => run(async () => { const result = await disableMfa({ code }); if (!result.ok) setError(result.error); else { setEnabled(false); setCode(""); await signOut({ callbackUrl: "/login" }); } })}>Disable MFA</Button></Stack> : null}
      </Stack>
    </Paper>
    <Divider />
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Active sessions</Typography>
        <Typography color="text.secondary">Revoke every issued session, including this browser. You will need to sign in again.</Typography>
        <Button color="warning" variant="outlined" disabled={pending} onClick={() => run(async () => { const result = await revokeAllSessions(); if (!result.ok) setError(result.error); else await signOut({ callbackUrl: "/login" }); })}>Revoke all sessions</Button>
      </Stack>
    </Paper>
  </Stack>;
}
