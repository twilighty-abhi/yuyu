"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useToast } from "@/components/feedback/ToastProvider";
import {
  deliverInstanceOutbox,
  purgeExpiredVerificationTokens,
  recordBackupRestoreVerification,
  retryFailedOutboxMessages,
} from "@/app/actions/instance";

type OperationData = { sent?: number; failed?: number; deleted?: number; retried?: number };
type OperationResult = { ok: boolean; error?: string; data?: OperationData | void };

export function InstanceOperationsControls() {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<OperationResult>, success: (data: OperationData | undefined) => string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        showToast(result.error ?? "Could not complete that operation.", "error");
        return;
      }
      showToast(success(result.data ?? undefined), "success");
      router.refresh();
    });
  }

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
      <Button disabled={pending} variant="contained" onClick={() => run(deliverInstanceOutbox, (data) => `Outbox processed: ${data?.sent ?? 0} sent, ${data?.failed ?? 0} failed.`)}>
        Deliver queued email
      </Button>
      <Button disabled={pending} variant="outlined" onClick={() => run(retryFailedOutboxMessages, (data) => `${data?.retried ?? 0} failed message(s) requeued.`)}>
        Retry failed email
      </Button>
      <Button disabled={pending} variant="outlined" onClick={() => run(purgeExpiredVerificationTokens, (data) => `${data?.deleted ?? 0} expired token(s) removed.`)}>
        Purge expired tokens
      </Button>
      <Button disabled={pending} variant="outlined" onClick={() => run(recordBackupRestoreVerification, () => "Backup restore verification recorded.") }>
        Record restore drill
      </Button>
    </Stack>
  );
}
