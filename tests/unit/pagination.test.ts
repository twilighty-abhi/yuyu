import { describe, expect, it } from "vitest";
import { paginationWindow } from "@/lib/pagination";

describe("paginationWindow", () => {
  it("keeps a bounded window around the current page", () => {
    expect(paginationWindow(50, 100)).toEqual([47, 48, 49, 50, 51, 52, 53]);
    expect(paginationWindow(1, 100)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(paginationWindow(100, 100)).toEqual([94, 95, 96, 97, 98, 99, 100]);
  });
});
