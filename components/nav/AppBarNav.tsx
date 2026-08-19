"use client";

import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { alpha, useTheme } from "@mui/material/styles";
import { usePathname } from "next/navigation";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import { useAppColorMode } from "@/components/providers";

export function AppBarNav() {
  const { status } = useSession();
  const theme = useTheme();
  const pathname = usePathname();
  const { mode, toggleColorMode } = useAppColorMode();

  if (pathname === "/login") return null;
  const bg =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.background.default, 0.92)
      : "rgba(255, 251, 254, 0.9)";

  return (
    <AppBar
      position="sticky"
      color="transparent"
      elevation={0}
      sx={{
        borderBottom: "1px solid",
        borderColor: "divider",
        backdropFilter: "blur(8px)",
        bgcolor: bg,
        transition: "background-color 0.2s ease",
      }}
    >
      <Toolbar sx={{ maxWidth: 1100, width: "100%", mx: "auto", px: { xs: 2, sm: 3 } }}>
        <Typography
          variant="h6"
          component={Link}
          href="/"
          sx={{
            fontWeight: 700,
            color: "primary.main",
            textDecoration: "none",
            mr: 2,
          }}
        >
          Yuyu
        </Typography>
        <Box sx={{ display: "flex", gap: 0.5, flexGrow: 1, flexWrap: "wrap" }}>
          <Button component={Link} href="/discover" color="inherit" size="small">
            Discover
          </Button>
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Tooltip title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}>
            <IconButton
              onClick={toggleColorMode}
              aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
              size="small"
              sx={{ color: "text.primary", border: "1px solid", borderColor: "divider" }}
            >
              {mode === "dark" ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          {status === "authenticated" ? (
            <>
              <Button component={Link} href="/dashboard" color="inherit">
                Dashboard
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button component={Link} href="/login" variant="contained">
              Sign in
            </Button>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
