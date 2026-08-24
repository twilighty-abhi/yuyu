import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { downloadFile } from "@/lib/storage";

type Context = { params: Promise<{ key: string[] }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { key } = await params;
    const dbKey = key.join("/");

    const asset = await downloadFile(dbKey);
    if (!asset) {
      return new NextResponse("Not Found", { status: 404 });
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
  } catch (error) {
    console.error("[uploads API] Failed to fetch asset:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
