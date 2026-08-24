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
import Divider from "@mui/material/Divider";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import { useAppColorMode } from "@/components/providers";

export function AppBarNav() {
  const { status } = useSession();
  const theme = useTheme();
  const pathname = usePathname();
  const { mode, toggleColorMode } = useAppColorMode();
  const [mobileMenuAnchor, setMobileMenuAnchor] = useState<HTMLElement | null>(null);
  const mobileMenuOpen = Boolean(mobileMenuAnchor);
  const closeMobileMenu = () => setMobileMenuAnchor(null);

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
                <Button component={Link} href="/dashboard/security" color="inherit" sx={{ minHeight: 44 }}>
                  Security
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
            aria-label="Open navigation menu"
            aria-controls="mobile-navigation"
            aria-expanded={mobileMenuOpen}
            onClick={(event) => setMobileMenuAnchor(mobileMenuOpen ? null : event.currentTarget)}
            sx={{ display: { xs: "inline-flex", sm: "none" }, width: 44, height: 44 }}
          >
            <MenuIcon />
          </IconButton>
        </Box>
      </Toolbar>
      <Menu
        id="mobile-navigation"
        anchorEl={mobileMenuAnchor}
        open={mobileMenuOpen}
        onClose={closeMobileMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: "min(240px, calc(100vw - 24px))",
              mt: 0.75,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2.5,
              overflow: "hidden",
            },
          },
        }}
      >
        <MenuItem component={Link} href="/discover" onClick={closeMobileMenu} selected={pathname === "/discover"} sx={{ minHeight: 48 }}>
          Discover
        </MenuItem>
        {status === "authenticated" ? (
          <MenuItem component={Link} href="/dashboard" onClick={closeMobileMenu} selected={pathname?.startsWith("/dashboard")} sx={{ minHeight: 48 }}>
            Dashboard
          </MenuItem>
        ) : null}
        {status === "authenticated" ? (
          <MenuItem component={Link} href="/dashboard/security" onClick={closeMobileMenu} selected={pathname === "/dashboard/security"} sx={{ minHeight: 48 }}>
            Security
          </MenuItem>
        ) : null}
        <Divider />
        {status === "authenticated" ? (
          <MenuItem onClick={() => { closeMobileMenu(); void signOut({ callbackUrl: "/" }); }} sx={{ minHeight: 48 }}>
            Sign out
          </MenuItem>
        ) : (
          <MenuItem component={Link} href="/login" onClick={closeMobileMenu} sx={{ minHeight: 48 }}>
            Sign in
          </MenuItem>
        )}
      </Menu>
    </AppBar>
  );
}
