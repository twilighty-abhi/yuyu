"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  createApiClient,
  createApiCredential,
  revokeApiCredential,
  setApiClientStatus,
  updateApiClientScopes,
} from "@/app/actions/api-clients";
import { API_SCOPES, type ApiScope } from "@/lib/api/v1/scopes";
import { useToast } from "@/components/feedback/ToastProvider";

type Credential = {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

type Client = {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  scopes: ApiScope[];
  credentials: Credential[];
};

function expiryIso(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return raw ? new Date(raw).toISOString() : null;
}

function formatTimestamp(value: string) {
  return new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function SecretDialog(props: { token: string | null; onClose: () => void }) {
  const { showToast } = useToast();
  return (
    <Dialog open={Boolean(props.token)} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>Copy this credential now</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            Yuyu cannot show this value again. Store it in the consuming application&apos;s secret manager.
          </Alert>
          <Box component="code" sx={{ p: 2, borderRadius: 2, bgcolor: "rgba(255,255,255,0.06)", overflowWrap: "anywhere", userSelect: "all" }}>
            {props.token}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={async () => {
            if (!props.token) return;
            await navigator.clipboard.writeText(props.token);
            showToast("Credential copied", "success");
          }}
        >
          Copy
        </Button>
        <Button variant="contained" onClick={props.onClose}>I have stored it</Button>
      </DialogActions>
    </Dialog>
  );
}

function ClientPanel(props: { organisationSlug: string; client: Client; referenceTime: string; reveal: (token: string) => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selectedScopes, setSelectedScopes] = useState<ApiScope[]>(props.client.scopes);

  function run(operation: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>) {
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) return showToast(result.error ?? "The change failed.", "error");
      if (result.data && typeof result.data === "object" && "token" in result.data && typeof result.data.token === "string") {
        props.reveal(result.data.token);
      }
      showToast("API access updated", "success");
      router.refresh();
    });
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)" }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{props.client.name}</Typography>
            <Chip size="small" color={props.client.status === "ACTIVE" ? "success" : "default"} label={props.client.status.toLowerCase()} />
          </Box>
          <Button
            color={props.client.status === "ACTIVE" ? "warning" : "success"}
            disabled={pending}
            onClick={() => run(() => setApiClientStatus({ organisationSlug: props.organisationSlug, apiClientId: props.client.id, status: props.client.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }))}
          >
            {props.client.status === "ACTIVE" ? "Disable client" : "Enable client"}
          </Button>
        </Stack>
        <Divider />
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Scopes</Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap" }}>
            {API_SCOPES.map((scope) => (
              <FormControlLabel
                key={scope}
                control={<Checkbox checked={selectedScopes.includes(scope)} onChange={(_, checked) => setSelectedScopes((current) => checked ? [...current, scope] : current.filter((item) => item !== scope))} />}
                label={scope}
              />
            ))}
          </Stack>
          <Button
            size="small"
            disabled={pending || selectedScopes.length === 0}
            onClick={() => run(() => updateApiClientScopes({ organisationSlug: props.organisationSlug, apiClientId: props.client.id, scopes: selectedScopes }))}
          >
            Save scopes
          </Button>
        </Box>
        <Divider />
        <Box component="form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(() => createApiCredential({ organisationSlug: props.organisationSlug, apiClientId: props.client.id, name: String(form.get("name") ?? ""), expiresAt: expiryIso(form.get("expiresAt")) }));
        }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Create rotation credential</Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
            <TextField name="name" label="Credential label" size="small" required slotProps={{ htmlInput: { maxLength: 80 } }} />
            <TextField name="expiresAt" label="Optional expiry" type="datetime-local" size="small" slotProps={{ inputLabel: { shrink: true } }} />
            <Button type="submit" variant="outlined" disabled={pending}>Create credential</Button>
          </Stack>
        </Box>
        <Stack spacing={1}>
          {props.client.credentials.length === 0 ? <Typography variant="body2" color="text.secondary">No credentials.</Typography> : props.client.credentials.map((credential) => {
            const inactive = Boolean(credential.revokedAt) || Boolean(credential.expiresAt && credential.expiresAt <= props.referenceTime);
            return (
              <Stack key={credential.id} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, p: 1.25, borderRadius: 2, bgcolor: "rgba(255,255,255,0.025)" }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>{credential.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Created {formatTimestamp(credential.createdAt)} · Last used {credential.lastUsedAt ? formatTimestamp(credential.lastUsedAt) : "never"}
                    {credential.expiresAt ? ` · Expires ${formatTimestamp(credential.expiresAt)}` : ""}
                  </Typography>
                </Box>
                {inactive ? <Chip size="small" label={credential.revokedAt ? "revoked" : "expired"} /> : (
                  <Button color="error" size="small" disabled={pending} onClick={() => run(() => revokeApiCredential({ organisationSlug: props.organisationSlug, apiClientId: props.client.id, credentialId: credential.id }))}>Revoke</Button>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
}

export function ApiClientManagement(props: { organisationSlug: string; clients: Client[]; referenceTime: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [scopes, setScopes] = useState<ApiScope[]>(["events:read"]);
  const [token, setToken] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      <SecretDialog token={token} onClose={() => setToken(null)} />
      <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)" }} onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createApiClient({ organisationSlug: props.organisationSlug, name: String(form.get("name") ?? ""), credentialName: String(form.get("credentialName") ?? ""), expiresAt: expiryIso(form.get("expiresAt")), scopes });
          if (!result.ok) return showToast(result.error, "error");
          setToken(result.data?.token ?? null);
          showToast("API client created", "success");
          router.refresh();
        });
      }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Create API client</Typography>
            <Typography variant="body2" color="text.secondary">The first credential is shown once after creation.</Typography>
          </Box>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
            <TextField name="name" label="Application name" required fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} />
            <TextField name="credentialName" label="Credential label" required fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
            <TextField name="expiresAt" label="Optional expiry" type="datetime-local" fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap" }}>
            {API_SCOPES.map((scope) => <FormControlLabel key={scope} control={<Checkbox checked={scopes.includes(scope)} onChange={(_, checked) => setScopes((current) => checked ? [...current, scope] : current.filter((item) => item !== scope))} />} label={scope} />)}
          </Stack>
          <Button type="submit" variant="contained" disabled={pending || scopes.length === 0} sx={{ alignSelf: "flex-start" }}>Create client</Button>
        </Stack>
      </Paper>
      <Stack spacing={2}>
        {props.clients.length === 0 ? <Alert severity="info">No machine clients have been created.</Alert> : props.clients.map((client) => <ClientPanel key={client.id} organisationSlug={props.organisationSlug} client={client} referenceTime={props.referenceTime} reveal={setToken} />)}
      </Stack>
    </Stack>
  );
}
