"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";

type Severity = "success" | "error" | "info" | "warning";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastContextValue = {
  showToast: (
    message: string,
    severity?: Severity,
    action?: ToastAction | null,
    durationMs?: number
  ) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("info");
  const [action, setAction] = useState<ToastAction | null>(null);
  const [duration, setDuration] = useState(5000);

  const showToast = useCallback(
    (
      msg: string,
      sev: Severity = "info",
      act: ToastAction | null = null,
      durationMs: number = 5000
    ) => {
      setMessage(msg);
      setSeverity(sev);
      setAction(act);
      setDuration(durationMs);
      setOpen(true);
    },
    []
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={duration}
        onClose={(_, reason) => {
          if (reason === "clickaway") return;
          setOpen(false);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={severity}
          variant="filled"
          onClose={() => setOpen(false)}
          sx={{
            width: "100%",
            borderRadius: "10px",
            alignItems: "center",
            boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
          }}
          action={
            action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  action.onClick();
                  setOpen(false);
                }}
                sx={{
                  fontWeight: 700,
                  textTransform: "none",
                  backgroundColor: "rgba(255, 255, 255, 0.15)",
                  borderRadius: "6px",
                  ml: 1,
                  px: 1.5,
                  py: 0.5,
                  fontSize: "0.75rem",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.25)",
                  },
                }}
              >
                {action.label}
              </Button>
            ) : undefined
          }
        >
          {message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
