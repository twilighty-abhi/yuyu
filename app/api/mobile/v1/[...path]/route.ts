import { mobileError } from "@/lib/mobile/http";

/*
 * Unknown paths under /api/mobile/v1 answer with the mobile JSON error
 * envelope (404 NOT_FOUND), not the HTML not-found page. Every defined route
 * is more specific than this catch-all, so it only sees unmatched paths.
 */
export const dynamic = "force-dynamic";

const notFound = () => mobileError("NOT_FOUND");

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
