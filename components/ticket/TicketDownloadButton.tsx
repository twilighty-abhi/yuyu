import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import Button from "@mui/material/Button";

export function TicketDownloadButton(props: { downloadUrl: string }) {
  return (
    <Button component="a" href={props.downloadUrl} download variant="contained" startIcon={<DownloadRoundedIcon />} sx={{ borderRadius: 999, alignSelf: "flex-start" }}>
      Download ticket
    </Button>
  );
}
