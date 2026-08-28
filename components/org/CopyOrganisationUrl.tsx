"use client";

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import { useToast } from "@/components/feedback/ToastProvider";

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.focus();
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

export function CopyOrganisationUrl(props: { slug: string }) {
  const { slug } = props;
  const { showToast } = useToast();

  return (
    <Tooltip title="Copy organisation URL">
      <Chip
        clickable
        icon={<ContentCopyOutlinedIcon fontSize="small" />}
        label={`/${slug}`}
        variant="outlined"
        aria-label={`Copy the public URL for ${slug}`}
        onClick={async () => {
          try {
            await copyToClipboard(`${window.location.origin}/${slug}`);
            showToast("Organisation URL copied", "success", null, 2500);
          } catch {
            showToast("Could not copy organisation URL", "error");
          }
        }}
        sx={{ bgcolor: "background.paper" }}
      />
    </Tooltip>
  );
}
