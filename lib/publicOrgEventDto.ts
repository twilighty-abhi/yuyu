import type { Prisma } from "@prisma/client";

export const publicOrgEventSelect = {
  id: true,
  createdAt: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  startDateTime: true,
  endDateTime: true,
  timezone: true,
  location: true,
  isOnline: true,
  status: true,
  tags: true,
} satisfies Prisma.EventSelect;

export const publicOrgInstanceSelect = {
  id: true,
  startDateTime: true,
  endDateTime: true,
  series: {
    select: {
      createdAt: true,
      title: true,
      description: true,
      timezone: true,
    },
  },
} satisfies Prisma.EventInstanceSelect;

export type PublicOrgEvent = Prisma.EventGetPayload<{ select: typeof publicOrgEventSelect }>;
export type PublicOrgInstance = Prisma.EventInstanceGetPayload<{ select: typeof publicOrgInstanceSelect }>;
