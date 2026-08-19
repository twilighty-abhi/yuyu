"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { updateMemberRole, removeMember } from "@/app/actions/membership";
import { useToast } from "@/components/feedback/ToastProvider";

export function MemberRoleActions(props: {
  organisationSlug: string;
  targetUserId: string;
  role: MembershipRole;
  actorRole: MembershipRole;
}) {
  const { organisationSlug, targetUserId, role, actorRole } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const canEditRoles = actorRole === "OWNER" && role !== "OWNER";
  const canRemove =
    (actorRole === "OWNER" && role !== "OWNER") ||
    (actorRole === "ADMIN" && role === "MEMBER");

  if (!canEditRoles && !canRemove) {
    return (
      <Chip
        label={role === "OWNER" ? "Owner" : role === "ADMIN" ? "Admin" : "Member"}
        size="small"
        variant="outlined"
        sx={{ borderColor: "rgba(10,132,255,0.4)", color: "#72B7FF", fontWeight: 650 }}
      />
    );
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "center" }}
    >
      {canEditRoles ? (
        <TextField
          select
          size="small"
          label="Role"
          value={role}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value as "ADMIN" | "MEMBER";
            startTransition(async () => {
              const res = await updateMemberRole({
                organisationSlug,
                targetUserId,
                role: next,
              });
              if (!res.ok) {
                showToast(res.error, "error");
                return;
              }
              showToast("Role updated", "success");
              router.refresh();
            });
          }}
          sx={{ minWidth: 120, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
        >
          <MenuItem value="ADMIN">ADMIN</MenuItem>
          <MenuItem value="MEMBER">MEMBER</MenuItem>
        </TextField>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {role}
        </Typography>
      )}
      <Button
        size="small"
        color="error"
        variant="outlined"
        disabled={pending}
        sx={{ display: canRemove ? "inline-flex" : "none", textTransform: "none", borderRadius: 2 }}
        onClick={() => {
          startTransition(async () => {
            const res = await removeMember({
              organisationSlug,
              targetUserId,
            });
            if (!res.ok) {
              showToast(res.error, "error");
              return;
            }
            showToast("Member removed", "success");
            router.refresh();
          });
        }}
      >
        Remove
      </Button>
    </Stack>
  );
}
