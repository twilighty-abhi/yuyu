"use client";

import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { usePathname } from "next/navigation";
import Link from "next/link";

export function AccountSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tab = pathname === "/account/security" ? "/account/security" : "/account";

  return (
    <Stack spacing={3} sx={{ maxWidth: 720, mx: "auto", py: { xs: 3, sm: 5 } }}>
      <Stack spacing={0.5}>
        <Typography variant="h3" component="h1">Account settings</Typography>
        <Typography color="text.secondary">Manage your personal profile and account security.</Typography>
      </Stack>
      <Tabs value={tab} aria-label="Account settings">
        <Tab component={Link} href="/account" value="/account" label="Profile" />
        <Tab component={Link} href="/account/security" value="/account/security" label="Security" />
      </Tabs>
      {children}
    </Stack>
  );
}
