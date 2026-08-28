import Button from "@mui/material/Button";
import DownloadIcon from "@mui/icons-material/Download";

export function EventReportDownloadButton({ href, label = "Download PDF report" }: { href: string; label?: string }) {
  return (
    <Button component="a" href={href} variant="outlined" size="small" startIcon={<DownloadIcon />}>
      {label}
    </Button>
  );
}
