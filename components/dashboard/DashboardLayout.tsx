"use client";

import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import Paper from "@mui/material/Paper";

export function DashboardLayout(props: {
  organisationName: string;
  organisationSlug: string;
  children: React.ReactNode;
}) {
  const { organisationName, organisationSlug, children } = props;
  const pathname = usePathname();

  // Hide organisation header on event management pages
  const isEventPage = pathname?.includes("/event/");

  return (
    <Stack spacing={3.5} sx={{ py: { xs: 1, sm: 2 } }}>
      {!isEventPage && (
        <Paper
          variant="outlined"
          sx={{
            px: { xs: 1.5, sm: 2 },
            py: 1.25,
            borderRadius: "18px",
            borderColor: "divider",
            backgroundColor: "background.paper",
            backdropFilter: "blur(14px)",
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            useFlexGap
            sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Link href="/dashboard" style={{ textDecoration: "none" }}>
                <Button size="small" variant="text" component="span" sx={{ textTransform: "none" }}>
                  Organisations
                </Button>
              </Link>
              <Typography variant="body2" color="text.secondary">/</Typography>
              <Typography variant="body2" sx={{ fontWeight: 650, color: "text.primary" }}>
                {organisationName}
              </Typography>
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Link href={`/${organisationSlug}`} style={{ textDecoration: "none" }}>
                <Button size="small" variant="outlined" component="span" sx={{ textTransform: "none", borderRadius: 2 }}>
                  Public page
                </Button>
              </Link>
              <Link href={`/dashboard/${organisationSlug}/members`} style={{ textDecoration: "none" }}>
                <Button size="small" variant="outlined" component="span" sx={{ textTransform: "none", borderRadius: 2 }}>
                  Members
                </Button>
              </Link>
            </Stack>
          </Stack>
        </Paper>
      )}
      {children}
    </Stack>
  );
}
