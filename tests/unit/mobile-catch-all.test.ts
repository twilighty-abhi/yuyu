import { describe, expect, it } from "vitest";
import * as route from "@/app/api/mobile/v1/[...path]/route";

describe("unknown /api/mobile/v1 paths", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)("answer %s with the JSON NOT_FOUND envelope", async (method) => {
    const response = route[method]();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });
});
