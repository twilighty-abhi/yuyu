import { auth } from "@/lib/auth";
import { LandingPageClient } from "@/components/landing/LandingPageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yuyu — Host Events That People Show Up To",
  description:
    "Create organisations, publish events with waitlist automations, send email invitations, and manage check-ins with secure ticket QR codes.",
};

export default async function HomePage() {
  const session = await auth();
  const getStartedHref = session?.user ? "/dashboard" : "/login";

  return <LandingPageClient getStartedHref={getStartedHref} />;
}
