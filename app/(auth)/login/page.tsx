import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import { LoginForm } from "./ui";

export default function LoginPage() {
  return (
    <Stack spacing={3} sx={{ maxWidth: 420, mx: "auto", py: 4 }}>
      <Typography variant="h4" component="h1">
        Sign in
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Use Google or email — email sends a magic link (stub logs to the server
        console in development).
      </Typography>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <LoginForm />
      </Paper>
    </Stack>
  );
}
