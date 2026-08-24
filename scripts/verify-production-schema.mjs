import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [assetColumns, constraints, indexes] = await Promise.all([
    prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Asset'
    `,
    prisma.$queryRaw`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN ('RSVP_exactly_one_target', 'CheckInEvent_rsvpId_fkey', 'AuditEvent_organisationId_fkey')
    `,
    prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN ('Asset_key_key', 'RSVP_event_attendee_unique', 'RSVP_instance_attendee_unique')
    `,
  ]);
  const columnNames = new Set(assetColumns.map((row) => row.column_name));
  const constraintNames = new Set(constraints.map((row) => row.conname));
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const missing = [
    ...["fileData", "key"].filter((column) => !columnNames.has(column)),
    ...["RSVP_exactly_one_target", "CheckInEvent_rsvpId_fkey", "AuditEvent_organisationId_fkey"].filter((name) => !constraintNames.has(name)),
    ...["Asset_key_key", "RSVP_event_attendee_unique", "RSVP_instance_attendee_unique"].filter((name) => !indexNames.has(name)),
  ];
  if (missing.length > 0) {
    throw new Error(`Database schema contract failed; missing: ${missing.join(", ")}`);
  }
  console.log("Database schema contract passed.");
} finally {
  await prisma.$disconnect();
}
