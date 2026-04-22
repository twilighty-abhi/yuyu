"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { updateOrganisation } from "@/app/actions/org";
import { useToast } from "@/components/feedback/ToastProvider";

export function EditOrgForm(props: {
  organisationSlug: string;
  initial: { name: string; description: string; logoUrl: string | null };
}) {
  const { organisationSlug, initial } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(initial.logoUrl ?? "");

  return (
    <Stack
      component="form"
      spacing={2.5}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await updateOrganisation({
            organisationSlug,
            name: String(fd.get("name") ?? ""),
            description: String(fd.get("description") ?? ""),
            logoUrl: String(fd.get("logoUrl") ?? ""),
          });
          if (!res.ok) {
            setError(res.error);
            showToast(res.error, "error");
            return;
          }
          showToast("Organisation saved", "success");
          router.refresh();
        });
      }}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <SettingsOutlinedIcon color="primary" />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Organisation settings
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Update how your organisation appears on public pages.
              </Typography>
            </Box>
          </Stack>
          <Divider />
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField
                name="name"
                label="Organisation name"
                required
                fullWidth
                defaultValue={initial.name}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                name="description"
                label="Description"
                fullWidth
                multiline
                minRows={4}
                defaultValue={initial.description}
                helperText="Shown on your organisation page."
              />
            </Grid>
          </Grid>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <ImageOutlinedIcon sx={{ color: "text.secondary" }} />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Logo
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Add a logo for a more recognizable presence.
              </Typography>
            </Box>
          </Stack>
          <Divider />
          <Grid container spacing={2} sx={{ alignItems: "stretch" }}>
            <Grid size={{ xs: 12, md: 7 }}>
              <TextField
                name="logoUrl"
                label="Logo URL (optional)"
                fullWidth
                type="url"
                defaultValue={initial.logoUrl ?? ""}
                onChange={(e) => setLogoPreviewUrl(e.target.value)}
                helperText="Use a direct image URL (square works best)."
              />
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Box
                sx={{
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                  overflow: "hidden",
                  height: { xs: 160, md: "100%" },
                  minHeight: { md: 120 },
                  background:
                    "linear-gradient(145deg, rgba(124,245,182,0.08), rgba(185,174,255,0.08))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 2,
                }}
              >
                {logoPreviewUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="Logo preview"
                    src={logoPreviewUrl}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                      borderRadius: 12,
                    }}
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Preview will show here.
                  </Typography>
                )}
              </Box>
            </Grid>
          </Grid>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button type="submit" variant="contained" disabled={pending}>
          Save changes
        </Button>
      </Stack>
    </Stack>
  );
}

