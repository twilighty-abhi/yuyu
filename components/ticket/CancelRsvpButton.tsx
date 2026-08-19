"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import { cancelRsvp } from "@/app/actions/rsvp-cancel";

export function CancelRsvpButton(props: {
  checkInToken: string;
  eventPageHref: string;
}) {
  const { checkInToken, eventPageHref } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelRsvp({ checkInToken });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Clear the local storage ticket token
      try {
        const keys = Object.keys(localStorage);
        for (const key of keys) {
          if (key.startsWith("yuyu:rsvp:")) {
            try {
              const val = localStorage.getItem(key);
              const parsed = val ? (JSON.parse(val) as { ticketToken?: string }) : null;
              if (parsed?.ticketToken === checkInToken) {
                localStorage.removeItem(key);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch {
        // localStorage not available
      }
      setOpen(false);
      router.push(eventPageHref);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outlined"
        color="error"
        size="small"
        onClick={() => setOpen(true)}
        sx={{ borderRadius: 999, alignSelf: "flex-start" }}
      >
        Cancel registration
      </Button>

      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: { sx: { borderRadius: 3 } },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          Cancel your registration?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Your RSVP will be removed and your spot will be given to the next
            person on the waitlist (if any). This cannot be undone.
          </DialogContentText>
          {error ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Keep registration
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleCancel}
            disabled={pending}
          >
            {pending ? "Cancelling…" : "Yes, cancel"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
