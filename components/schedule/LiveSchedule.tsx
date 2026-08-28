"use client";
import { useEffect, useMemo, useState } from "react";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";

export function LiveSchedule({ items, timeZone }: { items: Array<{ id: string; title: string; description: string; effectiveStart: string; effectiveEnd: string }>; timeZone: string }) {
  const router = useRouter(); const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1_000); const refresh = window.setInterval(() => router.refresh(), 60_000); return () => { clearInterval(tick); clearInterval(refresh); }; }, [router]);
  const rows = useMemo(() => items.map((item) => ({ ...item, start: new Date(item.effectiveStart), end: new Date(item.effectiveEnd) })), [items]);
  return <Stack spacing={1.5}>{rows.map((item) => { const live = now >= item.start.getTime() && now < item.end.getTime(); const complete = now >= item.end.getTime(); return <Paper key={item.id} variant="outlined" sx={{ p: 2, borderColor: live ? "primary.main" : undefined }}><Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "flex-start" }}><Stack spacing={0.5}><Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{item.title}</Typography><Typography variant="body2" color="text.secondary">{item.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone })} – {item.end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone })}</Typography>{item.description ? <Typography variant="body2">{item.description}</Typography> : null}</Stack><Chip size="small" color={live ? "success" : "default"} label={live ? "Live now" : complete ? "Completed" : "Upcoming"} /></Stack></Paper>; })}</Stack>;
}
