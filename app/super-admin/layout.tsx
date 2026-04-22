import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import { requireSuperAdmin } from "@/lib/permissions";
import { SuperAdminTabs } from "@/components/super-admin/SuperAdminTabs";

export default async function SuperAdminLayout(props: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  return (
    <Stack spacing={2} sx={{ py: 2 }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <SuperAdminTabs />
      </Box>
      {props.children}
    </Stack>
  );
}

