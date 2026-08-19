import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import { CreateOrgForm } from "@/components/org/CreateOrgForm";

export default function NewOrganisationPage() {
  return (
    <Stack spacing={3.5} sx={{ py: { xs: 1, sm: 2 }, maxWidth: 640 }}>
      <Stack spacing={0.5}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.5px" }}>
          Create an organisation
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Set up a workspace for your events and community. You&apos;ll be its owner.
        </Typography>
      </Stack>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: "18px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
        <CreateOrgForm />
      </Paper>
    </Stack>
  );
}
