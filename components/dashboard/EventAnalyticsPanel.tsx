"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Chip from "@mui/material/Chip";
import type { Theme } from "@mui/material/styles";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import HourglassTopOutlinedIcon from "@mui/icons-material/HourglassTopOutlined";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import PlaylistAddOutlinedIcon from "@mui/icons-material/PlaylistAddOutlined";
import QrCode2OutlinedIcon from "@mui/icons-material/QrCode2Outlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";

type Analytics = {
  total: number;
  confirmed: number;
  waitlisted: number;
  pendingApproval: number;
  rejected: number;
  checkedIn: number;
};

function pct(num: number, den: number) {
  if (!den || den <= 0) return 0;
  return Math.max(0, Math.min(100, (num / den) * 100));
}

function fmtPct(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function metricCardBg(theme: Theme, tint: "mint" | "lavender") {
  const a = tint === "mint" ? "124,245,182" : "185,174,255";
  const b = tint === "mint" ? "185,174,255" : "124,245,182";
  const base =
    theme.palette.mode === "dark"
      ? "rgba(255,255,255,0.02)"
      : "rgba(255,255,255,0.55)";
  return `linear-gradient(145deg, ${base}, rgba(${a},0.10), rgba(${b},0.06))`;
}

function DonutChart(props: {
  size?: number;
  thickness?: number;
  parts: { label: string; value: number; color: string }[];
}) {
  const { size = 160, thickness = 16, parts } = props;
  const total = parts.reduce((acc, p) => acc + Math.max(0, p.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const center = size / 2;

  return (
    <Box sx={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={thickness}
        />
        {total > 0
          ? parts.map((p) => {
              const v = Math.max(0, p.value);
              const seg = (v / total) * c;
              const dash = `${seg} ${c - seg}`;
              const el = (
                <circle
                  key={p.label}
                  cx={center}
                  cy={center}
                  r={r}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${center} ${center})`}
                />
              );
              offset += seg + 2; // tiny gap
              return el;
            })
          : null}
      </svg>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          pointerEvents: "none",
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1 }}>
          {total}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          responses
        </Typography>
      </Box>
    </Box>
  );
}

function SparkBars(props: {
  values: { label: string; value: number; color: string }[];
  max?: number;
}) {
  const { values, max } = props;
  const m =
    max ??
    values.reduce((acc, v) => Math.max(acc, Math.max(0, v.value)), 0) ??
    0;

  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "flex-end" }}>
      {values.map((v) => {
        const h = m > 0 ? Math.max(6, Math.round((Math.max(0, v.value) / m) * 46)) : 6;
        return (
          <Box
            key={v.label}
            title={`${v.label}: ${v.value}`}
            sx={{
              width: 10,
              height: h,
              borderRadius: 999,
              background: v.color,
              opacity: v.value > 0 ? 0.95 : 0.35,
              boxShadow: v.value > 0 ? "0 8px 20px rgba(0,0,0,0.18)" : "none",
            }}
          />
        );
      })}
    </Stack>
  );
}

export function EventAnalyticsPanel(props: { analytics: Analytics }) {
  const { analytics } = props;

  const nonConfirmed =
    analytics.total -
    analytics.confirmed -
    analytics.waitlisted -
    analytics.pendingApproval -
    analytics.rejected;
  const other = Math.max(0, nonConfirmed);

  const checkInRate = pct(analytics.checkedIn, analytics.confirmed);
  const confirmRate = pct(analytics.confirmed, analytics.total);
  const waitlistRate = pct(analytics.waitlisted, analytics.total);
  const pendingRate = pct(analytics.pendingApproval, analytics.total);

  return (
    <Stack spacing={2.5}>
      <Paper
        variant="outlined"
        sx={(theme) => ({
          p: 2.5,
          background: metricCardBg(theme, "mint"),
          overflow: "hidden",
          position: "relative",
        })}
      >
        <Box
          sx={{
            position: "absolute",
            inset: -80,
            background:
              "radial-gradient(circle at 20% 20%, rgba(124,245,182,0.18), transparent 55%), radial-gradient(circle at 80% 40%, rgba(185,174,255,0.16), transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <Stack spacing={2} sx={{ position: "relative" }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <InsightsOutlinedIcon color="primary" />
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Analytics
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  Live snapshot of RSVPs and check-ins.
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Chip
                size="small"
                variant="outlined"
                icon={<PeopleAltOutlinedIcon />}
                label={`${analytics.total} responses`}
              />
              <Chip
                size="small"
                variant="outlined"
                icon={<QrCode2OutlinedIcon />}
                label={
                  analytics.confirmed > 0
                    ? `${fmtPct(checkInRate)} check-in rate`
                    : "— check-in rate"
                }
              />
            </Stack>
          </Stack>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  height: "100%",
                  backgroundColor: "rgba(255,255,255,0.02)",
                }}
              >
                <Typography variant="subtitle2" color="text.secondary">
                  RSVP pipeline
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Confirmed, waiting, pending, and rejected at a glance.
                </Typography>
                <Divider sx={{ my: 1.5 }} />

                <Stack spacing={1.25}>
                  <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="body2">Confirmed</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {analytics.confirmed}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={pct(analytics.confirmed, analytics.total)}
                    sx={{
                      height: 10,
                      borderRadius: 999,
                      "& .MuiLinearProgress-bar": { borderRadius: 999 },
                    }}
                    color="success"
                  />

                  <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="body2">Pending approval</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {analytics.pendingApproval}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={pct(analytics.pendingApproval, analytics.total)}
                    sx={{
                      height: 10,
                      borderRadius: 999,
                      "& .MuiLinearProgress-bar": { borderRadius: 999 },
                    }}
                    color="warning"
                  />

                  <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="body2">Waitlisted</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {analytics.waitlisted}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={pct(analytics.waitlisted, analytics.total)}
                    sx={{
                      height: 10,
                      borderRadius: 999,
                      "& .MuiLinearProgress-bar": { borderRadius: 999 },
                    }}
                    color="info"
                  />

                  <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="body2">Rejected</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {analytics.rejected}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={pct(analytics.rejected, analytics.total)}
                    sx={{
                      height: 10,
                      borderRadius: 999,
                      "& .MuiLinearProgress-bar": { borderRadius: 999 },
                    }}
                    color="error"
                  />
                </Stack>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  height: "100%",
                  backgroundColor: "rgba(255,255,255,0.02)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 2,
                }}
              >
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Distribution
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    Breakdown of responses by status.
                  </Typography>
                </Box>

                <Stack
                  direction={{ xs: "column", sm: "row", md: "column" }}
                  spacing={2}
                  sx={{ alignItems: "center", justifyContent: "center" }}
                >
                  <DonutChart
                    parts={[
                      { label: "Confirmed", value: analytics.confirmed, color: "#7CF5B6" },
                      { label: "Pending", value: analytics.pendingApproval, color: "#FFB74D" },
                      { label: "Waitlisted", value: analytics.waitlisted, color: "#8AB4F8" },
                      { label: "Rejected", value: analytics.rejected, color: "#FF6B6B" },
                      { label: "Other", value: other, color: "rgba(255,255,255,0.28)" },
                    ]}
                  />
                  <Stack spacing={1} sx={{ width: "100%" }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                      <Typography variant="caption" color="text.secondary">
                        Quick view
                      </Typography>
                      <SparkBars
                        values={[
                          { label: "Confirmed", value: analytics.confirmed, color: "#7CF5B6" },
                          { label: "Pending", value: analytics.pendingApproval, color: "#FFB74D" },
                          { label: "Waitlisted", value: analytics.waitlisted, color: "#8AB4F8" },
                          { label: "Rejected", value: analytics.rejected, color: "#FF6B6B" },
                        ]}
                      />
                    </Stack>
                    <Divider />
                    <Stack spacing={0.75}>
                      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <CheckCircleOutlineOutlinedIcon sx={{ fontSize: 18, color: "#7CF5B6" }} />
                          <Typography variant="body2">Confirmed</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {analytics.total > 0 ? fmtPct(confirmRate) : "—"}
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <HourglassTopOutlinedIcon sx={{ fontSize: 18, color: "#FFB74D" }} />
                          <Typography variant="body2">Pending</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {analytics.total > 0 ? fmtPct(pendingRate) : "—"}
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <PlaylistAddOutlinedIcon sx={{ fontSize: 18, color: "#8AB4F8" }} />
                          <Typography variant="body2">Waitlisted</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {analytics.total > 0 ? fmtPct(waitlistRate) : "—"}
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <CancelOutlinedIcon sx={{ fontSize: 18, color: "#FF6B6B" }} />
                          <Typography variant="body2">Rejected</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {analytics.rejected}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </Stack>
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper
            variant="outlined"
            sx={(theme) => ({
              p: 2,
              height: "100%",
              background: metricCardBg(theme, "mint"),
            })}
          >
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Total responses
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                {analytics.total}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                RSVP submissions so far
              </Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper
            variant="outlined"
            sx={(theme) => ({
              p: 2,
              height: "100%",
              background: metricCardBg(theme, "lavender"),
            })}
          >
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Confirmed
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                {analytics.confirmed}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {analytics.total > 0 ? `${fmtPct(confirmRate)} of responses` : "—"}
              </Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Checked in
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                {analytics.checkedIn}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {analytics.confirmed > 0 ? `${fmtPct(checkInRate)} of confirmed` : "—"}
              </Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Needs action
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                {analytics.pendingApproval}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Pending approvals
              </Typography>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}

