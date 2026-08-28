"use client";

import { useState, useTransition } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { updateRsvpRegistration } from "@/app/actions/rsvp-admin";
import type { AttendeeRow } from "@/components/attendees/AttendeeTable";
import type { ManualRsvpField } from "@/components/attendees/ManualRsvpDialog";
import { useToast } from "@/components/feedback/ToastProvider";

function initialAnswers(attendee: AttendeeRow, fields: ManualRsvpField[]) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const values = (attendee.rawAnswers ?? []).filter((answer) => answer.fieldId === field.id);
    const answer = values[0];
    if (field.type === "MULTI_SELECT") result[field.key] = values.map((value) => value.valueText).filter((value): value is string => Boolean(value));
    else if (field.type === "CHECKBOX") result[field.key] = answer?.valueBool ?? false;
    else if (field.type === "NUMBER") result[field.key] = answer?.valueNumber ?? "";
    else if (field.type === "DATE") result[field.key] = answer?.valueDate ? answer.valueDate.slice(0, 10) : "";
    else result[field.key] = answer?.valueText ?? "";
  }
  return result;
}

export function EditRsvpDialog(props: {
  organisationSlug: string;
  eventId?: string;
  eventInstanceId?: string;
  attendee: AttendeeRow;
  fields: ManualRsvpField[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { attendee, fields, organisationSlug, eventId, eventInstanceId, onClose, onUpdated } = props;
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(attendee.guestName ?? "");
  const [email, setEmail] = useState(attendee.guestEmail ?? "");
  const [answers, setAnswers] = useState(() => initialAnswers(attendee, fields));
  const setAnswer = (key: string, value: unknown) => setAnswers((current) => ({ ...current, [key]: value }));
  const valueFor = (key: string) => answers[key];

  function renderField(field: ManualRsvpField) {
    const value = valueFor(field.key);
    const label = field.required ? `${field.label} *` : field.label;
    if (field.type === "CHECKBOX") return <FormControlLabel key={field.key} control={<Checkbox checked={value === true} onChange={(_, checked) => setAnswer(field.key, checked)} />} label={label} />;
    if (field.type === "MULTI_SELECT") {
      const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      return <FormControl key={field.key} required={field.required} component="fieldset"><FormLabel component="legend">{label}</FormLabel><Stack direction="row" useFlexGap sx={{ flexWrap: "wrap" }}>{field.options.map((option) => <FormControlLabel key={option} control={<Checkbox checked={selected.includes(option)} onChange={(_, checked) => setAnswer(field.key, checked ? [...selected, option] : selected.filter((item) => item !== option))} />} label={option} />)}</Stack></FormControl>;
    }
    if (field.type === "RADIO") return <FormControl key={field.key} required={field.required} component="fieldset"><FormLabel component="legend">{label}</FormLabel><RadioGroup value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)}>{field.options.map((option) => <FormControlLabel key={option} value={option} control={<Radio />} label={option} />)}</RadioGroup></FormControl>;
    if (field.type === "SELECT") return <TextField key={field.key} label={label} select required={field.required} value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)} fullWidth><MenuItem value=""><em>Choose one</em></MenuItem>{field.options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}</TextField>;
    return <TextField key={field.key} label={label} type={field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"} multiline={field.type === "TEXTAREA"} minRows={field.type === "TEXTAREA" ? 3 : undefined} required={field.required} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)} slotProps={field.type === "DATE" ? { inputLabel: { shrink: true } } : undefined} fullWidth />;
  }

  return <Dialog open onClose={() => !pending && onClose()} fullWidth maxWidth="sm"><form onSubmit={(event) => { event.preventDefault(); setError(null); startTransition(async () => { const result = await updateRsvpRegistration({ organisationSlug, eventId, eventInstanceId, rsvpId: attendee.id, ...(attendee.user ? {} : { name, guestEmail: email }), answers }); if (!result.ok) { setError(result.error); return; } showToast("Registration updated", "success"); onUpdated(); onClose(); }); }}><DialogTitle>Edit registration</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 0.5 }}>{error ? <Alert severity="error">{error}</Alert> : null}<Typography variant="body2" color="text.secondary">Update this attendee&apos;s registration details. Their ticket and check-in status will remain unchanged.</Typography>{attendee.user ? <Typography variant="body2"><strong>{attendee.user.name ?? "Signed-in attendee"}</strong><br />{attendee.user.email ?? "No email"}</Typography> : <><TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} required fullWidth autoFocus /><TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required fullWidth /></>}{fields.map(renderField)}</Stack></DialogContent><DialogActions><Button onClick={onClose} color="inherit" disabled={pending}>Cancel</Button><Button type="submit" variant="contained" startIcon={<EditOutlinedIcon />} disabled={pending}>Save changes</Button></DialogActions></form></Dialog>;
}
