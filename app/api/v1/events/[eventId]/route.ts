import { NextResponse } from "next/server";
import { withApiMonitoring } from "@/lib/apiMonitor";
import { handleMachineApiRequest } from "@/lib/api/v1/handler";
import { apiError } from "@/lib/api/v1/errors";
import { apiResourceIdSchema, emptyQuerySchema } from "@/lib/api/v1/schemas";
import { getApiEvent } from "@/lib/api/v1/events";

type Context = { params: Promise<{ eventId: string }> };

export const GET = withApiMonitoring(
  "GET /api/v1/events/:eventId",
  async (request: Request, routeContext: Context) =>
    handleMachineApiRequest(request, "events:read", async (context) => {
      const query = emptyQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!query.success) return apiError("INVALID_REQUEST", 400);

      const params = await routeContext.params;
      const eventId = apiResourceIdSchema.safeParse(params.eventId);
      if (!eventId.success) return apiError("INVALID_REQUEST", 400);

      const response = await getApiEvent(context.organisationId, eventId.data);
      if (!response) return apiError("RESOURCE_NOT_FOUND", 404);
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }),
);
