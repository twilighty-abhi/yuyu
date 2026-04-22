"use client";

import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import useMediaQuery from "@mui/material/useMediaQuery";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { createAppTheme } from "@/lib/theme";
import { useMemo } from "react";
import { ToastProvider } from "@/components/feedback/ToastProvider";

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)", {
    defaultMatches: false,
  });
  const theme = useMemo(
    () => createAppTheme(prefersDark ? "dark" : "light"),
    [prefersDark],
  );
  return (
    <SessionProvider session={session}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
