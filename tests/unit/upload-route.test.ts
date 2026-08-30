import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/storage")>();
  return { ...original, downloadFile: mocks.download };
});

import { GET } from "@/app/api/uploads/[...key]/route";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("public derivative route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.download.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: "image/webp" });
  });

  it("rejects traversal-like and arbitrary keys before storage lookup", async () => {
    const response = await GET(new NextRequest("https://events.example.test/api/uploads/backups/secret"), {
      params: Promise.resolve({ key: ["backups", "secret"] }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("serves only the registered safe derivative with immutable image controls", async () => {
    const key = `organisations/org_1/event-covers/${uuid}.webp`;
    const response = await GET(new NextRequest(`https://events.example.test/api/uploads/${key}`), {
      params: Promise.resolve({ key: key.split("/") }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-site");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(mocks.download).toHaveBeenCalledWith(key);
  });
});
