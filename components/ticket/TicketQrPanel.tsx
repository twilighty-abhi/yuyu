"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import QRCode from "react-qr-code";

export function TicketQrPanel(props: { token: string }) {
  const { token } = props;
  return (
    <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Show this QR at check-in
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <Box
          sx={{
            p: 2,
            bgcolor: "#fff",
            borderRadius: 2,
            boxShadow: 1,
            width: { xs: 260, sm: 300 },
            maxWidth: "100%",
          }}
        >
          <QRCode
            value={token}
            size={240}
            bgColor="#FFFFFF"
            fgColor="#111111"
            level="M"
            style={{ height: "auto", maxWidth: "100%", width: "100%" }}
          />
        </Box>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 1 }}
      >
        Staff can scan this code or paste your ticket link. The code is unique
        to your registration.
      </Typography>
    </Paper>
  );
}
