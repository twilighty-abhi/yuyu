import { NextResponse } from "next/server";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withApiMonitoring } from "@/lib/apiMonitor";

export const GET = withApiMonitoring("GET /api/search", async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const qLower = q.toLowerCase();
  const tokens = Array.from(
    new Set(
      qLower
        .split(/[\s,]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  ).slice(0, 8);

  if (q.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const events = await prisma.event.findMany({
    where: {
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      page: { is: { isPublished: true } },
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { tags: { has: qLower } },
        ...(tokens.length > 0 ? [{ tags: { hasSome: tokens } }] : []),
        {
          organisation: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      tags: true,
      coverImageUrl: true,
      startDateTime: true,
      endDateTime: true,
      timezone: true,
      location: true,
      mapLinkUrl: true,
      isOnline: true,
      organisation: { select: { slug: true, name: true } },
    },
    orderBy: { startDateTime: "asc" },
    take: 48,
  });

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      description: e.description,
      tags: e.tags,
      coverImageUrl: e.coverImageUrl,
      startDateTime: e.startDateTime.toISOString(),
      endDateTime: e.endDateTime.toISOString(),
      timezone: e.timezone,
      location: e.location,
      mapLinkUrl: e.mapLinkUrl,
      isOnline: e.isOnline,
      organisation: e.organisation,
    })),
  });
});
