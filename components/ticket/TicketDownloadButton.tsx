"use client";

import { useRef, useState } from "react";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import QRCode from "react-qr-code";

type TicketDownloadButtonProps = {
  attendeeName: string;
  eventTitle: string;
  organisationName: string;
  when: string;
  location?: string;
  ticketUrl: string;
};

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "event";
}

export function TicketDownloadButton(props: TicketDownloadButtonProps) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadTicket() {
    const svg = qrRef.current?.querySelector("svg");
    if (!svg || downloading) return;

    setError(null);
    setDownloading(true);
    try {
      const serialized = new XMLSerializer().serializeToString(svg);
      const qrImage = new Image();
      const qrDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
      await new Promise<void>((resolve, reject) => {
        qrImage.onload = () => resolve();
        qrImage.onerror = () => reject(new Error("Could not render ticket QR code."));
        qrImage.src = qrDataUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1600;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser does not support ticket downloads.");

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#6750a4";
      context.fillRect(0, 0, canvas.width, 240);
      context.fillStyle = "#ffffff";
      context.font = "600 42px system-ui, sans-serif";
      context.fillText(props.organisationName, 80, 98);
      context.font = "700 76px system-ui, sans-serif";
      context.fillText("EVENT TICKET", 80, 185);

      let y = 340;
      context.fillStyle = "#1d1b20";
      context.font = "700 62px system-ui, sans-serif";
      for (const line of wrapText(context, props.eventTitle, 1040)) {
        context.fillText(line, 80, y);
        y += 76;
      }

      y += 35;
      context.fillStyle = "#49454f";
      context.font = "500 34px system-ui, sans-serif";
      context.fillText("ATTENDEE", 80, y);
      y += 56;
      context.fillStyle = "#1d1b20";
      context.font = "600 48px system-ui, sans-serif";
      for (const line of wrapText(context, props.attendeeName, 1040)) {
        context.fillText(line, 80, y);
        y += 58;
      }

      y += 35;
      context.fillStyle = "#49454f";
      context.font = "500 34px system-ui, sans-serif";
      context.fillText("WHEN", 80, y);
      y += 56;
      context.fillStyle = "#1d1b20";
      context.font = "500 40px system-ui, sans-serif";
      for (const line of wrapText(context, props.when, 1040)) {
        context.fillText(line, 80, y);
        y += 52;
      }

      if (props.location) {
        y += 28;
        context.fillStyle = "#49454f";
        context.font = "500 34px system-ui, sans-serif";
        context.fillText("WHERE", 80, y);
        y += 56;
        context.fillStyle = "#1d1b20";
        context.font = "500 40px system-ui, sans-serif";
        for (const line of wrapText(context, props.location, 1040)) {
          context.fillText(line, 80, y);
          y += 52;
        }
      }

      const qrSize = 520;
      const qrX = (canvas.width - qrSize) / 2;
      const qrY = Math.max(y + 80, 990);
      context.fillStyle = "#ffffff";
      context.fillRect(qrX - 30, qrY - 30, qrSize + 60, qrSize + 60);
      context.strokeStyle = "#cac4d0";
      context.lineWidth = 3;
      context.strokeRect(qrX - 30, qrY - 30, qrSize + 60, qrSize + 60);
      context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
      context.fillStyle = "#49454f";
      context.font = "500 30px system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText("Present this QR code at check-in", canvas.width / 2, qrY + qrSize + 85);
      context.textAlign = "left";

      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create ticket image.")), "image/png");
      });
      const objectUrl = URL.createObjectURL(png);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${safeFilename(props.eventTitle)}-ticket.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download this ticket.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div ref={qrRef} aria-hidden="true" style={{ display: "none" }}>
        <QRCode value={props.ticketUrl} size={240} bgColor="#FFFFFF" fgColor="#111111" level="M" />
      </div>
      <Button
        variant="contained"
        startIcon={<DownloadRoundedIcon />}
        onClick={downloadTicket}
        disabled={downloading}
        sx={{ borderRadius: 999, alignSelf: "flex-start" }}
      >
        {downloading ? "Preparing ticket…" : "Download ticket"}
      </Button>
      {error ? <Alert severity="error">{error}</Alert> : null}
    </>
  );
}
