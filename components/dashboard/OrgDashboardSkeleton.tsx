import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

export function OrgDashboardSkeleton() {
  return (
    <Stack spacing={3}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Skeleton width="60%" height={28} />
            <Skeleton width="40%" height={40} sx={{ mt: 1 }} />
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Skeleton width="60%" height={28} />
            <Skeleton width="40%" height={40} sx={{ mt: 1 }} />
          </Paper>
        </Grid>
      </Grid>
      <Grid container spacing={2}>
        {[1, 2, 3].map((i) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
            <Skeleton variant="rounded" height={200} />
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
