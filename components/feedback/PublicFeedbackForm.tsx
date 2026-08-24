"use client";

import { useState, useTransition } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { RegistrationFieldDefinition } from "@/components/rsvp/registrationTypes";

export function PublicFeedbackForm(props: { orgSlug: string; eventSlug: string; fields: RegistrationFieldDefinition[]; thankYouMessage: string; certificateEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [certificateToken, setCertificateToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const setAnswer = (key: string, value: unknown) => setAnswers((current) => ({ ...current, [key]: value }));

  if (done) return <Alert severity="success"><Stack spacing={1} sx={{ alignItems: "flex-start" }}><Typography>{props.thankYouMessage}</Typography>{certificateToken ? <Button component="a" href={`/api/feedback/certificate/${certificateToken}`} variant="contained">Download certificate (JPG)</Button> : null}</Stack></Alert>;

  return <Box component="form" onSubmit={(event) => { event.preventDefault(); setError(null); startTransition(async () => {
    const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgSlug: props.orgSlug, eventSlug: props.eventSlug, email, answers }) });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; data?: { certificateToken?: string | null } };
    if (!response.ok || !result.ok) { setError(result.error ?? "Could not submit feedback."); return; }
    setCertificateToken(result.data?.certificateToken ?? null); setDone(true);
  }); }}>
    <Stack spacing={2.25}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Typography variant="body2" color="text.secondary">Use the same email address you used to register. Feedback can be submitted once.</Typography>
      <TextField label="Registered email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required fullWidth />
      {props.fields.map((field) => {
        const value = answers[field.key];
        if (field.type === "TEXTAREA") return <TextField key={field.key} label={field.label} multiline minRows={4} required={field.required} fullWidth value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)} />;
        if (field.type === "NUMBER" || field.type === "DATE" || field.type === "EMAIL" || field.type === "PHONE" || field.type === "TEXT") return <TextField key={field.key} label={field.label} type={field.type === "TEXT" ? "text" : field.type.toLowerCase()} required={field.required} fullWidth slotProps={field.type === "DATE" ? { inputLabel: { shrink: true } } : undefined} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)} />;
        if (field.type === "CHECKBOX") return <FormControlLabel key={field.key} control={<Checkbox checked={Boolean(value)} onChange={(_, checked) => setAnswer(field.key, checked)} />} label={field.required ? `${field.label} *` : field.label} />;
        if (field.type === "MULTI_SELECT") { const selected = Array.isArray(value) ? value as string[] : []; return <TextField key={field.key} select label={field.label} required={field.required} fullWidth slotProps={{ select: { multiple: true } }} value={selected} onChange={(event) => setAnswer(field.key, typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value)}>{field.options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}</TextField>; }
        if (field.type === "RADIO") return <FormControl key={field.key} required={field.required}><FormLabel>{field.label}</FormLabel><RadioGroup value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)}>{field.options.map((option) => <FormControlLabel key={option} value={option} control={<Radio />} label={option} />)}</RadioGroup></FormControl>;
        return <TextField key={field.key} select label={field.label} required={field.required} fullWidth value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)}><MenuItem value="">—</MenuItem>{field.options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}</TextField>;
      })}
      <Button type="submit" variant="contained" size="large" disabled={pending}>{pending ? "Submitting…" : props.certificateEnabled ? "Submit feedback & get certificate" : "Submit feedback"}</Button>
    </Stack>
  </Box>;
}
