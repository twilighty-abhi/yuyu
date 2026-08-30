import type { Metadata } from "next";
import { FeaturesExplorer } from "@/components/landing/FeaturesExplorer";

export const metadata: Metadata = {
  title: "Features",
  description: "Explore Yuyu's complete free-event lifecycle: registration, recurring series, tickets, check-in, feedback, and secure self-hosted operations.",
};

export default function FeaturesPage() {
  return <FeaturesExplorer />;
}
