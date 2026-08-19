"use client";

import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { createAppTheme } from "@/lib/theme";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { ToastProvider } from "@/components/feedback/ToastProvider";

type ColorMode = "light" | "dark";

function getBrowserColorMode(): ColorMode {
  const saved = window.localStorage.getItem("yuyu:color-mode");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeToColorMode(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("yuyu:color-mode-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("yuyu:color-mode-change", onStoreChange);
  };
}

function getServerColorMode(): ColorMode {
  // This exact snapshot is used for SSR and the first hydration render.
  return "dark";
}

const ColorModeContext = createContext<{
  mode: ColorMode;
  toggleColorMode: () => void;
} | null>(null);

export function useAppColorMode() {
  const context = useContext(ColorModeContext);
  if (!context) throw new Error("useAppColorMode must be used inside Providers.");
  return context;
}

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  const mode = useSyncExternalStore(
    subscribeToColorMode,
    getBrowserColorMode,
    getServerColorMode,
  );

  useEffect(() => {
    document.documentElement.dataset.colorMode = mode;
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const colorMode = useMemo(
    () => ({
      mode,
      toggleColorMode: () => {
        const next = mode === "dark" ? "light" : "dark";
        window.localStorage.setItem("yuyu:color-mode", next);
        window.dispatchEvent(new Event("yuyu:color-mode-change"));
      },
    }),
    [mode],
  );
  return (
    <SessionProvider session={session}>
      <ColorModeContext.Provider value={colorMode}>
        <ThemeProvider theme={theme}>
          <CssBaseline enableColorScheme />
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </ColorModeContext.Provider>
    </SessionProvider>
  );
}
