import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 112, background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)", color: "#061814", fontSize: 280, fontWeight: 900, fontFamily: "Arial, sans-serif" }}>Y</div>,
    size,
  );
}
