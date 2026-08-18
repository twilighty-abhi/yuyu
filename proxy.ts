import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

function tooMany() {
  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    { status: 429 },
  );
}

function tooManyText() {
  return new NextResponse("Too many requests. Try again later.", {
    status: 429,
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api")) {
    if (!(await checkRateLimit(request, "global"))) {
      return tooMany();
    }
  }

  if (pathname.startsWith("/api/auth")) {
    if (!(await checkRateLimit(request, "auth"))) {
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/search"],
};
