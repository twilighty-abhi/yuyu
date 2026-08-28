"use client";
import { useState, useTransition } from "react";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { saveScheduleItem, setScheduleDelay } from "@/app/actions/schedule";
import { useToast } from "@/components/feedback/ToastProvider";
import { useRouter } from "next/navigation";

type ScheduleItem = { id: string; title: string; description: string; startDateTime: string; endDateTime: string; delayMinutes: number };

function datetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextSessionTimes(items: ScheduleItem[], defaultDate: string) {
  if (items.length === 0) return { start: defaultDate ? `${defaultDate}T09:00` : "", end: defaultDate ? `${defaultDate}T10:00` : "" };
  let cumulativeDelay = 0;
  let latestEnd = new Date(items[0]!.endDateTime);
  for (const item of items) {
    cumulativeDelay += item.delayMinutes;
    latestEnd = new Date(item.endDateTime);
  }
  const start = new Date(latestEnd.getTime() + (cumulativeDelay + 5) * 60_000);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { start: datetimeLocalValue(start), end: datetimeLocalValue(end) };
}

export function ScheduleManager({ organisationSlug, eventId, eventSeriesId, items, defaultDate = "" }: { organisationSlug: string; eventId?: string; eventSeriesId?: string; items: Array<{ id: string; title: string; description: string; startDateTime: string; endDateTime: string; delayMinutes: number }>; defaultDate?: string }) {
  const defaults = nextSessionTimes(items, defaultDate);
  const router = useRouter(); const { showToast } = useToast(); const [pending, startTransition] = useTransition(); const [title, setTitle] = useState(""); const [start, setStart] = useState(defaults.start); const [end, setEnd] = useState(defaults.end);
  const target = { organisationSlug, eventId, eventSeriesId };
  return <Stack spacing={2}><Paper variant="outlined" sx={{ p: 2 }} component="form" onSubmit={(e) => { e.preventDefault(); startTransition(async () => { const res = await saveScheduleItem({ ...target, title, startDateTime: start, endDateTime: end }); if (!res.ok) return showToast(res.error, "error"); const nextStart = new Date(end); nextStart.setMinutes(nextStart.getMinutes() + 5); setTitle(""); setStart(datetimeLocalValue(nextStart)); setEnd(datetimeLocalValue(new Date(nextStart.getTime() + 60 * 60_000))); showToast("Schedule item added", "success"); router.refresh(); }); }}><Stack spacing={1.5}><Typography variant="h6">Schedule</Typography><Typography variant="body2" color="text.secondary">New sessions begin five minutes after the previous session’s effective end time.</Typography><TextField label="Session title" value={title} onChange={(e) => setTitle(e.target.value)} required /><TextField label="Starts" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required slotProps={{ inputLabel: { shrink: true } }} /><TextField label="Ends" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required slotProps={{ inputLabel: { shrink: true } }} /><Button type="submit" disabled={pending} variant="contained">Add session</Button></Stack></Paper>{items.map((item) => <Paper key={item.id} variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}><Stack><Typography sx={{ fontWeight: 650 }}>{item.title}</Typography><Typography variant="body2" color="text.secondary">{new Date(item.startDateTime).toLocaleString()} – {new Date(item.endDateTime).toLocaleTimeString()}</Typography></Stack><TextField label="Cascade delay (min)" type="number" defaultValue={item.delayMinutes} size="small" disabled={pending} onBlur={(e) => { const delayMinutes = Number(e.target.value); if (!Number.isInteger(delayMinutes) || delayMinutes === item.delayMinutes) return; startTransition(async () => { const res = await setScheduleDelay({ ...target, itemId: item.id, delayMinutes }); if (!res.ok) showToast(res.error, "error"); else { showToast("Schedule delay updated", "success"); router.refresh(); } }); }} /></Stack></Paper>)}</Stack>;
}
