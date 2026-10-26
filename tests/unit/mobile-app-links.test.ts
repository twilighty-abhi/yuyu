import { describe, expect, it } from "vitest";
import { appleAppSiteAssociation, assetLinksStatement } from "@/lib/mobile/appLinks";

const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");

/** Apple's component matching: `*` any characters (including "/"), `?` one character, first match wins. */
function claims(components: Array<{ "/": string; exclude?: boolean }>, path: string) {
  for (const component of components) {
    const pattern = new RegExp(`^${component["/"].replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
    if (pattern.test(path)) return !component.exclude;
  }
  return false;
}

describe("mobile app-link association files", () => {
  it("returns an empty assetlinks statement unless fingerprints are configured", () => {
    expect(assetLinksStatement(undefined)).toEqual([]);
    expect(assetLinksStatement("not-a-fingerprint")).toEqual([]);
    expect(assetLinksStatement(` ${fingerprint.toLowerCase()} `)).toEqual([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "com.twilighty.yuyu", sha256_cert_fingerprints: [fingerprint] },
    }]);
  });

  it("returns empty applinks unless app ids are configured", () => {
    expect(appleAppSiteAssociation(undefined)).toEqual({ applinks: { details: [] } });
    expect(appleAppSiteAssociation("bad id")).toEqual({ applinks: { details: [] } });
    expect(appleAppSiteAssociation("ABCDE12345.com.twilighty.yuyu").applinks.details[0]!.appIDs).toEqual(["ABCDE12345.com.twilighty.yuyu"]);
  });

  it("claims tickets, event pages and feedback only", () => {
    const components = appleAppSiteAssociation("ABCDE12345.com.twilighty.yuyu").applinks.details[0]!.components;
    for (const path of ["/ticket/abc123", "/civic-tech/spring-hack-night", "/civic-tech/spring-hack-night/feedback"]) {
      expect(claims(components, path), path).toBe(true);
    }
    for (const path of [
      "/civic-tech/spring-hack-night/check-in", "/civic-tech/i/clinstance1", "/civic-tech/spring-hack-night/schedule",
      "/civic-tech/spring-hack-night/sessions/welcome", "/civic-tech/spring-hack-night/speakers/ada",
      "/dashboard/civic-tech", "/dashboard/civic-tech/event/x", "/account/registrations", "/super-admin/users",
      "/api/mobile/v1/me", "/login", "/reset-password", "/verify-email", "/join/token", "/embed/civic-tech/spring",
      "/Ab3dEf9", "/civictk", "/", "/discover",
      "/team/tok", "/submit/tok", "/attend/tok", "/crew/tok", "/help", "/help/organisers/teams",
      "/civic-tech/spring-hack-night/team/tok", "/civic-tech/spring-hack-night/projects",
      "/civic-tech/spring-hack-night/projects/p1", "/civic-tech/spring-hack-night/results",
    ]) {
      expect(claims(components, path), path).toBe(false);
    }
  });
});
