import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { VerifyEmailForm } from "@/components/account/VerifyEmailForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Verify email", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const safeToken = typeof token === "string" ? token : "";
  return (
    <Box sx={{ maxWidth: 520, mx: "auto", py: { xs: 4, sm: 8 } }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h4" component="h1">Verify your email</Typography>
          {safeToken ? (
            <VerifyEmailForm token={safeToken} />
          ) : (
            <Typography color="error">This verification link is invalid or has expired.</Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
