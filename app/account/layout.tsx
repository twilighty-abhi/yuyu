import { requireAuth } from "@/lib/permissions";
import { AccountSettingsLayout } from "@/components/account/AccountSettingsLayout";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return <AccountSettingsLayout>{children}</AccountSettingsLayout>;
}
