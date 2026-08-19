"use client";

import { useEffect, useState } from "react";
import Chip from "@mui/material/Chip";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";

function countdownLabel(startAt: number, endAt: number, now: number) {
  if (now >= endAt) return { label: "Ended", live: false };
  if (now >= startAt) return { label: "Happening now", live: true };

  let seconds = Math.ceil((startAt - now) / 1_000);
  const days = Math.floor(seconds / 86_400);
  seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const time = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return { label: days > 0 ? `${days}d ${time}` : time, live: false };
}

export function EventCountdownBadge(props: { startAt: string; endAt: string }) {
  const { startAt, endAt } = props;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  if (now === null) return null;

  const { label, live } = countdownLabel(new Date(startAt).getTime(), new Date(endAt).getTime(), now);

  return (
    <Chip
      icon={<ScheduleOutlinedIcon sx={{ fontSize: 14 }} />}
      label={label}
      size="small"
      variant="outlined"
      sx={
        live
          ? { borderColor: "rgba(48,209,88,0.5)", color: "#7CE6A2", "& .MuiChip-icon": { color: "inherit" } }
          : { borderColor: "rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.68)", "& .MuiChip-icon": { color: "inherit" } }
      }
    />
  );
}
