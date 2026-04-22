"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export type SparkPoint = { xLabel: string; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function buildPath(values: number[], w: number, h: number, pad: number) {
  if (values.length === 0) return "";
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(1, maxV - minV);

  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  return values
    .map((v, i) => {
      const t = values.length === 1 ? 0 : i / (values.length - 1);
      const x = pad + t * innerW;
      const y = pad + (1 - (v - minV) / span) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function SparklineCard(props: {
  title: string;
  subtitle?: string;
  points: SparkPoint[];
}) {
  const w = 240;
  const h = 56;
  const pad = 6;
  const values = props.points.map((p) => p.y);
  const path = buildPath(values, w, h, pad);
  const latest = values.at(-1) ?? 0;
  const prev = values.length >= 2 ? values.at(-2) ?? 0 : null;
  const delta = prev == null ? null : latest - prev;

  return (
    <Box
      sx={{
        p: 2.25,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {props.title}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          {latest.toLocaleString()}
        </Typography>
        {delta != null ? (
          <Typography
            variant="caption"
            sx={{
              color:
                delta === 0
                  ? "text.secondary"
                  : delta > 0
                    ? "success.main"
                    : "warning.main",
              fontWeight: 650,
            }}
          >
            {delta > 0 ? "+" : ""}
            {delta.toLocaleString()}
          </Typography>
        ) : null}
      </Box>

      {props.subtitle ? (
        <Typography variant="caption" color="text.secondary">
          {props.subtitle}
        </Typography>
      ) : null}

      <Box sx={{ mt: 1 }}>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={props.title}>
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            opacity={0.9}
          />
          <circle
            cx={clamp(w - pad, pad, w - pad)}
            cy={clamp(h / 2, pad, h - pad)}
            r="0"
          />
        </svg>
      </Box>
    </Box>
  );
}

