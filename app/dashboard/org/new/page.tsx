import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { CreateOrgForm } from "@/components/org/CreateOrgForm";

export default function NewOrganisationPage() {
  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      <Typography variant="h4" component="h1">
        New organisation
      </Typography>
      <Typography variant="body2" color="text.secondary">
        You will be the owner. The URL slug must be unique.
      </Typography>
      <CreateOrgForm />
    </Stack>
  );
}
