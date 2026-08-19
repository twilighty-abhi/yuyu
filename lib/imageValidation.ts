import "server-only";

const MAX_IMAGE_PIXELS = 25_000_000;

export type SafeImage = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number | null;
  height: number | null;
};

function readU32BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset]! * 2 ** 24) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

function readU16BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset]! << 8) + bytes[offset + 1]!;
}

function dimensionsAreSafe(width: number | null, height: number | null) {
  return width !== null && height !== null && width > 0 && height > 0 && width * height <= MAX_IMAGE_PIXELS;
}

function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24) return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  return { width, height };
}

function jpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1]!;
    offset += 2;
    while (marker === 0xff && offset < bytes.length) marker = bytes[offset++]!;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = readU16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: readU16BE(bytes, offset + 3), width: readU16BE(bytes, offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30) return null;
  const type = String.fromCharCode(...bytes.slice(12, 16));
  if (type === "VP8X") {
    return {
      width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
      height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
    };
  }
  if (type === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: readU16BE(bytes, 26) & 0x3fff, height: readU16BE(bytes, 28) & 0x3fff };
  }
  return null;
}

/** Verify binary image signatures and reject decode-bomb-sized inputs before storage. */
export async function validateEventCoverImage(file: File): Promise<SafeImage | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = bytes.length >= 24 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 16 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";

  const dimensions = isPng ? pngDimensions(bytes) : isJpeg ? jpegDimensions(bytes) : isWebp ? webpDimensions(bytes) : null;
  const result = isPng
    ? dimensions && { contentType: "image/png" as const, extension: "png" as const, ...dimensions }
    : isJpeg
      ? dimensions && { contentType: "image/jpeg" as const, extension: "jpg" as const, ...dimensions }
      : isWebp
        ? dimensions && { contentType: "image/webp" as const, extension: "webp" as const, ...dimensions }
        : null;

  if (!result || !dimensionsAreSafe(result.width, result.height)) {
    return { error: "Use a valid JPEG, PNG, or WebP image no larger than 25 megapixels." };
  }
  return result;
}
