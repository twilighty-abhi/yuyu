"use client";

import { createTheme } from "@mui/material/styles";

export function createAppTheme() {
  return createTheme({
    cssVariables: true,
    palette: {
      mode: "light",
      primary: {
        main: "#6750A4",
        contrastText: "#FFFFFF",
      },
      secondary: {
        main: "#625B71",
      },
      background: {
        default: "#F7F2FA",
        paper: "#FFFBFE",
      },
    },
    shape: {
      borderRadius: 12,
    },
    typography: {
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      h1: { fontWeight: 600, letterSpacing: "-0.02em" },
      h2: { fontWeight: 600, letterSpacing: "-0.01em" },
      h3: { fontWeight: 600 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            borderRadius: 999,
            fontWeight: 600,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(103, 80, 164, 0.08)",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 20 },
        },
      },
    },
  });
}
