"use client";

import { useMemo, useState, useTransition } from "react";
import type { RegistrationFieldType } from "@prisma/client";
import { RegistrationFieldType as RegistrationFieldTypeEnum } from "@prisma/client";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormLabel from "@mui/material/FormLabel";
import FormControl from "@mui/material/FormControl";

import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ArrowUpwardOutlinedIcon from "@mui/icons-material/ArrowUpwardOutlined";
import ArrowDownwardOutlinedIcon from "@mui/icons-material/ArrowDownwardOutlined";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import PreviewIcon from "@mui/icons-material/Preview";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
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
  return `${normalized}_${Date.now()}`.slice(0, 64);
}

function needsOptions(t: RegistrationFieldType) {
  return (
    t === RegistrationFieldTypeEnum.SELECT ||
    t === RegistrationFieldTypeEnum.MULTI_SELECT ||
    t === RegistrationFieldTypeEnum.RADIO
  );
}

const FIELD_PRESETS = [
  {
    label: "Phone Number",
    type: "TEXT" as RegistrationFieldType,
    required: false,
    optionsCsv: "",
  },
  {
    label: "Company / Organisation",
    type: "TEXT" as RegistrationFieldType,
    required: false,
    optionsCsv: "",
  },
  {
    label: "Job Title",
    type: "TEXT" as RegistrationFieldType,
    required: false,
    optionsCsv: "",
  },
  {
    label: "Dietary Restrictions",
    type: "MULTI_SELECT" as RegistrationFieldType,
    required: false,
    optionsCsv: "None, Vegetarian, Vegan, Gluten Free, Dairy Free, Halal, Kosher",
  },
  {
    label: "T-Shirt Size",
    type: "SELECT" as RegistrationFieldType,
    required: false,
    optionsCsv: "XS, S, M, L, XL, XXL, 3XL",
  },
  {
    label: "LinkedIn Profile",
    type: "TEXT" as RegistrationFieldType,
    required: false,
    optionsCsv: "",
  },
  {
    label: "How did you hear about us?",
    type: "SELECT" as RegistrationFieldType,
    required: false,
    optionsCsv: "Social Media, Friend / Word of Mouth, Search Engine, Newsletter, Community Slack, Other",
  },
];

export function EventRegistrationFormEditor(props: {
  organisationSlug: string;
  eventId: string;
  fields: RegistrationFieldRow[];
}) {
  const { organisationSlug, eventId } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [localFields, setLocalFields] = useState<RegistrationFieldRow[]>(props.fields);

  const fields = useMemo(() => {
    return [...localFields].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [localFields]);

  const existingKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RegistrationFieldRow | null>(null);
  const [deleteConfirmField, setDeleteConfirmField] = useState<RegistrationFieldRow | null>(null);

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
    const reordered = next.map((field, order) => ({ ...field, sortOrder: order + 1 }));
    const previousFields = localFields;
    setLocalFields(reordered);
    startTransition(async () => {
      const res = await reorderEventRegistrationFields({
        organisationSlug,
        eventId,
        fieldIds: reordered.map((f) => f.id),
      });
      if (!res.ok) {
        setLocalFields(previousFields);
        showToast(res.error, "error");
      } else router.refresh();
    });
  }

  return (
    <Stack spacing={4}>
      {/* ── HEADER ── */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "stretch", sm: "flex-end" },
          justifyContent: "space-between",
          pb: 1.5,
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 750, letterSpacing: "-0.5px" }}>
            Registration Form Editor
          </Typography>
          <Typography variant="body2" sx={{ color: "#8E8E93" }}>
            Add custom input fields to collect guest information. Name and Email are always collected.
          </Typography>
        </Stack>
        <Button
          variant="contained"
          onClick={openCreate}
          disabled={pending}
          sx={{
            alignSelf: { xs: "flex-start", sm: "center" },
            backgroundColor: "#0A84FF",
            color: "#FFFFFF",
            fontWeight: 600,
            textTransform: "none",
            borderRadius: "8px",
            px: 3,
          }}
        >
          Add Custom Field
        </Button>
      </Stack>

      {/* ── TWO COLUMN BUILDER / PREVIEW LAYOUT ── */}
      <Grid container spacing={4}>
        {/* Left Column: Visual Builder Cards */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2.5}>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: "1.1rem", letterSpacing: "-0.2px" }}>
              Form Structure
            </Typography>

            <Stack spacing={2}>
              {/* Default Fields Panel */}
              <Paper variant="outlined" sx={{ p: 2.5, backgroundColor: "rgba(255,255,255,0.01)", borderColor: "rgba(255,255,255,0.06)" }}>
                <Stack spacing={1.5}>
                  <Typography variant="caption" sx={{ color: "#8E8E93", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Standard Fields (Always Collected)
                  </Typography>
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                    <DragIndicatorIcon sx={{ color: "rgba(255,255,255,0.15)" }} />
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>Name</Typography>
                      <Typography variant="caption" color="text.secondary">Collected from all registered attendees.</Typography>
                    </Box>
                    <Chip label="Required" size="small" variant="outlined" sx={{ color: "#0A84FF", borderColor: "rgba(10, 132, 255, 0.2)", bgcolor: "rgba(10, 132, 255, 0.04)" }} />
                  </Stack>
                  <Divider sx={{ borderColor: "rgba(255,255,255,0.04)" }} />
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                    <DragIndicatorIcon sx={{ color: "rgba(255,255,255,0.15)" }} />
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>Email</Typography>
                      <Typography variant="caption" color="text.secondary">Used for sending ticket confirmation and QR codes.</Typography>
                    </Box>
                    <Chip label="Required" size="small" variant="outlined" sx={{ color: "#0A84FF", borderColor: "rgba(10, 132, 255, 0.2)", bgcolor: "rgba(10, 132, 255, 0.04)" }} />
                  </Stack>
                </Stack>
              </Paper>

              {/* Custom Fields List */}
              {fields.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 4, textAlign: "center", backgroundColor: "rgba(255,255,255,0.01)", borderColor: "rgba(255,255,255,0.06)" }}>
                  <Typography variant="body2" color="text.secondary">
                    No custom fields configured. Click &quot;Add Custom Field&quot; to capture dietary needs, phone numbers, or sizes.
                  </Typography>
                </Paper>
              ) : (
                <Stack spacing={1.5}>
                  {fields.map((f, idx) => (
                    <Paper
                      key={f.id}
                      variant="outlined"
                      sx={{
                        p: 2.5,
                        backgroundColor: "#1C1C1E",
                        borderColor: "rgba(255,255,255,0.08)",
                        transition: "border-color 0.15s ease",
                        "&:hover": {
                          borderColor: "rgba(10, 132, 255, 0.3)",
                        },
                      }}
                    >
                      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                        <DragIndicatorIcon sx={{ color: "rgba(255,255,255,0.3)" }} />
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                              {f.label}
                            </Typography>
                            {f.required && (
                              <Chip label="Required" size="small" variant="outlined" sx={{ height: 20, fontSize: "0.65rem", color: "#FF9F0A", borderColor: "rgba(255, 159, 10, 0.2)" }} />
                            )}
                          </Stack>
                          <Typography variant="caption" sx={{ color: "#8E8E93", fontFamily: "monospace", display: "block", mt: 0.25 }}>
                            key: {f.key} · type: {f.type.toLowerCase()}
                          </Typography>
                          {needsOptions(f.type) && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} noWrap>
                              Options: {f.options.join(", ")}
                            </Typography>
                          )}
                        </Box>

                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
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
                            onClick={() => setDeleteConfirmField(f)}
                            size="small"
                          >
                            <DeleteOutlineOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              )}
            </Stack>
          </Stack>
        </Grid>

        {/* Right Column: Live Interactive Preview */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2.5} sx={{ position: "sticky", top: 24 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <PreviewIcon sx={{ color: "#0A84FF" }} />
              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: "1.1rem", letterSpacing: "-0.2px" }}>
                Live Form Preview
              </Typography>
            </Stack>

            <Paper
              variant="outlined"
              sx={{
                p: 3.5,
                borderRadius: "20px",
                backgroundColor: "#1C1C1E",
                borderColor: "rgba(255,255,255,0.08)",
                boxShadow: "0 10px 40px rgba(0, 0, 0, 0.4)",
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                Register for Event
              </Typography>
              <Typography variant="caption" sx={{ color: "#8E8E93", display: "block", mb: 3 }}>
                Fill out the form below to secure your spot.
              </Typography>

              <Stack spacing={3}>
                {/* Standard Name / Email fields */}
                <TextField label="Full Name" size="small" fullWidth required placeholder="Enter full name" />
                <TextField label="Email Address" size="small" type="email" fullWidth required placeholder="you@domain.com" />

                {/* Render Custom Configured Fields */}
                {fields.map((f) => {
                  const requiredLabel = f.required ? " *" : "";
                  const fullLabel = `${f.label}${requiredLabel}`;

                  if (f.type === "TEXT") {
                    return <TextField key={f.id} label={fullLabel} size="small" fullWidth placeholder="Enter answer..." />;
                  }
                  if (f.type === "TEXTAREA") {
                    return <TextField key={f.id} label={fullLabel} size="small" multiline rows={3} fullWidth placeholder="Enter answer..." />;
                  }
                  if (f.type === "NUMBER") {
                    return <TextField key={f.id} label={fullLabel} size="small" type="number" fullWidth placeholder="0" />;
                  }
                  if (f.type === "DATE") {
                    return <TextField key={f.id} label={fullLabel} size="small" type="date" slotProps={{ inputLabel: { shrink: true } }} fullWidth />;
                  }
                  if (f.type === "CHECKBOX") {
                    return <FormControlLabel key={f.id} control={<Checkbox />} label={fullLabel} />;
                  }
                  if (f.type === "SELECT") {
                    return (
                      <TextField key={f.id} select label={fullLabel} size="small" fullWidth value="">
                        {f.options.map((opt) => (
                          <MenuItem key={opt} value={opt}>
                            {opt}
                          </MenuItem>
                        ))}
                      </TextField>
                    );
                  }
                  if (f.type === "RADIO") {
                    return (
                      <FormControl key={f.id} component="fieldset">
                        <FormLabel component="legend" sx={{ fontSize: "0.85rem", fontWeight: 600, color: "#8E8E93" }}>
                          {fullLabel}
                        </FormLabel>
                        <RadioGroup row sx={{ mt: 0.5 }}>
                          {f.options.map((opt) => (
                            <FormControlLabel key={opt} value={opt} control={<Radio size="small" />} label={opt} />
                          ))}
                        </RadioGroup>
                      </FormControl>
                    );
                  }
                  if (f.type === "MULTI_SELECT") {
                    return (
                      <FormControl key={f.id} component="fieldset">
                        <FormLabel component="legend" sx={{ fontSize: "0.85rem", fontWeight: 600, color: "#8E8E93" }}>
                          {fullLabel}
                        </FormLabel>
                        <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                          {f.options.map((opt) => (
                            <FormControlLabel key={opt} control={<Checkbox size="small" />} label={opt} />
                          ))}
                        </Stack>
                      </FormControl>
                    );
                  }
                  return null;
                })}

                <Button
                  variant="contained"
                  fullWidth
                  sx={{
                    mt: 1,
                    backgroundColor: "#0A84FF",
                    color: "#FFFFFF",
                    fontWeight: 700,
                    textTransform: "none",
                    borderRadius: "8px",
                    py: 1,
                  }}
                >
                  Submit RSVP
                </Button>
              </Stack>
            </Paper>
          </Stack>
        </Grid>
      </Grid>

      {/* ── CREATE / EDIT DIALOG (presets at top) ── */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>{editing ? "Edit custom field" : "Add custom field"}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {!editing && (
              <Box sx={{ mb: 1 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, display: "block", mb: 1.5, textTransform: "uppercase", letterSpacing: "0.5px" }}
                >
                  Quick preset templates
                </Typography>
                <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>
                  {FIELD_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        setLabel(preset.label);
                        setKey(uniqueKey(makeKeyFromLabel(preset.label), existingKeys));
                        setType(preset.type);
                        setRequired(preset.required);
                        setOptionsCsv(preset.optionsCsv);
                      }}
                      sx={{
                        textTransform: "none",
                        fontSize: "0.75rem",
                        borderRadius: "6px",
                        py: 0.5,
                        px: 1.25,
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </Stack>
                <Divider sx={{ mt: 2.5, mb: 1.5 }} />
              </Box>
            )}

            <TextField
              label="Field Label"
              value={label}
              onChange={(e) => {
                const next = e.target.value;
                setLabel(next);
                if (!editing) {
                  setKey(uniqueKey(makeKeyFromLabel(next), existingKeys));
                }
              }}
              fullWidth
              placeholder="e.g. Phone Number, Dietary Restrictions"
            />
            <TextField
              label="Field Key (System Identifier)"
              helperText={
                editing
                  ? "Unique key for CSV exports (locked)."
                  : "Auto-generated database key. Used in custom field metrics."
              }
              value={key}
              disabled
              fullWidth
            />
            <TextField
              label="Field Type"
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
                  color="primary"
                />
              }
              label="Make this field required"
            />
            {needsOptions(type) ? (
              <TextField
                label="Options List"
                helperText="Type options separated by commas (e.g. Small, Medium, Large)"
                value={optionsCsv}
                onChange={(e) => setOptionsCsv(e.target.value)}
                fullWidth
                placeholder="Option 1, Option 2, Option 3"
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setOpen(false)} disabled={pending} sx={{ textTransform: "none" }}>
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
                const savedField: RegistrationFieldRow = {
                  id: res.data!.fieldId,
                  key,
                  label,
                  type,
                  required,
                  options,
                  sortOrder: editing?.sortOrder ?? fields.length + 1,
                };
                setLocalFields((current) =>
                  editing
                    ? current.map((field) => field.id === editing.id ? savedField : field)
                    : [...current, savedField],
                );
                showToast("Saved field config", "success");
                setOpen(false);
                router.refresh();
              });
            }}
            sx={{
              textTransform: "none",
              backgroundColor: "#0A84FF",
              color: "#FFFFFF",
              fontWeight: 600,
              borderRadius: "8px",
              px: 3,
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── CONFIRM DELETE DIALOG ── */}
      <ConfirmationDialog
        open={!!deleteConfirmField}
        title="Delete Custom Field"
        message={`Are you sure you want to delete the field "${deleteConfirmField?.label}"? This will permanently delete all guest answers collected for this field.`}
        confirmLabel="Delete"
        loading={pending}
        onCancel={() => setDeleteConfirmField(null)}
        onConfirm={() => {
          if (!deleteConfirmField) return;
          const targetField = { ...deleteConfirmField };
          const previousFields = localFields;
          setDeleteConfirmField(null);
          setLocalFields((current) => current.filter((field) => field.id !== targetField.id));
          startTransition(async () => {
            const res = await deleteEventRegistrationField({
              organisationSlug,
              eventId,
              fieldId: targetField.id,
            });
            if (!res.ok) {
              setLocalFields(previousFields);
              showToast(res.error, "error");
            } else {
              showToast(
                `Field "${targetField.label}" deleted`,
                "success",
                {
                  label: "Undo",
                  onClick: () => {
                    startTransition(async () => {
                      const restoreRes = await upsertEventRegistrationField({
                        organisationSlug,
                        eventId,
                        key: targetField.key,
                        label: targetField.label,
                        type: targetField.type,
                        required: targetField.required,
                        options: targetField.options,
                      });
                      if (restoreRes.ok) {
                        setLocalFields((current) => [
                          ...current,
                          {
                            ...targetField,
                            id: restoreRes.data!.fieldId,
                          },
                        ]);
                        showToast("Field restored", "success");
                        router.refresh();
                      } else {
                        showToast(restoreRes.error, "error");
                      }
                    });
                  },
                },
                10000
              );
              router.refresh();
            }
          });
        }}
      />
    </Stack>
  );
}
