"use client";

import { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import InstallMobileOutlinedIcon from "@mui/icons-material/InstallMobileOutlined";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallCheckInAppButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!promptEvent) return null;
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<InstallMobileOutlinedIcon />}
      onClick={() => {
        const current = promptEvent;
        setPromptEvent(null);
        void current.prompt();
      }}
    >
      Install check-in app
    </Button>
  );
}
