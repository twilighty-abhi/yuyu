"use client";

import { useState, useTransition } from "react";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import QRCode from "react-qr-code";
import { createOrRotateCheckInStation, disableCheckInStation, revealCheckInStationPin } from "@/app/actions/checkin-station";
import { useToast } from "@/components/feedback/ToastProvider";

export function CheckInStationSettings({ organisationSlug, eventId, stationUrl, enabled }: { organisationSlug: string; eventId: string; stationUrl: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState<string | null>(null);
  const { showToast } = useToast();
  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); showToast(message, "success"); } catch { showToast("Could not copy to the clipboard.", "error"); }
  };
  const generate = () => startTransition(async () => {
    const result = await createOrRotateCheckInStation({ organisationSlug, eventId });
    if (!result.ok) return showToast(result.error, "error");
    setPin(result.data!.pin);
    showToast(enabled ? "Venue PIN rotated." : "Venue check-in station enabled.", "success");
  });
  const disable = () => startTransition(async () => {
    const result = await disableCheckInStation({ organisationSlug, eventId });
    if (!result.ok) return showToast(result.error, "error");
    setPin(null);
    showToast("Venue check-in station disabled.", "success");
  });
  const reveal = () => startTransition(async () => {
    const result = await revealCheckInStationPin({ organisationSlug, eventId });
    if (!result.ok) return showToast(result.error, "error");
    setPin(result.data!.pin);
  });
  return <Paper variant="outlined" sx={{ p: 2 }}>
    <Stack spacing={1.25}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Venue check-in station</Typography>
      <Typography variant="body2" color="text.secondary">Give trusted door staff the station link and PIN. It permits online check-in only; roster and CSV exports stay in this dashboard.</Typography>
      {enabled ? <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="body2" sx={{ fontFamily: "monospace", overflowWrap: "anywhere", flex: 1 }}>{stationUrl}</Typography>
        <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copy(stationUrl, "Station link copied.")}>Copy link</Button>
      </Stack> : null}
      {enabled ? <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ bgcolor: "#fff", p: 1.25, borderRadius: 1.5, width: 156, lineHeight: 0 }}>
          <QRCode value={stationUrl} size={132} bgColor="#FFFFFF" fgColor="#111111" level="M" style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
        </Box>
        <Typography variant="body2" color="text.secondary">Scan this QR code on a venue device to open the check-in station quickly. Staff will still need the current PIN.</Typography>
      </Stack> : null}
      {pin ? <Alert severity="warning" action={<Button color="inherit" size="small" startIcon={<ContentCopyIcon />} onClick={() => copy(pin, "PIN copied.")}>Copy</Button>}>PIN: <strong>{pin}</strong>. Organisation admins can use “Show PIN” here again until it is rotated or disabled.</Alert> : null}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button variant="contained" onClick={generate} disabled={pending}>{enabled ? "Rotate PIN" : "Create station PIN"}</Button>
        {enabled ? <Button variant="outlined" onClick={reveal} disabled={pending}>Show PIN</Button> : null}
        {enabled ? <Button color="error" onClick={disable} disabled={pending}>Disable station</Button> : null}
      </Stack>
    </Stack>
  </Paper>;
}
