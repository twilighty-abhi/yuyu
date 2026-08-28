import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { EventPrivacyType, EventStatus } from "@prisma/client";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Yuyu event preview";

export default async function OpenGraphImage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string }> }) {
  const { orgSlug, eventSlug } = await params;
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug }, select: { id: true, name: true } });
  const event = org ? await prisma.event.findUnique({ where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } } }) : null;
  const visible = event && event.status !== EventStatus.DRAFT && event.privacyType !== EventPrivacyType.INVITE_ONLY;
  const title = visible ? event.title : "Yuyu event";
  const detail = visible ? `${org!.name} · ${event.startDateTime.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: event.timezone })}` : "Events made simple";
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "linear-gradient(135deg, #071d18, #0A84FF)", color: "white" }}><div style={{ display: "flex", fontSize: 32, opacity: 0.85 }}>Yuyu Events</div><div style={{ display: "flex", flexDirection: "column", gap: 20 }}><div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>{title}</div><div style={{ display: "flex", fontSize: 34, opacity: 0.92 }}>{detail}</div></div></div>, size);
}
