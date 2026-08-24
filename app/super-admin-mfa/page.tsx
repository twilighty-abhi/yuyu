import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/permissions";
import { SuperAdminMfaPrompt } from "@/components/super-admin/SuperAdminMfaPrompt";

export const metadata: Metadata = { title: "Verify super-admin access" };

export default async function SuperAdminMfaPage() {
  await requireSuperAdmin();
  return <SuperAdminMfaPrompt />;
}
