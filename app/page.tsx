import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Link from "next/link";
import Paper from "@mui/material/Paper";

export default function HomePage() {
  return (
    <Stack spacing={4} sx={{ py: 4 }}>
      <Stack spacing={2} sx={{ maxWidth: 640 }}>
        <Typography variant="overline" color="primary">
          Phase 1 MVP
        </Typography>
        <Typography variant="h3" component="h1">
          Host events people actually show up to
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Create an organisation, publish events, share a link, and collect
          RSVPs — with Google or email sign-in and a clean, responsive UI.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Button
            component={Link}
            href="/login"
            variant="contained"
            size="large"
          >
            Get started
          </Button>
          <Button component={Link} href="/dashboard" variant="outlined" size="large">
            Dashboard
          </Button>
        </Stack>
      </Stack>
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 560 }}>
        <Typography variant="subtitle2" gutterBottom>
          Local development
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Run <code>docker compose up -d</code>, copy <code>.env.example</code>{" "}
          to <code>.env</code>, then <code>npx prisma migrate dev</code> and{" "}
          <code>npm run dev</code>.
        </Typography>
      </Paper>
    </Stack>
  );
}
