"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export function Histogram(props: {
  title: string;
  buckets: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(1, ...props.buckets.map((b) => b.count));
  return (
    <Box
      sx={{
        p: 2.25,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {props.title}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5, height: 56 }}>
        {props.buckets.map((b) => (
          <Box
            key={b.label}
            title={`${b.label}: ${b.count}`}
            sx={{
              width: 14,
              height: `${Math.max(4, Math.round((b.count / max) * 56))}px`,
              borderRadius: 1,
              bgcolor: "primary.main",
              opacity: 0.18 + 0.72 * (b.count / max),
            }}
          />
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1 }}>
        {props.buckets.map((b) => (
          <Typography key={b.label} variant="caption" color="text.secondary">
            {b.label}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

