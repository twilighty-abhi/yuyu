"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

type Html5QrcodeLike = {
  start: (
    camera: { facingMode: string } | string,
    // html5-qrcode supports more options; keep this permissive for runtime compatibility.
    config: Record<string, unknown>,
    onSuccess: (text: string) => void,
    onError: (error: unknown) => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
};

export function CheckInQrScanner(props: {
  onScan: (text: string) => void;
  disabled?: boolean;
}) {
  const { onScan, disabled } = props;
  const reactId = useId();
  const regionId = `checkin-qr-${reactId.replace(/:/g, "")}`;
  const scannerRef = useRef<Html5QrcodeLike | null>(null);
  const onScanRef = useRef(onScan);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stop = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        await s.stop();
      } catch {
        /* ignore */
      }
    }
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      await stop();
      const scanner = new Html5Qrcode(regionId) as unknown as Html5QrcodeLike;
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 12,
          // Responsive box improves decode success on small/large screens.
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const size = Math.floor(
              Math.min(viewfinderWidth, viewfinderHeight) * 0.62,
            );
            return { width: size, height: size };
          },
          aspectRatio: 1,
          disableFlip: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        },
        (decoded) => {
          const now = Date.now();
          if (
            decoded === lastRef.current.text &&
            now - lastRef.current.at < 1800
          ) {
            return;
          }
          lastRef.current = { text: decoded, at: now };
          onScanRef.current(decoded);
        },
        () => {},
      );
      setRunning(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start the camera. Try manual code entry.",
      );
      scannerRef.current = null;
      setRunning(false);
    }
  }, [regionId, stop]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return (
    <Stack spacing={1}>
      <Box
        id={regionId}
        sx={{
          width: "100%",
          minHeight: 260,
          borderRadius: 1,
          overflow: "hidden",
          bgcolor: "action.hover",
        }}
      />
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap" }}
      >
        {!running ? (
          <Button
            variant="contained"
            onClick={() => void start()}
            disabled={disabled}
          >
            Start camera
          </Button>
        ) : (
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => void stop()}
            disabled={disabled}
          >
            Stop camera
          </Button>
        )}
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
    </Stack>
  );
}
