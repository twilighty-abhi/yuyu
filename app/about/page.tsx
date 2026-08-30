import type { Metadata } from "next";
import { AboutYuyu } from "@/components/landing/AboutYuyu";

export const metadata: Metadata = {
  title: "About",
  description: "Meet Abhiram N J and the story behind Yuyu, an AI-assisted, self-hosted platform for free events.",
};

export default function AboutPage() {
  return <AboutYuyu />;
}
