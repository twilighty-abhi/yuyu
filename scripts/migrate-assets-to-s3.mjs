import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

for (const key of ["S3_BUCKET", "S3_REGION"]) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required.`);
}
const prisma = new PrismaClient();
const s3 = new S3Client({
  region: process.env.S3_REGION,
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } } : {}),
});

try {
  let migrated = 0;
  while (true) {
    const assets = await prisma.asset.findMany({ where: { provider: "database", fileData: { not: null } }, take: 25, orderBy: { id: "asc" } });
    if (assets.length === 0) break;
    for (const asset of assets) {
      await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: asset.key, Body: Buffer.from(asset.fileData), ContentType: asset.contentType || "application/octet-stream", CacheControl: "public, max-age=31536000, immutable" }));
      await prisma.asset.update({ where: { id: asset.id }, data: { provider: "s3", fileData: null } });
      migrated += 1;
    }
  }
  console.log(`Migrated ${migrated} asset(s) to private object storage.`);
} finally {
  await prisma.$disconnect();
}
