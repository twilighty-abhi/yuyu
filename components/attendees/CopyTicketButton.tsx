"use client";

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import { useToast } from "@/components/feedback/ToastProvider";

export function CopyTicketButton(props: { ticketUrl: string }) {
  const { ticketUrl } = props;
  const { showToast } = useToast();

  return (
    <Tooltip title="Copy ticket link">
      <IconButton
        size="small"
        aria-label="Copy ticket link"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ticketUrl);
            showToast("Ticket link copied", "success");
          } catch {
            showToast("Could not copy", "error");
          }
        }}
      >
        <ContentCopyOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
