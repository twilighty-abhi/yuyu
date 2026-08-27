import { NextResponse } from "next/server";
import { withApiMonitoring } from "@/lib/apiMonitor";
import { handleMachineApiRequest } from "@/lib/api/v1/handler";
import { apiError } from "@/lib/api/v1/errors";
import { decodeCursor } from "@/lib/api/v1/pagination";
import { collectionQuerySchema } from "@/lib/api/v1/schemas";
import { listApiEvents } from "@/lib/api/v1/events";

export const GET = withApiMonitoring("GET /api/v1/events", async (request: Request) =>
  handleMachineApiRequest(request, "events:read", async (context) => {
    const url = new URL(request.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = collectionQuerySchema.safeParse(raw);
    if (!parsed.success) return apiError("INVALID_REQUEST", 400);
    const cursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor) return apiError("INVALID_REQUEST", 400);

    const response = await listApiEvents(
      context.organisationId,
      parsed.data.limit,
      cursor,
    );
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  }),
);
