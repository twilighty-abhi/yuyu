import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findUser: vi.fn(),
  findMembership: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.session }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.findUser }, membership: { findFirst: mocks.findMembership } },
}));
// React's request cache is a no-op outside a server render; call through.
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { helpAccessForViewer } from "@/lib/help/access";
import { findHelpArticle, helpSearchDocuments, visibleHelpSections } from "@/lib/help/content";
import { GET } from "@/app/api/help/search-index/route";

const access = (...levels: Array<"public" | "org-admin" | "super-admin">) => new Set(levels);

describe("guide access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPER_ADMIN_EMAIL", "root@example.org");
    mocks.findUser.mockResolvedValue({ email: "someone@example.org", emailVerified: new Date() });
    mocks.findMembership.mockResolvedValue(null);
  });

  it("gives signed-out visitors the public sections only", async () => {
    mocks.session.mockResolvedValue(null);
    expect([...(await helpAccessForViewer())]).toEqual(["public"]);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("adds developer sections for organisation owners and admins", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user_1" } });
    mocks.findMembership.mockResolvedValue({ id: "membership_1" });
    expect([...(await helpAccessForViewer())].sort()).toEqual(["org-admin", "public"]);
    expect(mocks.findMembership).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user_1", role: { in: ["OWNER", "ADMIN"] } } }));
  });

  it("keeps plain members on the public sections", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user_1" } });
    expect([...(await helpAccessForViewer())]).toEqual(["public"]);
  });

  it("opens everything to the verified super-admin, and nothing extra when unverified", async () => {
    mocks.session.mockResolvedValue({ user: { id: "root" } });
    mocks.findUser.mockResolvedValue({ email: "Root@Example.org", emailVerified: new Date() });
    expect([...(await helpAccessForViewer())].sort()).toEqual(["org-admin", "public", "super-admin"]);

    mocks.findUser.mockResolvedValue({ email: "root@example.org", emailVerified: null });
    expect([...(await helpAccessForViewer())]).toEqual(["public"]);
  });

  it("hides restricted articles and sections from viewers without access", () => {
    expect(findHelpArticle("instance/settings", access("public"))).toBeNull();
    expect(findHelpArticle("developers/api", access("public"))).toBeNull();
    expect(findHelpArticle("developers/api", access("public", "org-admin"))?.title).toBe("The machine API");
    expect(findHelpArticle("../../package", access("public", "org-admin", "super-admin"))).toBeNull();
    expect(visibleHelpSections(access("public")).map((section) => section.access)).not.toContain("super-admin");
  });

  it("indexes only readable articles for search", async () => {
    const publicDocs = await helpSearchDocuments(access("public"));
    expect(publicDocs.some((doc) => doc.slug.startsWith("instance/") || doc.slug.startsWith("developers/"))).toBe(false);
    const adminDocs = await helpSearchDocuments(access("public", "org-admin", "super-admin"));
    expect(adminDocs.some((doc) => doc.slug === "instance/settings")).toBe(true);
  });

  it("serves the search index privately and without restricted sections to guests", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as { documents: Array<{ slug: string }> };
    expect(body.documents.length).toBeGreaterThan(10);
    expect(body.documents.every((doc) => !doc.slug.startsWith("instance/") && !doc.slug.startsWith("developers/"))).toBe(true);
  });
});
