"use client";

import Button from "@mui/material/Button";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import type { AttendeeRow } from "@/components/attendees/AttendeeTable";
import { buildCsv } from "@/lib/csv";

export function ExportCsvButton(props: {
  eventTitle: string;
  attendees: AttendeeRow[];
}) {
  const { eventTitle, attendees } = props;

  function handleExport() {
    // Collect all unique custom field labels across attendees
    const fieldLabelsSet = new Set<string>();
    for (const a of attendees) {
      if (a.answers) {
        for (const ans of a.answers) {
          fieldLabelsSet.add(ans.label);
        }
      }
    }
    const fieldLabels = Array.from(fieldLabelsSet);

    // Build CSV header
    const headers = [
      "Name",
      "Email",
      "Status",
      "Registration Date",
      "Checked In At",
      "Ticket URL",
      ...fieldLabels,
    ];

    // Build CSV rows
    const rows = attendees.map((a) => {
      const name =
        a.user?.name ?? a.guestName ?? "—";
      const email =
        a.user?.email ?? a.guestEmail ?? "—";
      const status = a.status;
      const regDate = a.createdAt
        ? new Date(a.createdAt).toLocaleString()
        : "—";
      const checkIn = a.checkedInAt
        ? new Date(a.checkedInAt).toLocaleString()
        : "—";
      const ticketUrl = a.ticketUrl ?? "—";

      // Custom field values
      const fieldValues = fieldLabels.map((label) => {
        const answer = a.answers?.find((ans) => ans.label === label);
        return answer?.value ?? "";
      });

      return [name, email, status, regDate, checkIn, ticketUrl, ...fieldValues];
    });

    // Assemble CSV
    const csvContent = buildCsv([headers, ...rows]);

    // Trigger download
    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = eventTitle
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
    link.href = url;
    link.download = `attendees_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outlined"
      size="small"
      startIcon={<FileDownloadOutlinedIcon />}
      onClick={handleExport}
      disabled={attendees.length === 0}
      sx={{ borderRadius: 2 }}
    >
      Export CSV
    </Button>
  );
}
