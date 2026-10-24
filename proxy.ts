import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { checkRateLimit } from "@/lib/rateLimit";

function tooMany(apiV1 = false, mobile = false) {
  return NextResponse.json(
    mobile
      ? { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } }
      : apiV1
      ? { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } }
      : { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}

function tooManyText() {
  return new NextResponse("Too many requests. Try again later.", {
    status: 429,
    headers: { "Retry-After": "60", "Cache-Control": "no-store" },
  });
}

function allowedEmbedAncestors() {
  return Array.from(new Set(
    (process.env.ALLOWED_EMBED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .flatMap((value) => {
        try {
          const url = new URL(value);
          return url.origin === value && ["https:", "http:"].includes(url.protocol) ? [value] : [];
        } catch {
          return [];
        }
      }),
  ));
}

/**
 * Pages that must never be stored: those whose URL is itself the credential
 * (`/ticket/{token}`, `/team/{token}`, `/{org}/{event}/team/{joinToken}`,
 * `/submit/{token}`), and the signed-in entrant's own project page
 * (`/account/submissions/{eventId}`, docs/HACKATHON.md).
 */
function isNoStorePage(pathname: string): boolean {
  return /^\/(?:ticket|team|submit)\/[^/]+\/?$/.test(pathname)
    || /^\/[^/]+\/[^/]+\/team\/[^/]+\/?$/.test(pathname)
    || /^\/account\/submissions\/[^/]+\/?$/.test(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Only the dedicated, public embed route may be placed in another site's
  // frame. Every normal application page remains protected from clickjacking.
  const isEmbedPage = /^\/embed\/[^/]+\/[^/]+$/.test(pathname);
  const embedAncestors = isEmbedPage ? allowedEmbedAncestors() : [];

  // Server Actions post to page URLs, not /api. Apply one distributed ceiling
  // before any action-specific subject/IP limits run in the action itself.
  if (request.method === "POST" && request.headers.has("next-action")) {
    if (!(await checkRateLimit(request, "action"))) return tooMany();
  }

  if (pathname === "/discover") {
    if (!(await checkRateLimit(request, "search"))) return tooManyText();
  }

  // Liveness must not depend on Redis. Readiness remains protected because a
  // failed distributed limiter means the application is not fully ready.
  if (pathname.startsWith("/api") && pathname !== "/api/health") {
    if (!(await checkRateLimit(request, "global"))) {
      return tooMany(pathname.startsWith("/api/v1"), pathname.startsWith("/api/mobile/"));
    }
  }

  // Mobile app sign-in shares the strict per-IP sign-in bucket with the web
  // (the credential verifier adds per-account limits). Mobile API requests are
  // bearer-authenticated route handlers: no cookies, CSRF or Server Action
  // origin checks apply, and nothing here redirects them.
  if ((pathname === "/api/mobile/v1/auth/login" || pathname === "/api/mobile/v1/auth/google") && request.method === "POST") {
    if (!(await checkRateLimit(request, "auth"))) return tooMany(false, true);
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

  if (pathname.startsWith("/api")) {
    const response = NextResponse.next();
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  }

  const nonce = crypto.randomBytes(16).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${isEmbedPage && embedAncestors.length > 0 ? embedAncestors.join(" ") : "'none'"}`,
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
  // Cloudflare Email Address Obfuscation injects an unsigned decoder script
  // after this CSP has been generated. Its script is intentionally blocked by
  // the per-request nonce policy, so instruct intermediaries not to transform
  // application HTML.
  // Bearer-capability pages (ticket, team management and join links, solo
  // submission links; docs/TEAMS.md, docs/HACKATHON.md) and the account
  // submission page must never be stored by a browser or shared cache. This
  // header replaces Next's own `private, no-store` in production, so say it here.
  response.headers.set("Cache-Control", isNoStorePage(pathname) ? "private, no-cache, no-store, max-age=0, must-revalidate, no-transform" : "no-transform");
  if (!isEmbedPage) response.headers.set("X-Frame-Options", "DENY");
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
