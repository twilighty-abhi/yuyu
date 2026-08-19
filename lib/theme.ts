"use client";

import { createTheme } from "@mui/material/styles";

export function createAppTheme(mode: "light" | "dark" = "light") {
  const isDark = mode === "dark";
  
  // Apple System Colors
  const systemBlue = isDark ? "#0A84FF" : "#007AFF";
  const systemGreen = isDark ? "#30D158" : "#34C759";
  const systemOrange = isDark ? "#FF9F0A" : "#FF9500";
  const systemGray = isDark ? "#8E8E93" : "#8E8E93";
  const systemBackground = isDark ? "#000000" : "#F2F2F7";
  const systemSecondaryBackground = isDark ? "#1C1C1E" : "#FFFFFF";

  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: {
        main: systemBlue,
        contrastText: "#FFFFFF",
      },
      secondary: {
        main: systemGray,
      },
      success: {
        main: systemGreen,
      },
      warning: {
        main: systemOrange,
      },
      background: {
        default: systemBackground,
        paper: systemSecondaryBackground,
      },
      text: {
        primary: isDark ? "#FFFFFF" : "#000000",
        secondary: isDark ? "#8E8E93" : "#6C6C70",
      },
      divider: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    },
    shape: {
      borderRadius: 10,
    },
    spacing: 8,
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
      h1: { fontWeight: 700, letterSpacing: "-1.2px" },
      h2: { fontWeight: 700, letterSpacing: "-0.8px" },
      h3: { fontWeight: 700, letterSpacing: "-0.5px" },
      h4: { fontWeight: 700, letterSpacing: "-0.4px" },
      h5: { fontWeight: 600, letterSpacing: "-0.3px" },
      h6: { fontWeight: 600, letterSpacing: "-0.2px" },
      body1: { lineHeight: 1.5, letterSpacing: "-0.1px" },
      body2: { lineHeight: 1.4, letterSpacing: "-0.1px" },
      button: { fontWeight: 600, letterSpacing: "-0.1px" },
    },
    components: {
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            textTransform: "none",
            borderRadius: "8px",
            fontWeight: 600,
            padding: "6px 16px",
            fontSize: "0.875rem",
            boxShadow: "none",
            transition: "opacity 0.15s ease",
            "&:hover": {
              boxShadow: "none",
              opacity: 0.9,
            },
          },
          contained: {
            backgroundColor: systemBlue,
            color: "#FFFFFF",
            "&:hover": {
              backgroundColor: systemBlue,
            },
          },
          outlined: {
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
            color: isDark ? "#FFFFFF" : "#000000",
            "&:hover": {
              backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
              borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            backgroundImage: "none",
            boxShadow: "none",
            border: isDark ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(0, 0, 0, 0.08)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            boxShadow: "none",
          },
          outlined: {
            borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
            borderRadius: 12,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 14,
            backgroundImage: "none",
            border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: "8px",
            backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: systemBlue,
              borderWidth: "1.5px",
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: "6px",
            fontWeight: 500,
          },
          outlined: {
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            transition: "color 0.15s ease",
          },
        },
      },
    },
  });
}
