import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { SuperAdminTabs } from "@/components/super-admin/SuperAdminTabs";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Super admin", robots: { index: false, follow: false } };

// These pages require an authenticated database-backed session and must never
// be rendered during the build with placeholder database credentials.
export const dynamic = "force-dynamic";

export default async function SuperAdminLayout(props: {
  children: React.ReactNode;
}) {
  await requireSuperAdminMfa();

  return (
    <Stack spacing={2} sx={{ py: 2 }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <SuperAdminTabs />
      </Box>
      {props.children}
    </Stack>
  );
}
