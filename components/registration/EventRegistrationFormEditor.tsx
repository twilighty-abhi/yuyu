"use client";

import { useMemo, useState, useTransition } from "react";
import type { RegistrationFieldType } from "@prisma/client";
import { RegistrationFieldType as RegistrationFieldTypeEnum } from "@prisma/client";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableBody from "@mui/material/TableBody";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ArrowUpwardOutlinedIcon from "@mui/icons-material/ArrowUpwardOutlined";
import ArrowDownwardOutlinedIcon from "@mui/icons-material/ArrowDownwardOutlined";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/feedback/ToastProvider";
import {
  deleteEventRegistrationField,
  reorderEventRegistrationFields,
  upsertEventRegistrationField,
} from "@/app/actions/registration-form";

export type RegistrationFieldRow = {
  id: string;
  key: string;
  label: string;
  type: RegistrationFieldType;
  required: boolean;
  sortOrder: number;
  options: string[];
};

function makeKeyFromLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function uniqueKey(base: string, existing: Set<string>, current?: string) {
  const normalized = base || "field";
  if ((current && normalized === current) || !existing.has(normalized)) return normalized;
  for (let i = 1; i < 1000; i++) {
    const suffix = `_${i}`;
    const next = (normalized + suffix).slice(0, 64);
    if (next === current) return next;
    if (!existing.has(next)) return next;
  }
  // Fallback (extremely unlikely)
  return `${normalized}_${Date.now()}`.slice(0, 64);
}

function needsOptions(t: RegistrationFieldType) {
  return (
    t === RegistrationFieldTypeEnum.SELECT ||
    t === RegistrationFieldTypeEnum.MULTI_SELECT ||
    t === RegistrationFieldTypeEnum.RADIO
  );
}

export function EventRegistrationFormEditor(props: {
  organisationSlug: string;
  eventId: string;
  fields: RegistrationFieldRow[];
}) {
  const { organisationSlug, eventId } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const fields = useMemo(() => {
    return [...props.fields].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [props.fields]);

  const existingKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RegistrationFieldRow | null>(null);

  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [type, setType] = useState<RegistrationFieldType>("TEXT");
  const [required, setRequired] = useState(false);
  const [optionsCsv, setOptionsCsv] = useState("");

  function openCreate() {
    setEditing(null);
    setLabel("");
    setKey(uniqueKey("field", existingKeys));
    setType("TEXT");
    setRequired(false);
    setOptionsCsv("");
    setOpen(true);
  }

  function openEdit(f: RegistrationFieldRow) {
    setEditing(f);
    setLabel(f.label);
    setKey(f.key);
    setType(f.type);
    setRequired(f.required);
    setOptionsCsv(f.options.join(", "));
    setOpen(true);
  }

  function move(id: string, dir: -1 | 1) {
    const idx = fields.findIndex((f) => f.id === id);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= fields.length) return;
    const next = [...fields];
    const tmp = next[idx]!;
    next[idx] = next[nextIdx]!;
    next[nextIdx] = tmp;
    startTransition(async () => {
      const res = await reorderEventRegistrationFields({
        organisationSlug,
        eventId,
        fieldIds: next.map((f) => f.id),
      });
      if (!res.ok) showToast(res.error, "error");
      else router.refresh();
    });
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between" }}
      >
        <BoxHeader />
        <Button variant="contained" onClick={openCreate} disabled={pending}>
          Add field
        </Button>
      </Stack>

      <Paper variant="outlined">
        <Stack spacing={1} sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" color="text.secondary">
            Always collected
          </Typography>
          <Stack spacing={1.25}>
            <FieldPreviewRow label="Name" helper="Collected from the attendee" />
            <FieldPreviewRow
              label="Email"
              helper="Used for confirmations, ticket, and check-in"
            />
          </Stack>
        </Stack>
        <Box sx={{ borderTop: 1, borderColor: "divider" }} />
        {fields.length === 0 ? (
          <Stack spacing={1} sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              No custom fields yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add fields below to collect additional information (like phone number).
            </Typography>
          </Stack>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Label</TableCell>
                <TableCell>Key</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Required</TableCell>
                <TableCell>Options</TableCell>
                <TableCell align="right">Order</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fields.map((f, idx) => (
                <TableRow key={f.id}>
                  <TableCell>{f.label}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>{f.key}</TableCell>
                  <TableCell>{f.type}</TableCell>
                  <TableCell>{f.required ? "Yes" : "No"}</TableCell>
                  <TableCell>
                    {needsOptions(f.type) ? (f.options.join(", ") || "—") : "—"}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label="Move up"
                      disabled={pending || idx === 0}
                      onClick={() => move(f.id, -1)}
                      size="small"
                    >
                      <ArrowUpwardOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      aria-label="Move down"
                      disabled={pending || idx === fields.length - 1}
                      onClick={() => move(f.id, 1)}
                      size="small"
                    >
                      <ArrowDownwardOutlinedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label="Edit"
                      disabled={pending}
                      onClick={() => openEdit(f)}
                      size="small"
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      aria-label="Delete"
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const res = await deleteEventRegistrationField({
                            organisationSlug,
                            eventId,
                            fieldId: f.id,
                          });
                          if (!res.ok) showToast(res.error, "error");
                          else {
                            showToast("Field deleted", "success");
                            router.refresh();
                          }
                        });
                      }}
                      size="small"
                    >
                      <DeleteOutlineOutlinedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? "Edit field" : "Add field"}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Label"
              value={label}
              onChange={(e) => {
                const next = e.target.value;
                setLabel(next);
                if (!editing) {
                  setKey(uniqueKey(makeKeyFromLabel(next), existingKeys));
                }
              }}
              fullWidth
            />
            <TextField
              label="Key"
              helperText={
                editing
                  ? "System-generated identifier (locked)."
                  : "Auto-generated from the label. If it already exists, we’ll add _1, _2, etc."
              }
              value={key}
              disabled
              fullWidth
            />
            <TextField
              label="Type"
              select
              value={type}
              onChange={(e) => setType(e.target.value as RegistrationFieldType)}
              fullWidth
            >
              {Object.values(RegistrationFieldTypeEnum).map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={required}
                  onChange={(_, checked) => setRequired(checked)}
                />
              }
              label="Required"
            />
            {needsOptions(type) ? (
              <TextField
                label="Options"
                helperText="Comma-separated (e.g. A, B, C)"
                value={optionsCsv}
                onChange={(e) => setOptionsCsv(e.target.value)}
                fullWidth
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const options = optionsCsv
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                const res = await upsertEventRegistrationField({
                  organisationSlug,
                  eventId,
                  fieldId: editing?.id,
                  key,
                  label,
                  type,
                  required,
                  options,
                });
                if (!res.ok) {
                  showToast(res.error, "error");
                  return;
                }
                showToast("Saved", "success");
                setOpen(false);
                router.refresh();
              });
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function BoxHeader() {
  return (
    <Stack spacing={0.25}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        Registration form
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Add custom fields shown on the RSVP form. Name + email are always collected.
      </Typography>
    </Stack>
  );
}

function FieldPreviewRow(props: { label: string; helper: string }) {
  const { label, helper } = props;
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1}
      sx={{
        alignItems: { sm: "center" },
        justifyContent: "space-between",
        p: 1.25,
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        opacity: 0.75,
      }}
    >
      <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: { sm: "right" } }}>
        {helper}
      </Typography>
    </Stack>
  );
}

