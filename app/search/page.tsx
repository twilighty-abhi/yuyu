import { EventPrivacyType, EventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SearchPageClient } from "@/components/search/SearchPageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search",
  description: "Search events by keyword, tag, or organisation.",
};

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const qLower = q.toLowerCase();
  const tokens = Array.from(
    new Set(
      qLower
        .split(/[\s,]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  ).slice(0, 8);

  const events =
    q.length === 0
      ? []
      : await prisma.event.findMany({
          where: {
            status: EventStatus.PUBLISHED,
            privacyType: EventPrivacyType.PUBLIC,
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
          include: {
            organisation: { select: { slug: true, name: true } },
          },
          orderBy: { startDateTime: "asc" },
          take: 48,
        });

  return (
    <SearchPageClient
      q={q}
      events={events.map((e) => ({
        ...e,
        startDateTime: e.startDateTime.toISOString(),
        endDateTime: e.endDateTime.toISOString(),
      }))}
    />
  );
}
