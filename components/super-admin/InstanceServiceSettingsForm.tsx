"use client";

import { useState, useTransition } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { saveInstanceServiceSettings } from "@/app/actions/instance-settings";

type Values = { emailFrom: string; smtpService: string; smtpHost: string; smtpPort: string; smtpSecure: boolean; smtpUser: string; smtpAllowUnauthenticated: boolean; googleClientId: string; backupProvider: string; backupLastSuccessAt: string; backupRetentionDays: string; hasSmtpPassword: boolean; hasGoogleClientSecret: boolean };
export function InstanceServiceSettingsForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState(initial); const [smtpPassword, setSmtpPassword] = useState(""); const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [status, setStatus] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const set = (key: keyof Values, value: string | boolean) => setValues((current) => ({ ...current, [key]: value }));
  function submit() { startTransition(async () => { setStatus(null); const result = await saveInstanceServiceSettings({ ...values, smtpPort: values.smtpPort || undefined, backupRetentionDays: values.backupRetentionDays || undefined, backupLastSuccessAt: values.backupLastSuccessAt ? new Date(values.backupLastSuccessAt).toISOString() : undefined, smtpPassword: smtpPassword || undefined, googleClientSecret: googleClientSecret || undefined }); setStatus(result.ok ? "Settings saved." : result.error ?? "Could not save settings."); }); }
  const field = (key: keyof Values, label: string, type = "text") => <TextField size="small" label={label} type={type} value={values[key] as string} onChange={(event) => set(key, event.target.value)} />;
  return <Stack component="form" onSubmit={(event) => { event.preventDefault(); submit(); }} spacing={2}>
    {status ? <Alert severity={status === "Settings saved." ? "success" : "error"}>{status}</Alert> : null}
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}><Stack spacing={1.5}><Typography variant="h6" sx={{ fontWeight: 700 }}>SMTP</Typography>{field("emailFrom", "Sender address")}{field("smtpService", "Service (optional)")}{field("smtpHost", "Host (optional)")}<Stack direction={{ xs: "column", sm: "row" }} spacing={1}>{field("smtpPort", "Port", "number")}{field("smtpUser", "Username")}</Stack><TextField size="small" label={values.hasSmtpPassword ? "Password (leave blank to keep current)" : "Password"} type="password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} autoComplete="new-password" /><FormControlLabel control={<Checkbox checked={values.smtpSecure} onChange={(_, checked) => set("smtpSecure", checked)} />} label="Use implicit TLS" /><FormControlLabel control={<Checkbox checked={values.smtpAllowUnauthenticated} onChange={(_, checked) => set("smtpAllowUnauthenticated", checked)} />} label="Private unauthenticated relay" /></Stack></Paper>
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}><Stack spacing={1.5}><Typography variant="h6" sx={{ fontWeight: 700 }}>Google SSO</Typography>{field("googleClientId", "OAuth client ID")}<TextField size="small" label={values.hasGoogleClientSecret ? "OAuth client secret (leave blank to keep current)" : "OAuth client secret"} type="password" value={googleClientSecret} onChange={(event) => setGoogleClientSecret(event.target.value)} autoComplete="new-password" /><Typography variant="caption" color="text.secondary">Register the callback URL shown in the deployment documentation with Google.</Typography></Stack></Paper>
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}><Stack spacing={1.5}><Typography variant="h6" sx={{ fontWeight: 700 }}>Backup configuration</Typography>{field("backupProvider", "Provider")}{field("backupLastSuccessAt", "Last successful backup", "datetime-local")}{field("backupRetentionDays", "Retention days", "number")}<Typography variant="caption" color="text.secondary">This records backup posture only; backup creation and restore access remain with the database provider.</Typography></Stack></Paper>
    <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: "flex-start" }}>Save instance settings</Button>
  </Stack>;
}
