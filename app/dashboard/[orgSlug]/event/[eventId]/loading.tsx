import Stack from "@mui/material/Stack";
import Skeleton from "@mui/material/Skeleton";
import Paper from "@mui/material/Paper";

export default function Loading() {
  return (
    <Stack spacing={3}>
      <Skeleton variant="text" width="40%" height={40} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Skeleton variant="rounded" height={320} />
      </Paper>
      <Skeleton variant="text" width="30%" height={32} />
      <Skeleton variant="rounded" height={200} />
    </Stack>
  );
}
