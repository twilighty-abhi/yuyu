import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { checkRateLimit } from "@/lib/rateLimit";

function tooMany() {
  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}

function tooManyText() {
  return new NextResponse("Too many requests. Try again later.", {
    status: 429,
    headers: { "Retry-After": "60", "Cache-Control": "no-store" },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Liveness must not depend on Redis. Readiness remains protected because a
  // failed distributed limiter means the application is not fully ready.
  if (pathname.startsWith("/api") && pathname !== "/api/health") {
    if (!(await checkRateLimit(request, "global"))) {
      return tooMany();
    }
  }

  // Auth.js polls session, CSRF, and provider endpoints with GET requests.
  // Counting those reads against the strict sign-in bucket logs active users
  // out after a few tabs or routine session refreshes. Mutating auth requests
  // retain the dedicated protection; all reads remain under the global limit.
  if (pathname.startsWith("/api/auth") && request.method !== "GET") {
    if (!(await checkRateLimit(request, "auth"))) {
      return tooMany();
    }
  }

  if (pathname === "/api/uploads" && request.method !== "GET") {
    if (!(await checkRateLimit(request, "upload"))) {
      return tooMany();
    }
  }

  if (pathname === "/api/rsvp" && request.method === "POST") {
    if (!(await checkRateLimit(request, "rsvp"))) {
      return tooMany();
    }
  }

  if (pathname === "/api/search" && request.method === "GET") {
    if (!(await checkRateLimit(request, "search"))) {
      return tooMany();
    }
  }

  if (pathname === "/search") {
    if (!(await checkRateLimit(request, "search"))) {
      return tooManyText();
    }
  }

  if (pathname.startsWith("/api")) return NextResponse.next();

  const nonce = crypto.randomBytes(16).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src https://maps.google.com https://www.google.com",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https:",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    // MUI/Emotion emits runtime style tags and attributes. A nonce combined
    // with unsafe-inline causes browsers to ignore unsafe-inline entirely.
    // Scripts remain protected by a per-request nonce and strict-dynamic.
    "style-src 'self' 'unsafe-inline'",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/search",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
