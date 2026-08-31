"use client";

import { useMemo, useState, useTransition } from "react";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import AddLinkOutlinedIcon from "@mui/icons-material/AddLinkOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { createOrgInvite, revokeOrgInvite } from "@/app/actions/org-invites";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";

export type OrgInviteRow = {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
};

export function OrgInviteLinkPanel(props: {
  organisationSlug: string;
  baseUrl: string;
  invites: OrgInviteRow[];
}) {
  const { organisationSlug, baseUrl } = props;
  const [invites, setInvites] = useState<OrgInviteRow[]>(props.invites);
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const latest = invites[0] ?? null;
  const latestUrl = useMemo(() => {
    if (!latest) return "";
    return `${baseUrl}/join/org/${latest.token}`;
  }, [baseUrl, latest]);

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            Invite link
          </Typography>
          <Chip size="small" label="Single-use" variant="outlined" />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Generate a one-time link to add someone as a member. Only admins and
          the owner can create links.
        </Typography>

        <Divider />

        <Stack spacing={1}>
          <TextField
            label="Latest invite URL"
            value={latestUrl || "No invite generated yet."}
            fullWidth
            size="small"
            slotProps={{ input: { readOnly: true } }}
          />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: { sm: "center" } }}
          >
            <Button
              variant="contained"
              disabled={pending}
              startIcon={<AddLinkOutlinedIcon />}
              onClick={() => {
                startTransition(async () => {
                  const res = await createOrgInvite({ organisationSlug });
                  if (!res.ok) {
                    showToast(res.error, "error");
                    return;
                  }
                  const inviteId = (res.data as { inviteId: string }).inviteId;
                  const token = (res.data as { token: string }).token;
                  const row: OrgInviteRow = {
                    id: inviteId,
                    token,
                    createdAt: new Date().toISOString(),
                    expiresAt: null,
                  };
                  setInvites((prev) => [row, ...prev]);
                  showToast("Invite link generated", "success");
                });
              }}
            >
              Generate link
            </Button>
            <Button
              variant="outlined"
              disabled={!latestUrl || pending}
              startIcon={<ContentCopyOutlinedIcon />}
              onClick={() => {
                void navigator.clipboard
                  .writeText(latestUrl)
                  .then(() => showToast("Copied link", "success"))
                  .catch(() => showToast("Could not copy link", "error"));
              }}
            >
              Copy
            </Button>
            {latest ? (
              <Button
                variant="outlined"
                color="error"
                disabled={pending}
                startIcon={<DeleteOutlineOutlinedIcon />}
                onClick={() => setConfirmRevoke(true)}
              >
                Revoke latest
              </Button>
            ) : null}
          </Stack>
        </Stack>

        <ConfirmationDialog
          open={confirmRevoke}
          title="Revoke invite link?"
          message="Anyone who has this link will no longer be able to use it to join the organisation."
          confirmLabel="Revoke link"
          loading={pending}
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={() => {
            if (!latest) return;
            startTransition(async () => {
              const res = await revokeOrgInvite({
                organisationSlug,
                inviteId: latest.id,
              });
              if (!res.ok) return showToast(res.error, "error");
              setInvites((prev) => prev.filter((x) => x.id !== latest.id));
              setConfirmRevoke(false);
              showToast("Invite revoked", "success");
            });
          }}
        />

        {invites.length > 1 ? (
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Recent unused links
            </Typography>
            <Stack spacing={0.75}>
              {invites.slice(1, 6).map((i) => (
                <Typography
                  key={i.id}
                  variant="body2"
                  sx={{ fontFamily: "var(--font-geist-mono)" }}
                  color="text.secondary"
                >
                  {`${baseUrl}/join/org/${i.token}`}
                </Typography>
              ))}
            </Stack>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
