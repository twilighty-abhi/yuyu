"use client";

import { useEffect } from "react";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error("[ui] route error", error);
    else console.error("[ui] route error");
  }, [error]);
  return (
    <Stack spacing={2} sx={{ py: 8, textAlign: "center", alignItems: "center" }}>
      <Typography component="h1" variant="h4">Something went wrong</Typography>
      <Typography color="text.secondary">Please try again. If this keeps happening, contact the operator of this Yuyu instance.</Typography>
      <Button variant="contained" onClick={reset}>Try again</Button>
    </Stack>
  );
}
