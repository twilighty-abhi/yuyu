import { describe, expect, it } from "vitest";
import {
  ALWAYS_SENT_EMAIL_KINDS,
  announcedBefore,
  announcementCoversPublication,
  GATED_HACKATHON_EMAIL_KINDS,
  HACKATHON_EMAIL_DEFAULTS,
  needsAnnouncementCount,
  publishedResultsEmailLine,
  publishResultsEmailCopy,
  resultsAnnouncementState,
  sendResultsAnnouncementRefusal,
  sendResultsEmailCopy,
  shouldEmailOnPublish,
  shouldQueueSubmissionReceipt,
  unpublishedResultsEmailLine,
} from "@/lib/hackathonEmails";
import { judgingSettingsSchema } from "@/lib/validators";

const open = "2030-01-01T00:00:00.000Z";
const close = "2030-01-02T00:00:00.000Z";
const base = { submissionsEnabled: true, submissionsOpenAt: open, submissionsCloseAt: close, judgesSeeAll: true, projectGalleryPublic: false };

describe("hackathon email switches", () => {
  it("are off by default and gate only the two hackathon emails", () => {
    expect(HACKATHON_EMAIL_DEFAULTS).toEqual({ emailEntrantsOnResults: false, emailSubmissionReceipts: false });
    expect(GATED_HACKATHON_EMAIL_KINDS).toEqual(["results-published", "submission-received"]);
    for (const kind of ["rsvp-confirmation", "rsvp-status", "team-created", "team-member-added", "submission-link", "email-verification", "password-reset"]) {
      expect(ALWAYS_SENT_EMAIL_KINDS).toContain(kind);
      expect(GATED_HACKATHON_EMAIL_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  it("queue each email only when its own switch is on", () => {
    expect(shouldQueueSubmissionReceipt(HACKATHON_EMAIL_DEFAULTS)).toBe(false);
    expect(shouldEmailOnPublish(HACKATHON_EMAIL_DEFAULTS)).toBe(false);
    expect(shouldQueueSubmissionReceipt({ emailSubmissionReceipts: true })).toBe(true);
    expect(shouldEmailOnPublish({ emailEntrantsOnResults: true })).toBe(true);
    const resultsOnly = { ...HACKATHON_EMAIL_DEFAULTS, emailEntrantsOnResults: true };
    const receiptsOnly = { ...HACKATHON_EMAIL_DEFAULTS, emailSubmissionReceipts: true };
    expect(shouldQueueSubmissionReceipt(resultsOnly)).toBe(false);
    expect(shouldEmailOnPublish(receiptsOnly)).toBe(false);
  });

  it("track the results announcement state", () => {
    const now = new Date();
    expect(resultsAnnouncementState({ resultsPublishedAt: null, resultsAnnouncedAt: null, emailEntrantsOnResults: true })).toBe("unpublished");
    expect(resultsAnnouncementState({ resultsPublishedAt: now, resultsAnnouncedAt: now, emailEntrantsOnResults: false })).toBe("announced");
    expect(resultsAnnouncementState({ resultsPublishedAt: now, resultsAnnouncedAt: null, emailEntrantsOnResults: false })).toBe("off");
    expect(resultsAnnouncementState({ resultsPublishedAt: now.toISOString(), resultsAnnouncedAt: null, emailEntrantsOnResults: true })).toBe("ready");
  });

  it("treat an announcement older than the current publication as belonging to an earlier one", () => {
    const first = new Date("2030-02-01T10:00:00.000Z");
    const republished = new Date("2030-02-01T12:00:00.000Z");
    const covered = { resultsPublishedAt: first, resultsAnnouncedAt: first };
    expect(announcementCoversPublication(covered)).toBe(true);
    expect(announcedBefore(covered)).toBe(false);
    // Send now records a time after the publication: still covered.
    expect(announcementCoversPublication({ resultsPublishedAt: first.toISOString(), resultsAnnouncedAt: republished.toISOString() })).toBe(true);
    // Partly delivered, unpublished, republished with the switch off.
    const stale = { resultsPublishedAt: republished, resultsAnnouncedAt: first };
    expect(announcementCoversPublication(stale)).toBe(false);
    expect(announcedBefore(stale)).toBe(true);
    expect(resultsAnnouncementState({ ...stale, emailEntrantsOnResults: false })).toBe("off");
    expect(resultsAnnouncementState({ ...stale, emailEntrantsOnResults: true })).toBe("ready");
    // Unpublished after an announcement that was kept.
    expect(announcedBefore({ resultsPublishedAt: null, resultsAnnouncedAt: first })).toBe(true);
    expect(announcedBefore({ resultsPublishedAt: null, resultsAnnouncedAt: null })).toBe(false);
    expect(announcementCoversPublication({ resultsPublishedAt: null, resultsAnnouncedAt: first })).toBe(false);
  });

  it("only count recipients when a dialog will show the count", () => {
    const at = new Date("2030-02-01T10:00:00.000Z");
    const later = new Date("2030-02-01T12:00:00.000Z");
    expect(needsAnnouncementCount({ emailEntrantsOnResults: false, resultsPublishedAt: null, resultsAnnouncedAt: null })).toBe(false);
    expect(needsAnnouncementCount({ emailEntrantsOnResults: false, resultsPublishedAt: at, resultsAnnouncedAt: null })).toBe(false);
    expect(needsAnnouncementCount({ emailEntrantsOnResults: true, resultsPublishedAt: at, resultsAnnouncedAt: at })).toBe(false);
    expect(needsAnnouncementCount({ emailEntrantsOnResults: true, resultsPublishedAt: null, resultsAnnouncedAt: null })).toBe(true);
    expect(needsAnnouncementCount({ emailEntrantsOnResults: true, resultsPublishedAt: at, resultsAnnouncedAt: null })).toBe(true);
    expect(needsAnnouncementCount({ emailEntrantsOnResults: true, resultsPublishedAt: later, resultsAnnouncedAt: at })).toBe(true);
  });

  it("refuse sending now unless results are published and the switch is on", () => {
    const now = new Date();
    expect(sendResultsAnnouncementRefusal({ submissionsEnabled: true, resultsPublishedAt: now, emailEntrantsOnResults: true })).toBeNull();
    expect(sendResultsAnnouncementRefusal({ submissionsEnabled: true, resultsPublishedAt: null, emailEntrantsOnResults: true })).toMatch(/Publish the results/);
    expect(sendResultsAnnouncementRefusal({ submissionsEnabled: true, resultsPublishedAt: now, emailEntrantsOnResults: false })).toMatch(/Turn on/);
    expect(sendResultsAnnouncementRefusal({ submissionsEnabled: false, resultsPublishedAt: now, emailEntrantsOnResults: true })).toMatch(/not taking project submissions/);
  });

  it("explain the effect in the publish and send dialogs", () => {
    expect(publishResultsEmailCopy(false, 12)).toBe("Results will be published without emailing entrants.");
    expect(publishResultsEmailCopy(true, 12)).toBe("12 entrants will be emailed.");
    expect(publishResultsEmailCopy(true, 1)).toBe("1 entrant will be emailed.");
    expect(publishResultsEmailCopy(true, 0)).toMatch(/^No entrants will be emailed/);
    expect(sendResultsEmailCopy(40)).toMatch(/^40 entrants will be emailed/);
    expect(sendResultsEmailCopy(40)).toMatch(/sending limits/);
    expect(publishedResultsEmailLine("unpublished")).toBeNull();
    expect(publishedResultsEmailLine("off")).toMatch(/weren't emailed/);
    expect(publishedResultsEmailLine("ready")).toMatch(/haven't been emailed/);
    expect(publishedResultsEmailLine("announced")).toMatch(/were emailed/);
    // After an earlier announcement, a zero count means everyone was already told.
    expect(publishResultsEmailCopy(true, 0)).toMatch(/no confirmed registrations/);
    expect(publishResultsEmailCopy(true, 0, true)).toMatch(/already emailed the results/);
    expect(publishResultsEmailCopy(true, 0, true)).not.toMatch(/no confirmed registrations/);
    expect(publishResultsEmailCopy(true, 3, true)).toBe("3 entrants will be emailed.");
    expect(sendResultsEmailCopy(0, true)).toMatch(/^No entrants will be emailed: everyone .* already emailed/);
    expect(sendResultsEmailCopy(0)).toMatch(/no confirmed registrations/);
    expect(publishedResultsEmailLine("off", true)).toMatch(/withdrawn hasn't been told/);
    expect(publishedResultsEmailLine("ready", true)).toMatch(/rest haven't been told/);
    expect(unpublishedResultsEmailLine(false)).toMatch(/won't email/);
    expect(unpublishedResultsEmailLine(true)).toMatch(/emails every confirmed entrant/);
  });
});

describe("judging settings validator: email switches", () => {
  it("keeps the saved value when the switches are left out", () => {
    const parsed = judgingSettingsSchema.parse(base);
    expect(parsed.emailEntrantsOnResults).toBeUndefined();
    expect(parsed.emailSubmissionReceipts).toBeUndefined();
  });

  it("accepts booleans and form values", () => {
    expect(judgingSettingsSchema.parse({ ...base, emailEntrantsOnResults: true, emailSubmissionReceipts: false })).toMatchObject({ emailEntrantsOnResults: true, emailSubmissionReceipts: false });
    expect(judgingSettingsSchema.parse({ ...base, emailEntrantsOnResults: "on", emailSubmissionReceipts: "" })).toMatchObject({ emailEntrantsOnResults: true, emailSubmissionReceipts: false });
    expect(judgingSettingsSchema.parse({ ...base, emailEntrantsOnResults: "false", emailSubmissionReceipts: null })).toMatchObject({ emailEntrantsOnResults: false, emailSubmissionReceipts: false });
  });

  it("rejects other values and unknown keys", () => {
    expect(judgingSettingsSchema.safeParse({ ...base, emailEntrantsOnResults: "yes" }).success).toBe(false);
    expect(judgingSettingsSchema.safeParse({ ...base, emailSubmissionReceipts: 1 }).success).toBe(false);
    expect(judgingSettingsSchema.safeParse({ ...base, emailEveryone: true }).success).toBe(false);
  });
});
