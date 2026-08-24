import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
const file = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "event";

export async function GET(_request: Request, context: RouteContext<"/api/ticket/[token]/download">) {
  const { token } = await context.params;
  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: token.trim() },
    include: {
      user: { select: { name: true } },
      event: { select: { title: true, startDateTime: true, timezone: true, location: true, organisation: { select: { name: true } } } },
      eventInstance: { select: { startDateTime: true, series: { select: { title: true, timezone: true, organisation: { select: { name: true } } } } } },
    },
  });
  if (!rsvp || rsvp.status === "REJECTED") notFound();
  const event = rsvp.event;
  const instance = rsvp.eventInstance;
  if (!event && !instance) notFound();
  const title = event?.title ?? instance!.series.title;
  const org = event?.organisation.name ?? instance!.series.organisation.name;
  const timeZone = event?.timezone ?? instance!.series.timezone;
  const start = event?.startDateTime ?? instance!.startDateTime;
  const when = start.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });
  const attendee = rsvp.user?.name?.trim() || rsvp.guestName?.trim() || rsvp.guestEmail?.split("@")[0] || "Guest";
  const qr = await QRCode.toString(token, { type: "svg", width: 520, margin: 0, color: { dark: "#111111", light: "#ffffff" } });
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1400" viewBox="0 0 1200 1400"><style>text{font-family:system-ui,sans-serif}.title{font-size:64px;font-weight:700;fill:#1d1b20}.label{font-size:28px;fill:#49454f}.detail{font-size:42px;fill:#1d1b20}</style><rect width="1200" height="240" fill="#6750a4"/><text x="80" y="95" fill="#fff" font-size="40">${esc(org)}</text><text x="80" y="180" fill="#fff" font-size="70" font-weight="700">EVENT TICKET</text><text class="title" x="80" y="340">${esc(title)}</text><text class="label" x="80" y="450">ATTENDEE</text><text class="detail" x="80" y="510">${esc(attendee)}</text><text class="label" x="80" y="610">WHEN</text><text class="detail" x="80" y="670">${esc(when)}</text><text class="label" x="80" y="750">${esc(event?.location || "")}</text><rect x="310" y="790" width="580" height="580" rx="18" fill="#fff" stroke="#cac4d0" stroke-width="3"/><g transform="translate(340 820)">${qr}</g></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": `attachment; filename="${file(title)}-ticket.svg"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
