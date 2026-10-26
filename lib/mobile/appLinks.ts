/*
 * App-link association files for the Yuyu mobile apps (Android and iOS).
 * Both are opt-in: without configuration they claim nothing.
 */

export const ANDROID_PACKAGE_NAME = "com.twilighty.yuyu";

function list(raw: string | undefined) {
  return (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

/** Digital Asset Links statement from `ANDROID_APP_SHA256_CERT_FINGERPRINTS`. */
export function assetLinksStatement(rawFingerprints = process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS) {
  const fingerprints = list(rawFingerprints)
    .map((value) => value.toUpperCase())
    .filter((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
  if (fingerprints.length === 0) return [];
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: ANDROID_PACKAGE_NAME, sha256_cert_fingerprints: fingerprints },
  }];
}

/*
 * Apple `components` patterns support only `*` (any characters, including
 * "/") and `?` (one character), evaluated in order with the first match
 * winning. Exclusions therefore come first. Event short codes are left out:
 * `/???????` cannot require the uppercase letter every short code has, so it
 * would also claim 7-character organisation pages. Short links still open the
 * website, which redirects to the event page (claimed below).
 */
export const APP_LINK_EXCLUDED_PATHS = [
  "/api/*",
  "/_next/*",
  "/.well-known/*",
  "/dashboard",
  "/dashboard/*",
  "/account",
  "/account/*",
  "/super-admin",
  "/super-admin/*",
  "/super-admin-mfa",
  "/super-admin-mfa/*",
  "/login",
  "/login/*",
  "/reset-password",
  "/reset-password/*",
  "/verify-email",
  "/verify-email/*",
  "/join/*",
  "/embed/*",
  "/help",
  "/help/*",
  "/team/*",
  "/submit/*",
  "/attend/*",
  "/crew/*",
  "/*/*/check-in",
  "/*/*/check-in/*",
  "/*/i/*",
  "/*/*/schedule",
  "/*/*/schedule/*",
  "/*/*/sessions/*",
  "/*/*/speakers/*",
  "/*/*/team/*",
  "/*/*/projects",
  "/*/*/projects/*",
  "/*/*/results",
  "/*/*/results/*",
] as const;

/** Claimed after the exclusions: attendee tickets, feedback forms and event pages. */
export const APP_LINK_INCLUDED_PATHS = [
  { path: "/ticket/*", comment: "Attendee tickets" },
  { path: "/*/*/feedback", comment: "Event feedback forms" },
  { path: "/*/*", comment: "Event pages" },
] as const;

/**
 * Apple App Site Association from `APPLE_APP_IDS` ("TEAMID.bundle.id", comma
 * separated); empty details when unset.
 */
export function appleAppSiteAssociation(rawAppIds = process.env.APPLE_APP_IDS) {
  const appIDs = list(rawAppIds).filter((value) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(value));
  if (appIDs.length === 0) return { applinks: { details: [] } };
  return {
    applinks: {
      details: [{
        appIDs,
        components: [
          ...APP_LINK_EXCLUDED_PATHS.map((path) => ({ "/": path, exclude: true })),
          ...APP_LINK_INCLUDED_PATHS.map(({ path, comment }) => ({ "/": path, comment })),
        ],
      }],
    },
  };
}
