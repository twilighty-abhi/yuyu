"use client";

import { useState, useTransition } from "react";
import type { RegistrationFieldType } from "@prisma/client";
import { RegistrationFieldType as FieldType } from "@prisma/client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { deleteFeedbackField, saveFeedbackField, saveFeedbackSettings } from "@/app/actions/feedback-form";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useUnsavedChangesGuard } from "@/components/forms/useUnsavedChangesGuard";

type Field = { id: string; key: string; label: string; type: RegistrationFieldType; required: boolean; options: string[] };

export function FeedbackFormEditor(props: {
  organisationSlug: string;
  eventId: string;
  feedbackUrl: string;
  form: { isOpen: boolean; title: string; thankYouMessage: string; certificateEnabled: boolean } | null;
  fields: Field[];
}) {
  const [isOpen, setIsOpen] = useState(props.form?.isOpen ?? false);
  const [title, setTitle] = useState(props.form?.title ?? "Event feedback");
  const [thankYouMessage, setThankYouMessage] = useState(props.form?.thankYouMessage ?? "Thanks for sharing your feedback.");
  const [certificateEnabled, setCertificateEnabled] = useState(props.form?.certificateEnabled ?? false);
  const [fields, setFields] = useState(props.fields);
  const [dialog, setDialog] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<RegistrationFieldType>("TEXTAREA");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleteField, setDeleteField] = useState<Field | null>(null);
  const [pending, startTransition] = useTransition();
  useUnsavedChangesGuard(dirty && !pending);

  const saveSettings = () => startTransition(async () => {
    const result = await saveFeedbackSettings({
      organisationSlug: props.organisationSlug,
      eventId: props.eventId,
      isOpen,
      title,
      thankYouMessage,
      certificateEnabled,
    });
    setMessageIsError(!result.ok);
    setMessage(result.ok ? "Feedback settings saved." : result.error);
    if (result.ok) setDirty(false);
  });

  const addField = () => {
    const values = options.split(",").map((value) => value.trim()).filter(Boolean);
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "feedback";
    startTransition(async () => {
      const result = await saveFeedbackField({ organisationSlug: props.organisationSlug, eventId: props.eventId, key, label, type, required, options: values });
      if (!result.ok) {
        setMessageIsError(true);
        setMessage(result.error);
        return;
      }
      setFields((current) => [...current, { id: result.data!.fieldId, key, label, type, required, options: values }]);
      setDialog(false);
      setLabel("");
      setOptions("");
      setMessageIsError(false);
      setMessage("Feedback question added.");
    });
  };

  const confirmDelete = () => {
    if (!deleteField) return;
    const target = deleteField;
    setDeleteField(null);
    startTransition(async () => {
      const result = await deleteFeedbackField({ organisationSlug: props.organisationSlug, eventId: props.eventId, fieldId: target.id });
      if (result.ok) {
        setFields((current) => current.filter((item) => item.id !== target.id));
        setMessageIsError(false);
        setMessage("Feedback question removed.");
      } else {
        setMessageIsError(true);
        setMessage(result.error);
      }
    });
  };

  const markDirty = () => setDirty(true);
  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
        <Box>
          <Typography variant="h5">Feedback form</Typography>
          <Typography color="text.secondary" variant="body2">Share this link manually. It never sends system email.</Typography>
        </Box>
        <Button startIcon={<ContentCopyIcon />} variant="outlined" onClick={() => void navigator.clipboard.writeText(props.feedbackUrl).then(() => { setMessageIsError(false); setMessage("Feedback link copied."); }, () => { setMessageIsError(true); setMessage("Could not copy the feedback link."); })}>Copy feedback link</Button>
      </Stack>
      {message ? <Alert severity={messageIsError ? "error" : "info"} onClose={() => setMessage(null)}>{message}</Alert> : null}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <TextField label="Form title" value={title} onChange={(event) => { setTitle(event.target.value); markDirty(); }} fullWidth />
          <TextField label="Thank-you message" value={thankYouMessage} onChange={(event) => { setThankYouMessage(event.target.value); markDirty(); }} fullWidth />
          <FormControlLabel control={<Checkbox checked={isOpen} onChange={(_, checked) => { setIsOpen(checked); markDirty(); }} />} label="Open this feedback link" />
          <FormControlLabel control={<Checkbox checked={certificateEnabled} onChange={(_, checked) => { setCertificateEnabled(checked); markDirty(); }} />} label="Offer a JPEG certificate after submission" />
          <Button variant="contained" onClick={saveSettings} disabled={pending || !dirty}>{pending ? "Saving…" : "Save settings"}</Button>
        </Stack>
      </Paper>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h6">Questions</Typography>
        <Button variant="contained" onClick={() => setDialog(true)}>Add question</Button>
      </Stack>
      {fields.length === 0 ? <Typography color="text.secondary">Add at least one question before opening the form.</Typography> : fields.map((field) => (
        <Paper key={field.id} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography>{field.label}{field.required ? " *" : ""}</Typography>
              <Typography variant="caption" color="text.secondary">{field.type}{field.options.length ? ` · ${field.options.join(", ")}` : ""}</Typography>
            </Box>
            <IconButton aria-label={`Delete ${field.label}`} disabled={pending} onClick={() => setDeleteField(field)}><DeleteOutlineIcon /></IconButton>
          </Stack>
        </Paper>
      ))}
      <Dialog open={dialog} onClose={() => setDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add feedback question</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Question" value={label} onChange={(event) => setLabel(event.target.value)} autoFocus fullWidth />
            <TextField select label="Answer type" value={type} onChange={(event) => setType(event.target.value as RegistrationFieldType)} fullWidth>
              {Object.values(FieldType).filter((item) => item !== "EMAIL" && item !== "PHONE" && item !== "DATE").map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
            </TextField>
            {["SELECT", "MULTI_SELECT", "RADIO"].includes(type) ? <TextField label="Options (comma separated)" value={options} onChange={(event) => setOptions(event.target.value)} fullWidth /> : null}
            <FormControlLabel control={<Checkbox checked={required} onChange={(_, checked) => setRequired(checked)} />} label="Required" />
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setDialog(false)}>Cancel</Button><Button onClick={addField} disabled={pending || !label.trim()} variant="contained">Add question</Button></DialogActions>
      </Dialog>
      <ConfirmationDialog
        open={Boolean(deleteField)}
        title="Delete feedback question?"
        message={`Delete “${deleteField?.label ?? "this question"}”? Existing answers may prevent removal.`}
        confirmLabel="Delete question"
        loading={pending}
        onCancel={() => setDeleteField(null)}
        onConfirm={confirmDelete}
      />
    </Stack>
  );
}
