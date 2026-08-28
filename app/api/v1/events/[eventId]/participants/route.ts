import { NextResponse } from "next/server";
import { withApiMonitoring } from "@/lib/apiMonitor";
import { handleMachineApiRequest } from "@/lib/api/v1/handler";
import { apiError } from "@/lib/api/v1/errors";
import { decodeCursor } from "@/lib/api/v1/pagination";
import { apiResourceIdSchema, participantCollectionQuerySchema } from "@/lib/api/v1/schemas";
import { listApiParticipants } from "@/lib/api/v1/events";

type Context = { params: Promise<{ eventId: string }> };

export const GET = withApiMonitoring(
  "GET /api/v1/events/:eventId/participants",
  async (request: Request, routeContext: Context) =>
    handleMachineApiRequest(request, "participants:read", async (context) => {
      const params = await routeContext.params;
      const eventId = apiResourceIdSchema.safeParse(params.eventId);
      if (!eventId.success) return apiError("INVALID_REQUEST", 400);

      const url = new URL(request.url);
      const query = participantCollectionQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!query.success) return apiError("INVALID_REQUEST", 400);
      if (query.data.include === "attendance" && !context.scopes.has("participants:attendance:read")) {
        return apiError("INSUFFICIENT_SCOPE", 403);
      }
      const cursor = decodeCursor(query.data.cursor);
      if (query.data.cursor && !cursor) return apiError("INVALID_REQUEST", 400);

      const response = await listApiParticipants(
        context.organisationId,
        eventId.data,
        query.data.limit,
        cursor,
        query.data.attendance,
        query.data.include === "attendance",
      );
      if (!response) return apiError("RESOURCE_NOT_FOUND", 404);
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }),
);
