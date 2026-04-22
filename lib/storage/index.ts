/**
 * S3-compatible storage abstraction. Wire AWS SDK, MinIO, or R2 in production.
 */

export type UploadInput = {
  key: string;
  body: Buffer | Uint8Array | Blob;
  contentType?: string;
};

export async function uploadFile(input: UploadInput): Promise<{ key: string }> {
  const base = process.env.STORAGE_PUBLIC_BASE_URL ?? "";
  if (!base) {
    console.warn("[storage] STORAGE_PUBLIC_BASE_URL not set; uploadFile is a no-op.");
  }
  return { key: input.key };
}

export function getPublicUrl(key: string): string {
  const base = (process.env.STORAGE_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (!base) return key;
  return `${base}/${key.replace(/^\//, "")}`;
}
