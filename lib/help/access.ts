import "server-only";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { superAdminEmailFor } from "@/lib/permissions";
import type { HelpAccess } from "@/content/help/manifest";

/**
 * Which guide sections the current visitor may read. Public sections are for
 * everyone; "org-admin" needs an owner or admin role in any organisation; the
 * super-admin reads everything. Cached per request because the layout, the
 * page and metadata all ask.
 */
export const helpAccessForViewer = cache(async (): Promise<ReadonlySet<HelpAccess>> => {
  const access = new Set<HelpAccess>(["public"]);
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return access;

  if (await superAdminEmailFor(userId)) {
    access.add("org-admin");
    access.add("super-admin");
    return access;
  }
  const adminMembership = await prisma.membership.findFirst({
    where: { userId, role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  if (adminMembership) access.add("org-admin");
  return access;
});
