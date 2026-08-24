"use client";

import { useState } from "react";
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
import Drawer from "@mui/material/Drawer";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import { useAppColorMode } from "@/components/providers";

export function AppBarNav() {
  const { status } = useSession();
  const theme = useTheme();
  const pathname = usePathname();
  const { mode, toggleColorMode } = useAppColorMode();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      <Toolbar
        component="nav"
        aria-label="Main navigation"
        sx={{
          maxWidth: 1100,
          width: "100%",
          minHeight: { xs: 64, sm: 72 },
          mx: "auto",
          px: { xs: 1.5, sm: 3 },
          gap: { xs: 0.5, sm: 1 },
        }}
      >
        <Typography
          variant="h6"
          component={Link}
          href="/"
          sx={{
            fontWeight: 700,
            color: "primary.main",
            textDecoration: "none",
            mr: { xs: 0.5, sm: 2 },
            whiteSpace: "nowrap",
          }}
        >
          Yuyu
        </Typography>
        <Box sx={{ display: { xs: "none", sm: "flex" }, gap: 0.5, flexGrow: 1 }}>
          <Button
            component={Link}
            href="/discover"
            color="inherit"
            size="small"
            aria-current={pathname === "/discover" ? "page" : undefined}
            sx={{ minHeight: 44, px: 1.5 }}
          >
            Discover
          </Button>
        </Box>
        <Box sx={{ flexGrow: { xs: 1, sm: 0 } }} />
        <Box sx={{ display: "flex", gap: { xs: 0.5, sm: 1 }, alignItems: "center" }}>
          <Tooltip title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}>
            <IconButton
              onClick={toggleColorMode}
              aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
              sx={{
                width: 44,
                height: 44,
                color: "text.primary",
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              {mode === "dark" ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Box sx={{ display: { xs: "none", sm: "flex" }, gap: 1, alignItems: "center" }}>
            {status === "authenticated" ? (
              <>
                <Button component={Link} href="/dashboard" color="inherit" sx={{ minHeight: 44 }}>
                Dashboard
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => void signOut({ callbackUrl: "/" })}
                  sx={{ minHeight: 44 }}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <Button component={Link} href="/login" variant="contained" sx={{ minHeight: 44 }}>
                Sign in
              </Button>
            )}
          </Box>
          <IconButton
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-controls="mobile-navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
            sx={{ display: { xs: "inline-flex", sm: "none" }, width: 44, height: 44 }}
          >
            {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
          </IconButton>
        </Box>
      </Toolbar>
      <Drawer
        anchor="right"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        slotProps={{ paper: { id: "mobile-navigation", sx: { width: "min(320px, 88vw)", pt: 1 } } }}
      >
        <Box sx={{ px: 2, pb: 1 }}>
          <Typography variant="overline" color="text.secondary">Navigation</Typography>
        </Box>
        <List sx={{ px: 1, py: 0 }}>
          <ListItemButton component={Link} href="/discover" onClick={() => setMobileMenuOpen(false)} selected={pathname === "/discover"} sx={{ minHeight: 52, borderRadius: 2 }}>
            <ListItemText primary="Discover" />
          </ListItemButton>
          {status === "authenticated" ? (
            <ListItemButton component={Link} href="/dashboard" onClick={() => setMobileMenuOpen(false)} selected={pathname?.startsWith("/dashboard")} sx={{ minHeight: 52, borderRadius: 2 }}>
              <ListItemText primary="Dashboard" />
            </ListItemButton>
          ) : null}
        </List>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ p: 2 }}>
          {status === "authenticated" ? (
            <Button fullWidth variant="outlined" onClick={() => { setMobileMenuOpen(false); void signOut({ callbackUrl: "/" }); }} sx={{ minHeight: 48 }}>
              Sign out
            </Button>
          ) : (
            <Button component={Link} href="/login" onClick={() => setMobileMenuOpen(false)} fullWidth variant="contained" sx={{ minHeight: 48 }}>
              Sign in
            </Button>
          )}
        </Box>
      </Drawer>
    </AppBar>
  );
}
