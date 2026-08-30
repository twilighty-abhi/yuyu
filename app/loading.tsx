import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

export default function RootLoading() {
  return (
    <Stack spacing={3} sx={{ py: { xs: 3, sm: 5 } }} aria-label="Loading page">
      <Box>
        <Skeleton variant="text" width="min(65%, 420px)" height={54} />
        <Skeleton variant="text" width="min(85%, 620px)" />
      </Box>
      <Skeleton variant="rounded" height={120} />
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        {[0, 1, 2].map((item) => <Skeleton key={item} variant="rounded" height={180} sx={{ flex: 1 }} />)}
      </Stack>
    </Stack>
  );
}
