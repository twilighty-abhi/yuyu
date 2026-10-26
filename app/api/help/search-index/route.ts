import { NextResponse } from "next/server";
import { helpAccessForViewer } from "@/lib/help/access";
import { helpSearchDocuments } from "@/lib/help/content";

/**
 * Plain text of every guide article the viewer may read, searched in the
 * browser by components/help/HelpSearch.tsx. Admin sections are only included
 * for viewers who can open them, so the response is never shared or stored.
 */
export async function GET() {
  const access = await helpAccessForViewer();
  const documents = await helpSearchDocuments(access);
  return NextResponse.json({ documents }, { headers: { "Cache-Control": "private, no-store" } });
}
