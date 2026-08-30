import "server-only";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";

export type UploadInput = { key: string; body: Buffer | Uint8Array | Blob; contentType?: string; organisationId?: string };

const PUBLIC_DERIVATIVE_KEY = /^organisations\/([A-Za-z0-9_-]{1,128})\/(event-covers|event-speakers|event-sponsors)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export function isPublicDerivativeKey(key: string) {
  return PUBLIC_DERIVATIVE_KEY.test(key);
}

function storageConfigured() {
  return Boolean(process.env.S3_BUCKET && process.env.S3_REGION);
}

function client() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  return new S3Client({
    region: process.env.S3_REGION!,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
}

async function bytes(input: UploadInput["body"]) {
  return input instanceof Blob ? Buffer.from(await input.arrayBuffer()) : Buffer.from(input);
}

export async function uploadFile(input: UploadInput): Promise<{ key: string }> {
  const keyMatch = PUBLIC_DERIVATIVE_KEY.exec(input.key);
  if (!keyMatch || !input.organisationId || keyMatch[1] !== input.organisationId || input.contentType !== "image/webp") {
    throw new Error("Invalid public derivative storage metadata.");
  }
  const uploadBody = await bytes(input.body);
  if (storageConfigured()) {
    await client().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!, Key: input.key, Body: uploadBody,
      ContentType: input.contentType || "application/octet-stream",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    await prisma.asset.upsert({
      where: { key: input.key },
      create: { key: input.key, contentType: input.contentType || "application/octet-stream", byteSize: BigInt(uploadBody.length), provider: "s3", organisationId: input.organisationId || null },
      update: { contentType: input.contentType || "application/octet-stream", byteSize: BigInt(uploadBody.length), provider: "s3", fileData: null, organisationId: input.organisationId || null },
    });
    return { key: input.key };
  }
  if (process.env.NODE_ENV === "production") throw new Error("Private object storage is not configured.");
  await prisma.asset.upsert({
    where: { key: input.key },
    create: { key: input.key, contentType: input.contentType || "application/octet-stream", byteSize: BigInt(uploadBody.length), provider: "database", fileData: new Uint8Array(uploadBody), organisationId: input.organisationId || null },
    update: { contentType: input.contentType || "application/octet-stream", byteSize: BigInt(uploadBody.length), provider: "database", fileData: new Uint8Array(uploadBody), organisationId: input.organisationId || null },
  });
  return { key: input.key };
}

export async function downloadFile(key: string) {
  if (!isPublicDerivativeKey(key)) return null;
  const asset = await prisma.asset.findUnique({ where: { key }, select: { provider: true, fileData: true, contentType: true } });
  if (!asset || asset.contentType !== "image/webp") return null;
  if (asset.provider === "s3") {
    if (!storageConfigured()) throw new Error("Private object storage is not configured.");
    const object = await client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    if (!object.Body) return null;
    return { body: await object.Body.transformToByteArray(), contentType: object.ContentType || asset.contentType || "application/octet-stream" };
  }
  return asset.fileData ? { body: asset.fileData, contentType: asset.contentType || "application/octet-stream" } : null;
}

export function getPublicUrl(key: string): string {
  if (!isPublicDerivativeKey(key)) throw new Error("Invalid public derivative key.");
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/api/uploads/${key.replace(/^\//, "")}`;
}
