"use client";
import { EventPermission } from "@prisma/client";
import { useState, useTransition } from "react";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createEventCollaboratorInvite } from "@/app/actions/event-collaborators";
import { useToast } from "@/components/feedback/ToastProvider";

const options: Array<[EventPermission, string]> = [["EDIT_DETAILS", "Edit event details"], ["MANAGE_REGISTRATIONS", "Manage registrations"], ["MANAGE_INVITATIONS", "Manage attendee invites"], ["CHECK_IN", "Operate check-in"], ["PUBLISH_AND_SCHEDULE", "Publish and manage schedule"]];
export function CollaboratorInvitePanel({ organisationSlug, eventId }: { organisationSlug: string; eventId: string }) { const [email, setEmail] = useState(""); const [selected, setSelected] = useState<EventPermission[]>(["EDIT_DETAILS"]); const [pending, startTransition] = useTransition(); const { showToast } = useToast(); return <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}><Typography variant="h6">Co-organizers</Typography><Typography variant="body2" color="text.secondary">Invite someone to manage only this event. They do not become an organisation member.</Typography><TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><Stack>{options.map(([permission, label]) => <FormControlLabel key={permission} label={label} control={<Checkbox checked={selected.includes(permission)} onChange={(_, checked) => setSelected((current) => checked ? [...current, permission] : current.filter((value) => value !== permission))} />} />)}</Stack><Button disabled={pending || !email || selected.length === 0} variant="outlined" onClick={() => startTransition(async () => { const result = await createEventCollaboratorInvite({ organisationSlug, eventId, email, permissions: selected }); if (!result.ok) return showToast(result.error, "error"); setEmail(""); showToast("Co-organizer invite email queued", "success"); })}>Invite co-organizer</Button></Stack></Paper>; }
