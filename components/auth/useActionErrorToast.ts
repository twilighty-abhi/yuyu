"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/feedback/ToastProvider";

/** Sign-in page URL that returns to `path` afterwards (a site-relative path). */
export function reauthLoginHref(path: string) {
  return `/login?callbackUrl=${encodeURIComponent(path)}`;
}

/**
 * Shows a failed Server Action's message as an error toast. When the action
 * needs a fresh sign-in (`reauthRequired`), the toast offers "Sign in again",
 * which returns to this page afterwards.
 */
export function useActionErrorToast() {
  const router = useRouter();
  const { showToast } = useToast();
  return useCallback(
    (result: { error: string; reauthRequired?: boolean }) => {
      if (!result.reauthRequired) return showToast(result.error, "error");
      const here = `${window.location.pathname}${window.location.search}`;
      showToast(result.error, "error", { label: "Sign in again", onClick: () => router.push(reauthLoginHref(here)) }, 10_000);
    },
    [router, showToast],
  );
}
