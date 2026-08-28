import "server-only";

import { prisma } from "@/lib/db";

export const INSTANCE_SETTINGS_ID = "global";

/** A missing singleton row intentionally preserves the historical default. */
export async function isNewUserRegistrationEnabled(): Promise<boolean> {
  const settings = await prisma.instanceSetting.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: { allowNewUserSignups: true },
  });
  return settings?.allowNewUserSignups ?? true;
}
