"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import { createOrganisation, checkSlugAvailability } from "@/app/actions/org";

export function CreateOrgForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [slug, setSlug] = useState("");
  const [slugState, setSlugState] = useState<"idle" | "checking" | "available" | "taken">("idle");

  useEffect(() => {
    const trimmed = slug.trim();
    if (!trimmed) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const available = await checkSlugAvailability(trimmed);
        setSlugState(available ? "available" : "taken");
      } catch (err) {
        if (process.env.NODE_ENV === "development") console.error("Failed to check slug availability", err);
        setSlugState("idle");
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [slug]);

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    setSlug(val);
    setSlugState(val.trim() ? "checking" : "idle");
  };

  let helperText = "Lowercase, alphanumeric and dashes, e.g. my-community";
  let isError = false;
  let isSuccess = false;

  if (slugState === "checking") {
    helperText = "Checking availability...";
  } else if (slugState === "available") {
    helperText = "✨ URL slug is available!";
    isSuccess = true;
  } else if (slugState === "taken") {
    helperText = "❌ This URL slug is already taken or reserved.";
    isError = true;
  }

  const isSubmitDisabled = pending || slugState === "checking" || slugState === "taken" || !slug;

  return (
    <Stack
      component="form"
      spacing={2.5}
      sx={{ width: "100%" }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await createOrganisation({
            name: String(fd.get("name") ?? ""),
            slug: slug,
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
      <TextField name="name" label="Organisation name" required fullWidth autoFocus />
      <TextField
        name="slug"
        label="URL slug"
        required
        fullWidth
        value={slug}
        onChange={handleSlugChange}
        error={isError}
        helperText={helperText}
        slotProps={{
          formHelperText: {
            sx: {
              color: isSuccess ? "#7CF5B6" : isError ? "error.main" : "text.secondary",
              fontWeight: isSuccess || isError ? 500 : 400,
            }
          }
        }}
      />
      <TextField
        name="description"
        label="Description"
        fullWidth
        multiline
        minRows={3}
      />
      <TextField name="logoUrl" label="Logo URL (optional)" fullWidth />
      <Button
        type="submit"
        variant="contained"
        disabled={isSubmitDisabled}
        size="large"
        sx={{ textTransform: "none", borderRadius: 2, py: 1.25 }}
      >
        Create organisation
      </Button>
    </Stack>
  );
}
