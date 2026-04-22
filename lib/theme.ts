"use client";

import { createTheme } from "@mui/material/styles";

export function createAppTheme(mode: "light" | "dark" = "light") {
  const isDark = mode === "dark";
  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: {
        // Mint green (accent)
        main: isDark ? "#7CF5B6" : "#39D98A",
        contrastText: isDark ? "#0B0F0E" : "#0B0F0E",
      },
      secondary: {
        // Lavender (secondary accent)
        main: isDark ? "#B9AEFF" : "#7B6CFF",
      },
      background: {
        // Soft sage background + clean surfaces
        default: isDark ? "#0F1412" : "#DCE6DD",
        paper: isDark ? "#121A16" : "#F4F7F4",
      },
      text: {
        primary: isDark ? "rgba(255,255,255,0.92)" : "#0E1412",
        secondary: isDark ? "rgba(255,255,255,0.70)" : "rgba(14,20,18,0.70)",
      },
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(14,20,18,0.10)",
    },
    shape: {
      borderRadius: 12,
    },
    spacing: 8,
    typography: {
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      h1: { fontWeight: 600, letterSpacing: "-0.02em" },
      h2: { fontWeight: 600, letterSpacing: "-0.01em" },
      h3: { fontWeight: 600 },
      body1: { lineHeight: 1.6 },
      body2: { lineHeight: 1.5 },
    },
    transitions: {
      duration: {
        shortest: 150,
        shorter: 200,
        short: 250,
        standard: 300,
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            borderRadius: 999,
            fontWeight: 600,
            transition: "background-color 0.2s ease, box-shadow 0.2s ease",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            boxShadow: isDark
              ? "0 10px 30px rgba(0,0,0,0.45)"
              : "0 10px 30px rgba(14,20,18,0.12)",
            transition: "box-shadow 0.2s ease",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 20 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { transition: "color 0.2s ease" },
        },
      },
    },
  });
}
