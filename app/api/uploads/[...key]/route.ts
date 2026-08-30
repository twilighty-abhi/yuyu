import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { downloadFile, isPublicDerivativeKey } from "@/lib/storage";

type Context = { params: Promise<{ key: string[] }> };

const missingHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { key } = await params;
    const dbKey = key.join("/");
    if (!isPublicDerivativeKey(dbKey)) {
      return new NextResponse("Not Found", { status: 404, headers: missingHeaders });
    }

    const asset = await downloadFile(dbKey);
    if (!asset) {
      return new NextResponse("Not Found", { status: 404, headers: missingHeaders });
    }

    return new Response(Uint8Array.from(asset.body).buffer, {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Disposition": "inline",
        "Cross-Origin-Resource-Policy": "same-site",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    console.error("[uploads API] Failed to fetch public derivative.");
    return new NextResponse("Internal Server Error", { status: 500, headers: missingHeaders });
  }
}
