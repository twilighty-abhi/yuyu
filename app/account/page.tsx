import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { gravatarUrl } from "@/lib/gravatar";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";

export const metadata: Metadata = { title: "Account settings" };

export default async function AccountPage() {
  const session = await requireAuth();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, email: true, image: true, createdAt: true },
  });

  return (
    <AccountProfileForm
      initialName={user.name ?? ""}
      email={user.email}
      image={user.image}
      gravatarUrl={user.email ? gravatarUrl(user.email) : null}
      createdAtLabel={new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(user.createdAt)}
    />
  );
}
