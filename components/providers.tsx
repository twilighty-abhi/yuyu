"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { ToastProvider } from "@/components/feedback/ToastProvider";
import { TooltipProvider } from "@/components/ui/menu";
import { COLOR_MODE_COOKIE, COLOR_MODE_STORAGE_KEY, type ColorMode } from "@/lib/colorMode";

export type ColorModePreference = ColorMode | "system";

function readPreference(): ColorModePreference {
  try {
    const saved = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be blocked; fall back to the cookie below.
  }
  // The cookie is what the server rendered with, so honour it when storage is
  // empty; otherwise the page would flip back to the system mode after loading.
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(`${COLOR_MODE_COOKIE}=`))?.split("=")[1];
  return cookie === "light" || cookie === "dark" ? cookie : "system";
}

function readSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("yuyu:color-mode-change", onStoreChange);
  media.addEventListener("change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("yuyu:color-mode-change", onStoreChange);
    media.removeEventListener("change", onStoreChange);
  };
}

type ColorModeOrigin = { x: number; y: number };

const ColorModeContext = createContext<{
  mode: ColorMode;
  /** The stored choice; "system" follows the operating system. */
  preference: ColorModePreference;
  /** Pass the click point to reveal the new mode from there. */
  toggleColorMode: (origin?: ColorModeOrigin) => void;
  /** Pick light, dark or system explicitly (same storage as the toggle). */
  setColorModePreference: (next: ColorModePreference, origin?: ColorModeOrigin) => void;
} | null>(null);

function applyColorMode(next: ColorMode) {
  const root = document.documentElement;
  root.dataset.colorMode = next;
  root.style.colorScheme = next;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Switch modes in a single frame, then animate: a circular reveal from the
 * toggle where View Transitions are supported, otherwise a short colour
 * cross-fade. Reduced-motion users get an instant switch.
 */
function supportsFeatheredReveal() {
  // The feathered edge animates a registered custom property (see globals.css).
  return typeof CSS !== "undefined" && typeof CSS.registerProperty === "function" && CSS.supports("mask-image", "radial-gradient(circle, #000, transparent)");
}

/**
 * Switch modes in a single frame, then animate: a soft-edged circle grows from
 * the toggle where View Transitions are supported, otherwise a gentle colour
 * cross-fade. Reduced-motion users get an instant switch.
 */
function transitionColorMode(commit: () => void, origin?: ColorModeOrigin) {
  const root = document.documentElement;
  if (prefersReducedMotion()) {
    commit();
    return;
  }
  type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void | Promise<void>) => { ready: Promise<void>; finished: Promise<void> } };
  const doc = document as ViewTransitionDocument;
  if (typeof doc.startViewTransition !== "function") {
    root.classList.add("yy-theme-fade");
    commit();
    window.setTimeout(() => root.classList.remove("yy-theme-fade"), 460);
    return;
  }
  const x = origin?.x ?? window.innerWidth - 40;
  const y = origin?.y ?? 32;
  const feather = 160;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + feather;
  const feathered = supportsFeatheredReveal();
  root.style.setProperty("--yy-reveal-x", `${x}px`);
  root.style.setProperty("--yy-reveal-y", `${y}px`);
  root.classList.add(feathered ? "yy-theme-reveal-soft" : "yy-theme-reveal");
  const cleanUp = () => {
    root.classList.remove("yy-theme-reveal", "yy-theme-reveal-soft");
    root.style.removeProperty("--yy-reveal-x");
    root.style.removeProperty("--yy-reveal-y");
  };
  const transition = doc.startViewTransition(async () => {
    // Decode the other mode's illustration twins first so they don't pop in
    // after the reveal; capped so the switch never feels slow.
    const twins = Array.from(document.querySelectorAll<HTMLImageElement>("img.yy-img-light, img.yy-img-dark"));
    await Promise.race([Promise.allSettled(twins.map((image) => image.decode())), new Promise((resolve) => window.setTimeout(resolve, 150))]);
    commit();
  });
  // Hold the final frame: without fill the mask snaps back to 0 for a frame
  // before the transition tears down, flashing the old mode.
  const timing: KeyframeAnimationOptions = { duration: 720, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards", pseudoElement: "::view-transition-new(root)" };
  transition.ready
    .then(() => {
      root.animate(
        feathered
          ? { "--yy-reveal": ["0px", `${radius}px`] }
          : { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        timing,
      );
    })
    .catch(cleanUp);
  transition.finished.finally(cleanUp);
}

export function useAppColorMode() {
  const context = useContext(ColorModeContext);
  if (!context) throw new Error("useAppColorMode must be used inside Providers.");
  return context;
}

/**
 * Colour mode follows the operating system until the person picks one; the
 * choice is stored only in this browser (localStorage plus a cookie so the
 * server renders the right mode without a flash).
 */
export function Providers({
  children,
  initialColorMode = null,
}: {
  children: React.ReactNode;
  initialColorMode?: ColorMode | null;
}) {
  const preference = useSyncExternalStore<ColorModePreference>(subscribe, readPreference, () => initialColorMode ?? "system");
  const systemDark = useSyncExternalStore(subscribe, readSystemDark, () => false);
  const mode: ColorMode = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") {
      delete root.dataset.colorMode;
      root.style.removeProperty("color-scheme");
    } else {
      root.dataset.colorMode = preference;
      root.style.colorScheme = preference;
    }
  }, [preference]);

  const colorMode = useMemo(() => {
    const setColorModePreference = (next: ColorModePreference, origin?: ColorModeOrigin) => {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      try {
        if (next === "system") window.localStorage.removeItem(COLOR_MODE_STORAGE_KEY);
        else window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, next);
      } catch {
        // Ignore blocked storage; the cookie still carries the choice.
      }
      document.cookie = next === "system"
        ? `${COLOR_MODE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
        : `${COLOR_MODE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
      const resolved: ColorMode = next === "system" ? (readSystemDark() ? "dark" : "light") : next;
      const commit = () => {
        // Tokens and React state (icons, labels) change in the same frame.
        applyColorMode(resolved);
        flushSync(() => window.dispatchEvent(new Event("yuyu:color-mode-change")));
      };
      if (resolved === mode) commit();
      else transitionColorMode(commit, origin);
    };
    return {
      mode,
      preference,
      setColorModePreference,
      toggleColorMode: (origin?: ColorModeOrigin) => setColorModePreference(mode === "dark" ? "light" : "dark", origin),
    };
  }, [mode, preference]);
  // No next-auth <SessionProvider>: its post-hydration context change made
  // React re-render streamed dashboard panels on the client and leave the
  // server copy behind in a hidden container. Client components read the
  // session from the store in components/auth/useAuthSession.ts instead.
  return (
    <ColorModeContext.Provider value={colorMode}>
      <TooltipProvider delayDuration={300}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </ColorModeContext.Provider>
  );
}
