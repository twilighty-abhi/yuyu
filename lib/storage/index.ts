import { prisma } from "@/lib/db";

export type UploadInput = {
  key: string;
  body: Buffer | Uint8Array | Blob;
  contentType?: string;
  organisationId?: string;
};

export async function uploadFile(input: UploadInput): Promise<{ key: string }> {
  try {
    let uploadBody: Buffer;
    if (input.body instanceof Blob) {
      const arrayBuffer = await input.body.arrayBuffer();
      uploadBody = Buffer.from(arrayBuffer);
    } else {
      uploadBody = Buffer.from(input.body);
    }

    const uint8Body = new Uint8Array(uploadBody);

    // Upsert key/binary data in PostgreSQL via Prisma
    await prisma.asset.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        contentType: input.contentType || "application/octet-stream",
        byteSize: BigInt(uploadBody.length),
        provider: "database",
        fileData: uint8Body,
        organisationId: input.organisationId || null,
      },
      update: {
        contentType: input.contentType || "application/octet-stream",
        byteSize: BigInt(uploadBody.length),
        provider: "database",
        fileData: uint8Body,
        organisationId: input.organisationId || null,
      },
    });

    return { key: input.key };
  } catch (e) {
    console.error(`[storage] Failed to upload file ${input.key} to database:`, e);
    throw e;
  }
}

export function getPublicUrl(key: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/api/uploads/${key.replace(/^\//, "")}`;
}
