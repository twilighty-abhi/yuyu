import sharp from "sharp";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char] ?? char);
const filename = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "event";
export async function GET(_request: Request, context: RouteContext<"/api/feedback/certificate/[token]">) {
  const { token } = await context.params;
  const response = await prisma.eventFeedbackResponse.findUnique({ where: { certificateToken: token.trim() }, include: { form: { include: { event: { include: { organisation: { select: { name: true } } } } } }, rsvp: { include: { user: { select: { name: true } } } } } });
  if (!response || !response.form.certificateEnabled || !response.rsvp || response.rsvp.status !== "CONFIRMED") notFound();
  const attendee = response.rsvp.user?.name?.trim() || response.rsvp.guestName?.trim() || response.rsvp.guestEmail?.split("@")[0] || "Participant";
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1130" viewBox="0 0 1600 1130"><rect width="1600" height="1130" fill="#fff"/><rect x="35" y="35" width="1530" height="1060" rx="20" fill="none" stroke="#1d3557" stroke-width="8"/><text x="800" y="175" text-anchor="middle" font-family="'DejaVu Serif',serif" font-size="42" fill="#1d3557">${escapeXml(response.form.event.organisation.name)}</text><text x="800" y="340" text-anchor="middle" font-family="'DejaVu Serif',serif" font-size="92" font-weight="700" fill="#111827">CERTIFICATE OF PARTICIPATION</text><text x="800" y="455" text-anchor="middle" font-family="'DejaVu Sans',sans-serif" font-size="35" fill="#4b5563">This certifies that</text><text x="800" y="585" text-anchor="middle" font-family="'DejaVu Serif',serif" font-size="80" font-weight="700" fill="#111827">${escapeXml(attendee)}</text><line x1="360" y1="620" x2="1240" y2="620" stroke="#94a3b8" stroke-width="3"/><text x="800" y="715" text-anchor="middle" font-family="'DejaVu Sans',sans-serif" font-size="35" fill="#4b5563">has completed the feedback for</text><text x="800" y="805" text-anchor="middle" font-family="'DejaVu Serif',serif" font-size="62" font-weight="700" fill="#1d3557">${escapeXml(response.form.event.title)}</text><text x="800" y="945" text-anchor="middle" font-family="'DejaVu Sans',sans-serif" font-size="28" fill="#64748b">Issued ${response.submittedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</text></svg>`;
  const jpeg = await sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
  return new Response(jpeg, { headers: { "Content-Type": "image/jpeg", "Content-Disposition": `attachment; filename="${filename(response.form.event.title)}-certificate.jpg"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
