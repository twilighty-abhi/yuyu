import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ key: string[] }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { key } = await params;
    const dbKey = key.join("/");

    const asset = await prisma.asset.findUnique({
      where: { key: dbKey },
    });

    if (!asset || !asset.fileData) {
      return new NextResponse("Not Found", { status: 404 });
    }

    return new Response(asset.fileData, {
      headers: {
        "Content-Type": asset.contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[uploads API] Failed to fetch asset:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
