"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Typography from "@mui/material/Typography";
import { deleteOrganisation } from "@/app/actions/membership";
import { useToast } from "@/components/feedback/ToastProvider";

export function DeleteOrganisationButton(props: {
  organisationSlug: string;
}) {
  const { organisationSlug } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        color="error"
        variant="text"
        size="small"
        onClick={() => setOpen(true)}
      >
        Delete organisation
      </Button>
      <Dialog open={open} onClose={() => !pending && setOpen(false)}>
        <DialogTitle>Delete organisation?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            All events, RSVPs, and memberships for this organisation will be
            permanently removed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await deleteOrganisation({ organisationSlug });
                if (!res.ok) {
                  showToast(res.error, "error");
                  return;
                }
                setOpen(false);
                showToast("Organisation deleted", "success");
                router.push("/dashboard");
              });
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
