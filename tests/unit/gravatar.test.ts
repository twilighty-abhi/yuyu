import { describe, expect, it } from "vitest";
import { gravatarUrl } from "@/lib/gravatar";

describe("gravatarUrl", () => {
  it("normalizes an email before creating its Gravatar URL", () => {
    expect(gravatarUrl(" Person@Example.com ")).toBe(
      "https://www.gravatar.com/avatar/7de8517bce4457e8390aa4006a1880fb?d=404&s=160",
    );
  });
});
