"use client";

import Button from "@mui/material/Button";
import AlternateEmailOutlinedIcon from "@mui/icons-material/AlternateEmailOutlined";
import {
  attendeeEmailExportFilename,
  buildAttendeeEmailCsv,
  type AttendeeEmailExportRow,
} from "@/lib/attendeeEmailExport";

export function ExportEmailsButton(props: {
  eventTitle: string;
  attendees: AttendeeEmailExportRow[];
}) {
  const { eventTitle, attendees } = props;

  function handleExport() {
    const csv = buildAttendeeEmailCsv(attendees);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = attendeeEmailExportFilename(eventTitle);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const hasEmail = attendees.some((attendee) => Boolean(attendee.user?.email ?? attendee.guestEmail));

  return (
    <Button
      variant="outlined"
      size="small"
      startIcon={<AlternateEmailOutlinedIcon />}
      onClick={handleExport}
      disabled={!hasEmail}
      sx={{ borderRadius: 2 }}
    >
      Export emails
    </Button>
  );
}
