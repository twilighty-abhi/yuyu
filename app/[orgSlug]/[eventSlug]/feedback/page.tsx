import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PublicFeedbackForm } from "@/components/feedback/PublicFeedbackForm";

type Props = { params: Promise<{ orgSlug: string; eventSlug: string }> };
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return { title: "Event feedback", robots: { index: false, follow: false } }; }
export default async function FeedbackPage({ params }: Props) {
  const { orgSlug, eventSlug } = await params;
  const event = await prisma.event.findFirst({ where: { organisation: { slug: orgSlug }, slug: eventSlug, status: EventStatus.PUBLISHED }, include: { feedbackForm: { include: { fields: { orderBy: { sortOrder: "asc" } } } } } });
  if (!event?.feedbackForm?.isOpen) notFound();
  const fields = event.feedbackForm.fields.map((field) => ({ id: field.id, key: field.key, label: field.label, type: field.type, required: field.required, sortOrder: field.sortOrder, options: Array.isArray(field.options) ? field.options.filter((value): value is string => typeof value === "string") : [] }));
  return <Stack sx={{ maxWidth: 720, mx: "auto", py: { xs: 4, sm: 8 }, px: 2 }} spacing={3}><Stack spacing={1}><Typography variant="overline" color="primary">{event.title}</Typography><Typography variant="h3" component="h1">{event.feedbackForm.title}</Typography></Stack><Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}><PublicFeedbackForm orgSlug={orgSlug} eventSlug={eventSlug} fields={fields} thankYouMessage={event.feedbackForm.thankYouMessage} certificateEnabled={event.feedbackForm.certificateEnabled} /></Paper></Stack>;
}
