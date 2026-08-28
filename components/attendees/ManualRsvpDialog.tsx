"use client";

import { useState, useTransition } from "react";
import type { RegistrationFieldType } from "@prisma/client";
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
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import { addManualRsvp } from "@/app/actions/rsvp-admin";
import { useToast } from "@/components/feedback/ToastProvider";

export type ManualRsvpField = {
  id: string;
  key: string;
  label: string;
  type: RegistrationFieldType;
  required: boolean;
  options: string[];
};

function requiredLabel(field: ManualRsvpField) {
  return field.required ? `${field.label} *` : field.label;
}

export function ManualRsvpDialog(props: {
  organisationSlug: string;
  eventId: string;
  fields: ManualRsvpField[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { organisationSlug, eventId, fields, onClose, onAdded } = props;
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  const setAnswer = (key: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [key]: value }));
  };

  const renderField = (field: ManualRsvpField) => {
    const value = answers[field.key];
    if (field.type === "CHECKBOX") {
      return (
        <FormControlLabel
          key={field.key}
          control={<Checkbox checked={value === true} onChange={(_, checked) => setAnswer(field.key, checked)} />}
          label={requiredLabel(field)}
        />
      );
    }
    if (field.type === "MULTI_SELECT") {
      const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      return (
        <FormControl key={field.key} required={field.required} component="fieldset">
          <FormLabel component="legend">{requiredLabel(field)}</FormLabel>
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", columnGap: 0.5, rowGap: 0 }}>
            {field.options.map((option) => (
              <FormControlLabel
                key={option}
                control={<Checkbox checked={selected.includes(option)} onChange={(_, checked) => setAnswer(field.key, checked ? [...selected, option] : selected.filter((item) => item !== option))} />}
                label={option}
              />
            ))}
          </Stack>
        </FormControl>
      );
    }
    if (field.type === "RADIO") {
      return (
        <FormControl key={field.key} required={field.required} component="fieldset">
          <FormLabel component="legend">{requiredLabel(field)}</FormLabel>
          <RadioGroup value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)}>
            {field.options.map((option) => <FormControlLabel key={option} value={option} control={<Radio />} label={option} />)}
          </RadioGroup>
        </FormControl>
      );
    }
    if (field.type === "SELECT") {
      return (
        <TextField key={field.key} label={requiredLabel(field)} select required={field.required} value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, event.target.value)} fullWidth>
          <MenuItem value=""><em>Choose one</em></MenuItem>
          {field.options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
        </TextField>
      );
    }
    return (
      <TextField
        key={field.key}
        label={requiredLabel(field)}
        type={field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"}
        multiline={field.type === "TEXTAREA"}
        minRows={field.type === "TEXTAREA" ? 3 : undefined}
        required={field.required}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(event) => setAnswer(field.key, event.target.value)}
        slotProps={field.type === "DATE" ? { inputLabel: { shrink: true } } : undefined}
        fullWidth
      />
    );
  };

  return (
    <Dialog open onClose={() => !pending && onClose()} fullWidth maxWidth="sm">
      <form onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await addManualRsvp({
            organisationSlug,
            eventId,
            name,
            guestEmail: email,
            answers,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          const status = result.data!.status === "CONFIRMED" ? "confirmed" : result.data!.status.toLowerCase().replace(/_/g, " ");
          showToast(`Attendee added — ${status}. A ticket email has been queued.`, "success");
          onAdded();
          onClose();
        });
      }}>
        <DialogTitle>Add attendee</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Typography variant="body2" color="text.secondary">
              Add a guest RSVP and send their ticket confirmation. Capacity and event registration rules still apply.
            </Typography>
            <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} autoFocus required fullWidth />
            <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required fullWidth />
            {fields.map(renderField)}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={pending}>Cancel</Button>
          <Button type="submit" variant="contained" startIcon={<PersonAddOutlinedIcon />} disabled={pending}>
            Add attendee
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
