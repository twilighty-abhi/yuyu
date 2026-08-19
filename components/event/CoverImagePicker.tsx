"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import RotateRightOutlinedIcon from "@mui/icons-material/RotateRightOutlined";

const MAX_COVER_IMAGE_BYTES = 5 * 1024 * 1024;
const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 900;

export function CoverImagePicker(props: {
  initialUrl?: string | null;
  disabled?: boolean;
  onChange: (file: File | null, previewUrl: string) => void;
}) {
  const { initialUrl = "", disabled = false, onChange } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState(initialUrl ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !imageLoaded) return;

    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#111";
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    const radians = (rotation * Math.PI) / 180;
    const baseScale = Math.max(OUTPUT_WIDTH / image.naturalWidth, OUTPUT_HEIGHT / image.naturalHeight);
    const scale = baseScale * zoom;
    context.save();
    context.translate(OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2);
    context.rotate(radians);
    context.drawImage(
      image,
      (-image.naturalWidth * scale) / 2,
      (-image.naturalHeight * scale) / 2,
      image.naturalWidth * scale,
      image.naturalHeight * scale,
    );
    context.restore();
  }, [imageLoaded, rotation, zoom]);

  function selectImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_COVER_IMAGE_BYTES) {
      setError("Choose an image that is 5 MB or smaller.");
      return;
    }
    setSourceUrl(URL.createObjectURL(file));
    setImageLoaded(false);
    setZoom(1);
    setRotation(0);
    setEditorOpen(true);
  }

  function applyEdit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Could not process that image.");
          return;
        }
        if (blob.size > MAX_COVER_IMAGE_BYTES) {
          setError("The processed image is too large. Try a smaller source image.");
          return;
        }
        const file = new File([blob], "event-cover.webp", { type: "image/webp" });
        const nextPreviewUrl = URL.createObjectURL(file);
        setPreviewUrl(nextPreviewUrl);
        onChange(file, nextPreviewUrl);
        setEditorOpen(false);
      },
      "image/webp",
      0.88,
    );
  }

  return (
    <Stack spacing={1.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          aspectRatio: "16 / 9",
          borderRadius: "14px",
          border: "1px dashed rgba(255,255,255,0.18)",
          backgroundColor: "rgba(255,255,255,0.025)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {previewUrl ? (
          <Box component="img" src={previewUrl} alt="Cover image preview" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Stack spacing={0.75} sx={{ alignItems: "center", px: 2, textAlign: "center" }}>
            <ImageOutlinedIcon sx={{ color: "text.secondary", fontSize: 30 }} />
            <Typography variant="body2" color="text.secondary">Your event cover will appear here.</Typography>
          </Stack>
        )}
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button variant="outlined" size="small" disabled={disabled} onClick={() => inputRef.current?.click()} sx={{ textTransform: "none" }}>
          {previewUrl ? "Replace image" : "Choose image"}
        </Button>
        {previewUrl ? (
          <Button size="small" color="inherit" disabled={disabled} onClick={() => { setPreviewUrl(""); onChange(null, ""); }} sx={{ textTransform: "none" }}>
            Remove
          </Button>
        ) : null}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        JPEG, PNG, or WebP · up to 5 MB · cropped to a 16:9 cover.
      </Typography>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => selectImage(event.target.files?.[0])} />

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 700 }}>Edit cover image</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Box sx={{ overflow: "hidden", borderRadius: 2, backgroundColor: "#111", aspectRatio: "16 / 9" }}>
              <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
            </Box>
            {/* A native image element is required as the canvas source for client-side cropping. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imageRef} src={sourceUrl} alt="" hidden onLoad={() => setImageLoaded(true)} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">Zoom</Typography>
                <Slider value={zoom} min={1} max={3} step={0.05} onChange={(_, value) => setZoom(value as number)} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">Rotation</Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <RotateRightOutlinedIcon fontSize="small" color="action" />
                  <Slider value={rotation} min={-180} max={180} step={1} onChange={(_, value) => setRotation(value as number)} />
                </Stack>
              </Box>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setEditorOpen(false)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button variant="contained" onClick={applyEdit} disabled={!imageLoaded} sx={{ textTransform: "none" }}>Use cover image</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
