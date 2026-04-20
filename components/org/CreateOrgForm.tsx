"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import { createOrganisation } from "@/app/actions/org";

export function CreateOrgForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Stack
      component="form"
      spacing={2}
      sx={{ maxWidth: 480 }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await createOrganisation({
            name: String(fd.get("name") ?? ""),
            slug: String(fd.get("slug") ?? ""),
            description: String(fd.get("description") ?? ""),
            logoUrl: String(fd.get("logoUrl") ?? ""),
          });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          if (res.data?.slug) router.push(`/${res.data.slug}`);
        });
      }}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField name="name" label="Organisation name" required fullWidth />
      <TextField
        name="slug"
        label="URL slug"
        required
        fullWidth
        helperText="Lowercase, e.g. my-community"
      />
      <TextField
        name="description"
        label="Description"
        fullWidth
        multiline
        minRows={3}
      />
      <TextField name="logoUrl" label="Logo URL (optional)" fullWidth />
      <Button type="submit" variant="contained" disabled={pending} size="large">
        Create organisation
      </Button>
    </Stack>
  );
}
