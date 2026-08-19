"use client";

import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

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
    <Stack spacing={3}>
      {!isEventPage && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          useFlexGap
          sx={{
            flexWrap: "wrap",
            alignItems: { xs: "flex-start", sm: "center" },
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: "center" }}
          >
            <Link href="/dashboard" style={{ textDecoration: "none" }}>
              <Button size="small" variant="text" component="span">
                Organisations
              </Button>
            </Link>
            <Typography variant="body2" color="text.secondary">
              /
            </Typography>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
              {organisationName}
            </Typography>
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Link href={`/${organisationSlug}`} style={{ textDecoration: "none" }}>
              <Button size="small" variant="outlined" component="span">
                Public page
              </Button>
            </Link>
            <Link
              href={`/dashboard/${organisationSlug}/members`}
              style={{ textDecoration: "none" }}
            >
              <Button size="small" variant="outlined" component="span">
                Members
              </Button>
            </Link>
          </Stack>
        </Stack>
      )}
      {children}
    </Stack>
  );
}
