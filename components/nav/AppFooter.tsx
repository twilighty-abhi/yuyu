"use client";

import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MuiLink from "@mui/material/Link";
import Link from "next/link";
import { usePathname } from "next/navigation";

const footerLinks = [
  { label: "Discover", href: "/discover" },
  { label: "Search", href: "/search" },
  { label: "Dashboard", href: "/dashboard" },
];

export function AppFooter() {
  const pathname = usePathname();

  // Hide footer on login page
  if (pathname === "/login") return null;

  return (
    <Box
      component="footer"
      sx={{
        mt: "auto",
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "background.default",
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 2, sm: 4 }}
          sx={{
            py: 3,
            justifyContent: "space-between",
            alignItems: { xs: "center", sm: "center" },
          }}
        >
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: "baseline" }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, color: "primary.main" }}
            >
              Yuyu
            </Typography>
            <Typography variant="caption" color="text.secondary">
              © {new Date().getFullYear()}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            spacing={2.5}
            useFlexGap
            sx={{ flexWrap: "wrap", justifyContent: "center" }}
          >
            {footerLinks.map((l) => (
              <MuiLink
                key={l.href}
                component={Link}
                href={l.href}
                underline="hover"
                variant="body2"
                color="text.secondary"
                sx={{
                  transition: "color 0.15s ease",
                  "&:hover": { color: "text.primary" },
                }}
              >
                {l.label}
              </MuiLink>
            ))}
          </Stack>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: { xs: "center", sm: "right" } }}
          >
            Self-hosted event management
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
