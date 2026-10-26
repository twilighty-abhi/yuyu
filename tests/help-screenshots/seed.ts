import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import * as OTPAuth from "otpauth";
import {
  ContentVisibility,
  EventPageSectionType,
  EventPermission,
  EventPrivacyType,
  EventStatus,
  JudgingStatus,
  MembershipRole,
  RegistrationFieldType,
  RegistrationMode,
  RsvpStatus,
  SavedViewSurface,
  SoloPolicy,
  SponsorTier,
  SubmissionStatus,
  WebhookDeliveryStatus,
  type PrismaClient,
} from "@prisma/client";
import { assertDisposableDatabase } from "./guard";

/*
 * Demo data for the in-app guide's screenshots (tests/help-screenshots).
 * Everything is fictional and uses example.org addresses. The seed is
 * idempotent: it deletes its own organisations and users, then recreates
 * them, so it must only ever run against a disposable database.
 */

export const ORG_SLUG = "riverside-tech";
export const OTHER_ORG_SLUG = "northside-makers";
export const PASSWORD = "help-screens-demo-password";
export const SUPER_ADMIN_EMAIL = "root@example.org";

export const EMAILS = {
  owner: "ada@example.org",
  admin: "ben@example.org",
  member: "chloe@example.org",
  member2: "dev@example.org",
  coOrganiser: "femi@example.org",
  judge: "grace@example.org",
  judge2: "hiro@example.org",
  otherOwner: "nia@example.org",
  superAdmin: SUPER_ADMIN_EMAIL,
} as const;

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const TIMEZONE = "Europe/London";

export type SeedResult = Awaited<ReturnType<typeof seedHelpScreens>>;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const token = () => crypto.randomBytes(24).toString("base64url");
const guestKey = (email: string) => `guest:${email.toLowerCase()}`;

/** Same AES-256-GCM "v1" envelope as lib/mfa.ts (encryptMfaSecret), keyed by MFA_ENCRYPTION_KEY. */
function encryptWithKey(value: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function mfaKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be set (32-byte base64) to seed the super-admin.");
  return key;
}

/** lib/webhooks/secrets.ts derives its own key from MFA_ENCRYPTION_KEY. */
function webhookKey() {
  return Buffer.from(crypto.hkdfSync("sha256", mfaKey(), Buffer.alloc(0), "yuyu-org-webhook-signing-secret-v1", 32));
}

/** A TOTP generator for the seeded super-admin, matching lib/mfa.ts. */
export function superAdminTotp(secret: string) {
  return new OTPAuth.TOTP({ issuer: "Yuyu Events", label: SUPER_ADMIN_EMAIL, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}

/** Renders an SVG to the WebP derivative format the app stores. */
async function webp(svg: string, width: number, height: number) {
  return sharp(Buffer.from(svg)).resize(width, height).webp({ quality: 85 }).toBuffer();
}

async function storeImage(prisma: PrismaClient, organisationId: string, folder: string, svg: string, width: number, height: number) {
  const key = `organisations/${organisationId}/${folder}/${crypto.randomUUID()}.webp`;
  const data = await webp(svg, width, height);
  await prisma.asset.create({ data: { key, organisationId, contentType: "image/webp", byteSize: BigInt(data.length), provider: "database", fileData: new Uint8Array(data) } });
  return key;
}

const assetUrl = (key: string) => `/api/uploads/${key}`;

function avatarSvg(initials: string, colour: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${colour}"/><text x="128" y="160" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="700" fill="#ffffff" text-anchor="middle">${initials}</text></svg>`;
}

function logoSvg(colour: string, letter: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="56" fill="${colour}"/><path d="M40 170 Q88 130 128 170 T216 170" stroke="#ffffff" stroke-width="16" fill="none" stroke-linecap="round"/><text x="128" y="118" font-family="Helvetica, Arial, sans-serif" font-size="88" font-weight="800" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`;
}

function sponsorSvg(name: string, colour: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#ffffff"/><circle cx="96" cy="120" r="48" fill="${colour}"/><text x="168" y="138" font-family="Helvetica, Arial, sans-serif" font-size="52" font-weight="700" fill="#1f2937">${name}</text></svg>`;
}

function certificateSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1131" viewBox="0 0 1600 1131">
  <rect width="1600" height="1131" fill="#fbf8f1"/>
  <rect x="40" y="40" width="1520" height="1051" fill="none" stroke="#0f766e" stroke-width="14"/>
  <rect x="72" y="72" width="1456" height="987" fill="none" stroke="#d4a72c" stroke-width="4"/>
  <circle cx="800" cy="930" r="62" fill="#d4a72c"/>
  <circle cx="800" cy="930" r="46" fill="none" stroke="#fbf8f1" stroke-width="4"/>
  <path d="M120 140 L260 140 M1340 140 L1480 140 M120 990 L260 990 M1340 990 L1480 990" stroke="#0f766e" stroke-width="6"/>
</svg>`;
}

async function removeExisting(prisma: PrismaClient) {
  const demoEmails = await prisma.user.findMany({ where: { email: { endsWith: "@example.org" } }, select: { id: true, email: true } });
  const ids = demoEmails.filter((user) => user.email && (Object.values(EMAILS) as string[]).concat(attendeeEmails()).includes(user.email)).map((user) => user.id);
  // Audit rows outlive their organisation and actors, so remove the demo's own first.
  const orgs = await prisma.organisation.findMany({ where: { slug: { in: [ORG_SLUG, OTHER_ORG_SLUG] } }, select: { id: true, events: { select: { id: true } } } });
  const orgIds = orgs.map((org) => org.id);
  const targetIds = [...ids, ...orgs.flatMap((org) => org.events.map((event) => event.id))];
  await prisma.auditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: ids } }, { organisationId: { in: orgIds } }, { targetId: { in: targetIds } }] } });
  await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
  for (const id of ids) await prisma.asset.deleteMany({ where: { key: { startsWith: `users/${id}/` } } });
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const GUESTS = [
  { name: "Amara Okeke", status: RsvpStatus.CONFIRMED, checkedIn: true, dinner: "Yes", diet: "Vegetarian" },
  { name: "Bilal Hussain", status: RsvpStatus.CONFIRMED, checkedIn: true, dinner: "Yes", diet: "Halal" },
  { name: "Carys Morgan", status: RsvpStatus.CONFIRMED, checkedIn: true, dinner: "No" },
  { name: "Daniel Novak", status: RsvpStatus.CONFIRMED, checkedIn: true, dinner: "Yes", diet: "None" },
  { name: "Elif Demir", status: RsvpStatus.CONFIRMED, checkedIn: true, dinner: "Yes", diet: "Vegan" },
  { name: "Finn O'Brien", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "No" },
  { name: "Gabriela Santos", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "Yes", diet: "None" },
  { name: "Harper Lewis", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "Yes", diet: "Gluten free" },
  { name: "Isaac Mensah", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "No" },
  { name: "Jun Park", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "Yes", diet: "None" },
  { name: "Kavya Iyer", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "Yes", diet: "Vegetarian" },
  { name: "Liam Walsh", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "No" },
  { name: "Maya Cohen", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "Yes", diet: "None" },
  { name: "Noah Fischer", status: RsvpStatus.CONFIRMED, checkedIn: false, dinner: "Yes", diet: "Nut allergy" },
  { name: "Olivia Brown", status: RsvpStatus.WAITLISTED, checkedIn: false, dinner: "Yes", diet: "None" },
  { name: "Priya Shah", status: RsvpStatus.WAITLISTED, checkedIn: false, dinner: "No" },
  { name: "Quentin Moreau", status: RsvpStatus.WAITLISTED, checkedIn: false, dinner: "Yes", diet: "None" },
  { name: "Rosa Alvarez", status: RsvpStatus.PENDING_APPROVAL, checkedIn: false, dinner: "Yes", diet: "Vegetarian" },
  { name: "Sami Virtanen", status: RsvpStatus.PENDING_APPROVAL, checkedIn: false, dinner: "No" },
  { name: "Tomás Silva", status: RsvpStatus.PENDING_APPROVAL, checkedIn: false, dinner: "Yes", diet: "None" },
  { name: "Uma Patel", status: RsvpStatus.REJECTED, checkedIn: false, dinner: "No" },
  { name: "Victor Laine", status: RsvpStatus.REJECTED, checkedIn: false, dinner: "No" },
] as const;

const emailFor = (name: string) => `${name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".")}@example.org`;

function attendeeEmails() {
  return GUESTS.map((guest) => emailFor(guest.name));
}

export async function seedHelpScreens(prisma: PrismaClient) {
  assertDisposableDatabase();
  await removeExisting(prisma);
  const now = Date.now();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const verified = new Date(now - 90 * DAY);

  const user = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash, emailVerified: verified, createdAt: new Date(now - 80 * DAY) } });
  const owner = await user(EMAILS.owner, "Ada Owner");
  const admin = await user(EMAILS.admin, "Ben Okafor");
  const member = await user(EMAILS.member, "Chloe Martin");
  const member2 = await user(EMAILS.member2, "Dev Raman");
  const coOrganiser = await user(EMAILS.coOrganiser, "Femi Adeyemi");
  const judge = await user(EMAILS.judge, "Grace Liu");
  const judge2 = await user(EMAILS.judge2, "Hiro Tanaka");
  const otherOwner = await user(EMAILS.otherOwner, "Nia Roberts");
  const ownerPhoto = `users/${owner.id}/profile-images/${crypto.randomUUID()}.webp`;
  const ownerPhotoData = await webp(avatarSvg("AO", "#b45309"), 256, 256);
  await prisma.asset.create({ data: { key: ownerPhoto, contentType: "image/webp", byteSize: BigInt(ownerPhotoData.length), provider: "database", fileData: new Uint8Array(ownerPhotoData) } });
  await prisma.user.update({ where: { id: owner.id }, data: { profileImageUrl: assetUrl(ownerPhoto) } });

  // The super-admin has an authenticator enrolled; the capture computes codes from this seed.
  const mfaSecret = new OTPAuth.Secret({ size: 20 }).base32;
  const superAdmin = await prisma.user.create({
    data: {
      email: EMAILS.superAdmin,
      name: "Instance Admin",
      passwordHash,
      emailVerified: verified,
      mfaSecretEncrypted: encryptWithKey(mfaSecret, mfaKey()),
      mfaEnabledAt: new Date(now - 30 * DAY),
    },
  });

  /* ---------- Organisations ---------- */
  const org = await prisma.organisation.create({
    data: {
      name: "Riverside Tech Collective",
      slug: ORG_SLUG,
      description: "A volunteer-run community for people who build things with code in Riverside. Monthly meetups, workshops and a yearly hack weekend.",
      createdAt: new Date(now - 120 * DAY),
      memberships: {
        create: [
          { userId: owner.id, role: MembershipRole.OWNER },
          { userId: admin.id, role: MembershipRole.ADMIN },
          { userId: member.id, role: MembershipRole.MEMBER },
          { userId: member2.id, role: MembershipRole.MEMBER },
        ],
      },
    },
  });
  const logoKey = await storeImage(prisma, org.id, "organisation-logos", logoSvg("#0f766e", "R"), 256, 256);
  await prisma.organisation.update({ where: { id: org.id }, data: { logoUrl: assetUrl(logoKey) } });
  await prisma.organisationInvite.create({
    // An obviously fake link, since it shows (truncated) on the Members page.
    data: { organisationId: org.id, token: "example-invite-link", role: MembershipRole.MEMBER, createdByUserId: owner.id, expiresAt: new Date(now + 6 * DAY) },
  });

  const other = await prisma.organisation.create({
    data: {
      name: "Northside Makers",
      slug: OTHER_ORG_SLUG,
      description: "Hardware tinkerers and makers meeting every month.",
      memberships: { create: [{ userId: otherOwner.id, role: MembershipRole.OWNER }, { userId: owner.id, role: MembershipRole.MEMBER }] },
    },
  });

  /* ---------- Main event: published, public, full programme ---------- */
  const mainStart = new Date(now + 14 * DAY);
  mainStart.setUTCHours(17, 0, 0, 0);
  const mainEnd = new Date(mainStart.getTime() + 4 * HOUR);
  const main = await prisma.event.create({
    data: {
      organisationId: org.id,
      title: "Riverside Tech Night: Building for the Web",
      slug: "tech-night-web",
      description: "An evening of short talks, a hands-on workshop and pizza with Riverside's web developers. Everyone is welcome, from first-time coders to seasoned engineers.",
      tags: ["web", "meetup", "workshop"],
      startDateTime: mainStart,
      endDateTime: mainEnd,
      timezone: TIMEZONE,
      location: "Riverside Library, 12 Quay Street, Riverside",
      capacity: 100,
      registrationLeadMinutes: 120,
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      shortCode: "RvTech7",
      createdAt: new Date(now - 30 * DAY),
      page: {
        create: {
          isPublished: true,
          tagline: "Talks, a workshop and pizza for Riverside's web makers",
          accentColor: "#0f766e",
          aboutHtml: "<p>Join us for an evening of short talks and a hands-on workshop on building fast, accessible websites. Bring a laptop if you want to follow along.</p>",
          sections: {
            create: [
              EventPageSectionType.HERO,
              EventPageSectionType.ABOUT,
              EventPageSectionType.HIGHLIGHTS,
              EventPageSectionType.SCHEDULE,
              EventPageSectionType.SPEAKERS,
              EventPageSectionType.SPONSORS,
              EventPageSectionType.VENUE,
              EventPageSectionType.FAQ,
            ].map((type, sortOrder) => ({ type, sortOrder, isVisible: true })),
          },
        },
      },
      highlights: {
        create: [
          { title: "Three lightning talks", description: "Short, practical talks from local developers.", icon: "mic", visibility: ContentVisibility.PUBLISHED, sortOrder: 0 },
          { title: "Hands-on workshop", description: "Build an accessible form from scratch.", icon: "laptop", visibility: ContentVisibility.PUBLISHED, sortOrder: 1 },
          { title: "Pizza and networking", description: "Meet the Riverside tech community.", icon: "pizza", visibility: ContentVisibility.PUBLISHED, sortOrder: 2 },
        ],
      },
      faqs: {
        create: [
          { question: "Is the event free?", answerHtml: "<p>Yes. Registration is free, but places are limited.</p>", visibility: ContentVisibility.PUBLISHED, sortOrder: 0 },
          { question: "Do I need to bring a laptop?", answerHtml: "<p>Only for the workshop. The talks need nothing but curiosity.</p>", visibility: ContentVisibility.PUBLISHED, sortOrder: 1 },
          { question: "Is the venue accessible?", answerHtml: "<p>Yes, with step-free access and a hearing loop.</p>", visibility: ContentVisibility.PUBLISHED, sortOrder: 2 },
        ],
      },
      venue: {
        create: {
          name: "Riverside Library",
          address: "12 Quay Street",
          city: "Riverside",
          country: "United Kingdom",
          directions: "Enter through the main doors and take the lift to the first floor.",
          accessibilityInfo: "Step-free access and a hearing loop in the Main Hall.",
          visibility: ContentVisibility.PUBLISHED,
        },
      },
    },
  });

  const speakerColours = ["#0f766e", "#7c3aed", "#c2410c"];
  const speakerData = [
    { name: "Imogen Clarke", headline: "Front-end engineer", organisation: "Harbour Digital", initials: "IC" },
    { name: "Kwame Asante", headline: "Accessibility specialist", organisation: "Open Web Co-op", initials: "KA" },
    { name: "Lucía Romero", headline: "Performance engineer", organisation: "Riverside Council", initials: "LR" },
  ];
  const speakers = [];
  for (const [index, speaker] of speakerData.entries()) {
    const photo = await storeImage(prisma, org.id, "event-speakers", avatarSvg(speaker.initials, speakerColours[index]!), 256, 256);
    speakers.push(
      await prisma.eventSpeaker.create({
        data: {
          eventId: main.id,
          name: speaker.name,
          slug: speaker.name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/\s+/g, "-"),
          headline: speaker.headline,
          organisation: speaker.organisation,
          photoUrl: assetUrl(photo),
          bioHtml: `<p>${speaker.name} builds for the web and loves sharing what works.</p>`,
          visibility: ContentVisibility.PUBLISHED,
          sortOrder: index,
        },
      }),
    );
  }
  const sponsorData = [
    { name: "Harbour Digital", tier: SponsorTier.GOLD, colour: "#0ea5e9" },
    { name: "Quay Coffee", tier: SponsorTier.SILVER, colour: "#a16207" },
    { name: "Open Web Co-op", tier: SponsorTier.COMMUNITY_PARTNER, colour: "#16a34a" },
  ];
  for (const [index, sponsor] of sponsorData.entries()) {
    const logo = await storeImage(prisma, org.id, "event-sponsors", sponsorSvg(sponsor.name, sponsor.colour), 480, 240);
    await prisma.eventSponsor.create({
      data: { eventId: main.id, name: sponsor.name, tier: sponsor.tier, logoUrl: assetUrl(logo), websiteUrl: "https://example.org", visibility: ContentVisibility.PUBLISHED, sortOrder: index },
    });
  }

  // Two tracks; the Main Hall runs 15 minutes late from its second session.
  const mainHall = await prisma.eventScheduleTrack.create({ data: { eventId: main.id, name: "Main Hall", sortOrder: 0 } });
  const workshop = await prisma.eventScheduleTrack.create({ data: { eventId: main.id, name: "Workshop Room", sortOrder: 1 } });
  const at = (minutes: number) => new Date(mainStart.getTime() + minutes * MINUTE);
  const sessions = [
    { track: mainHall, title: "Welcome and introductions", type: "Talk", start: 0, end: 15, speakers: [] as number[] },
    { track: mainHall, title: "Shipping less JavaScript", type: "Talk", start: 15, end: 45, speakers: [2], delay: 15 },
    { track: mainHall, title: "Designing for screen readers", type: "Talk", start: 45, end: 75, speakers: [1] },
    { track: mainHall, title: "Community lightning talks", type: "Lightning talks", start: 75, end: 105, speakers: [] },
    { track: workshop, title: "Workshop: accessible forms", type: "Workshop", start: 30, end: 120, speakers: [0, 1] },
    { track: workshop, title: "Code review clinic", type: "Workshop", start: 120, end: 180, speakers: [0] },
    { track: mainHall, title: "Pizza and networking", type: "Break", start: 105, end: 180, speakers: [] },
  ];
  for (const [index, session] of sessions.entries()) {
    const created = await prisma.eventSession.create({
      data: {
        eventId: main.id,
        trackId: session.track.id,
        title: session.title,
        slug: session.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        type: session.type,
        startDateTime: at(session.start),
        endDateTime: at(session.end),
        delayMinutes: session.delay ?? 0,
        visibility: ContentVisibility.PUBLISHED,
        sortOrder: index,
        descriptionHtml: `<p>${session.title}.</p>`,
      },
    });
    for (const [order, speakerIndex] of session.speakers.entries()) {
      await prisma.eventSessionSpeaker.create({ data: { eventSessionId: created.id, speakerId: speakers[speakerIndex]!.id, sortOrder: order } });
    }
  }

  // Two registration questions; the second only shows when the first is "Yes".
  const form = await prisma.eventRegistrationForm.create({
    data: {
      eventId: main.id,
      fields: {
        create: [
          { key: "pizza_dinner", label: "Will you join us for pizza?", type: RegistrationFieldType.RADIO, required: true, sortOrder: 0, options: ["Yes", "No"] },
          {
            key: "dietary",
            label: "Any dietary requirements?",
            type: RegistrationFieldType.TEXT,
            required: false,
            sortOrder: 1,
            placeholder: "For example vegetarian or nut allergy",
            settings: { showIf: { fieldKey: "pizza_dinner", values: ["Yes"] } },
          },
        ],
      },
    },
    include: { fields: true },
  });
  const dinnerField = form.fields.find((field) => field.key === "pizza_dinner")!;
  const dietField = form.fields.find((field) => field.key === "dietary")!;

  const guestRsvps: { id: string; checkInToken: string; name: string; status: RsvpStatus; checkedIn: boolean }[] = [];
  for (const [index, guest] of GUESTS.entries()) {
    const email = emailFor(guest.name);
    const createdAt = new Date(now - (20 - index * 0.8) * DAY);
    const rsvp = await prisma.rSVP.create({
      data: {
        eventId: main.id,
        guestEmail: email,
        guestName: guest.name,
        attendeeKey: guestKey(email),
        status: guest.status,
        checkedInAt: guest.checkedIn ? new Date(now - 2 * HOUR + index * MINUTE) : null,
        createdAt,
        answers: {
          create: [
            { fieldId: dinnerField.id, valueText: guest.dinner },
            ...("diet" in guest && guest.diet ? [{ fieldId: dietField.id, valueText: guest.diet }] : []),
          ],
        },
      },
      select: { id: true, checkInToken: true },
    });
    if (guest.checkedIn) {
      await prisma.checkInEvent.create({ data: { rsvpId: rsvp.id, actorUserId: owner.id, action: "CHECKED_IN", source: "online", occurredAt: new Date(now - 2 * HOUR + index * MINUTE) } });
    }
    guestRsvps.push({ ...rsvp, name: guest.name, status: guest.status, checkedIn: guest.checkedIn });
  }

  for (const [index, email] of ["sophie.turner@example.org", "marcus.reid@example.org", "hana.sato@example.org", "oscar.nilsson@example.org"].entries()) {
    await prisma.eventInvite.create({ data: { eventId: main.id, email, createdAt: new Date(now - (4 - index) * DAY) } });
  }

  // One active co-organiser and one pending invitation.
  await prisma.eventCollaborator.create({
    data: { eventId: main.id, userId: coOrganiser.id, permissions: [EventPermission.EDIT_DETAILS, EventPermission.CHECK_IN, EventPermission.MANAGE_REGISTRATIONS] },
  });
  await prisma.eventCollaboratorInvite.create({
    data: {
      eventId: main.id,
      email: "gita.volunteer@example.org",
      tokenHash: sha256(token()),
      permissions: [EventPermission.CHECK_IN],
      createdByUserId: owner.id,
      expiresAt: new Date(now + 6 * DAY),
    },
  });

  // Saved views on Guests · People: one of Ada's own and one Ben shared.
  await prisma.savedView.createMany({
    data: [
      { organisationId: org.id, eventId: main.id, userId: owner.id, surface: SavedViewSurface.GUESTS_PEOPLE, name: "Going only", params: { status: "going" }, shared: false },
      { organisationId: org.id, eventId: main.id, userId: admin.id, surface: SavedViewSurface.GUESTS_PEOPLE, name: "Needs a decision", params: { status: "approve" }, shared: true },
    ],
  });

  // Custom check-in lists: Swag collection with some guests collected.
  const swag = await prisma.checkInList.create({ data: { eventId: main.id, name: "Swag collection", sortOrder: 0 } });
  await prisma.checkInList.create({ data: { eventId: main.id, name: "Pizza dinner", sortOrder: 1 } });
  for (const rsvp of guestRsvps.filter((guest) => guest.checkedIn).slice(0, 3)) {
    await prisma.checkInListRecord.create({ data: { listId: swag.id, rsvpId: rsvp.id, actorUserId: owner.id, source: "online" } });
    await prisma.checkInListEvent.create({ data: { listId: swag.id, rsvpId: rsvp.id, actorUserId: owner.id, action: "CHECKED_IN", source: "online" } });
  }

  /* ---------- Past event: analytics, feedback and certificates ---------- */
  const pastStart = new Date(now - 21 * DAY);
  pastStart.setUTCHours(17, 30, 0, 0);
  const past = await prisma.event.create({
    data: {
      organisationId: org.id,
      title: "Riverside Tech Night: September Edition",
      slug: "tech-night-september",
      description: "Talks on testing, design systems and open data.",
      tags: ["meetup"],
      startDateTime: pastStart,
      endDateTime: new Date(pastStart.getTime() + 3 * HOUR),
      timezone: TIMEZONE,
      location: "Riverside Library, 12 Quay Street, Riverside",
      capacity: 60,
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      createdAt: new Date(now - 50 * DAY),
      page: { create: { isPublished: true, accentColor: "#7c3aed", aboutHtml: "<p>Our September meetup.</p>" } },
    },
  });
  const pastNames = [
    "Aisha Bello", "Bruno Costa", "Clara Weber", "Dylan Hughes", "Esme Clarke", "Felix Wagner", "Greta Lind", "Hamza Ali", "Ines Duarte", "Jonas Berg",
    "Keira Doyle", "Leo Martin", "Mila Novak", "Nathan Price", "Ola Nordmann", "Pia Jensen", "Rami Haddad", "Sara Kim", "Theo Grant", "Una Byrne",
    "Vera Petrova", "Wes Turner", "Yara Haddad", "Zoe Evans", "Arlo Reed", "Bea Fox", "Cal Moss", "Dina Rossi", "Eli Stone", "Faye Hart",
    "Gus Vale", "Hope Lane",
  ];
  const pastRsvps: { id: string; name: string; checkedIn: boolean }[] = [];
  for (const [index, name] of pastNames.entries()) {
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.org`;
    // Sign-ups cluster after the announcement and again in the final week.
    const daysBefore = index < 12 ? 24 - index * 0.6 : index < 22 ? 14 - (index - 12) * 0.5 : 6 - (index - 22) * 0.5;
    const status = index < 28 ? RsvpStatus.CONFIRMED : index < 30 ? RsvpStatus.WAITLISTED : RsvpStatus.REJECTED;
    const checkedIn = status === RsvpStatus.CONFIRMED && index % 5 !== 3;
    const rsvp = await prisma.rSVP.create({
      data: {
        eventId: past.id,
        guestEmail: email,
        guestName: name,
        attendeeKey: guestKey(email),
        status,
        createdAt: new Date(pastStart.getTime() - daysBefore * DAY),
        checkedInAt: checkedIn ? new Date(pastStart.getTime() + (index % 40) * MINUTE) : null,
      },
      select: { id: true },
    });
    pastRsvps.push({ id: rsvp.id, name, checkedIn });
  }

  const certificateBackground = await storeImage(prisma, org.id, "certificate-backgrounds", certificateSvg(), 1600, 1131);
  const certificateTemplate = {
    version: 2,
    backgroundKey: certificateBackground,
    elements: [
      { id: "heading", type: "text", text: "Certificate of attendance", x: 10, y: 16, width: 80, height: 10, font: "serif", fontSize: 54, color: "#0f766e", bold: true, italic: false, uppercase: true, letterSpacing: 6, align: "center" },
      { id: "name", type: "text", text: "{{name}}", x: 10, y: 36, width: 80, height: 12, font: "serif", fontSize: 72, color: "#1f2937", bold: false, italic: true, uppercase: false, letterSpacing: 0, align: "center" },
      { id: "event", type: "text", text: "attended {{event}}", x: 10, y: 54, width: 80, height: 8, font: "sans", fontSize: 30, color: "#374151", bold: false, italic: false, uppercase: false, letterSpacing: 0, align: "center" },
      { id: "date", type: "text", text: "{{eventDate}} · {{organisation}}", x: 10, y: 64, width: 80, height: 6, font: "sans", fontSize: 22, color: "#6b7280", bold: false, italic: false, uppercase: false, letterSpacing: 2, align: "center" },
    ],
  };
  const feedbackForm = await prisma.eventFeedbackForm.create({
    data: {
      eventId: past.id,
      isOpen: true,
      title: "How was Tech Night?",
      thankYouMessage: "Thank you! Your certificate is ready to download.",
      certificateEnabled: true,
      certificateTemplate,
      fields: {
        create: [
          { key: "rating", label: "How would you rate the evening?", type: RegistrationFieldType.RADIO, required: true, sortOrder: 0, options: ["Excellent", "Good", "Okay", "Poor"] },
          { key: "favourite", label: "Which talk did you enjoy most?", type: RegistrationFieldType.SELECT, required: false, sortOrder: 1, options: ["Testing without tears", "Design systems at scale", "Open data for good"] },
          { key: "improve", label: "What could we do better?", type: RegistrationFieldType.TEXTAREA, required: false, sortOrder: 2 },
        ],
      },
    },
    include: { fields: true },
  });
  const feedbackAnswers = [
    ["Excellent", "Open data for good", "More time for questions, please."],
    ["Good", "Testing without tears", "A bigger room."],
    ["Excellent", "Design systems at scale", "Nothing, it was great."],
    ["Good", "Open data for good", "Vegan pizza options."],
    ["Okay", "Testing without tears", "Start a little later."],
  ];
  for (const [index, answers] of feedbackAnswers.entries()) {
    await prisma.eventFeedbackResponse.create({
      data: {
        formId: feedbackForm.id,
        rsvpId: pastRsvps.filter((rsvp) => rsvp.checkedIn)[index]!.id,
        certificateTemplate,
        submittedAt: new Date(pastStart.getTime() + (1 + index) * DAY),
        answers: {
          create: feedbackForm.fields.map((field, fieldIndex) => ({ fieldId: field.id, fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, valueText: answers[fieldIndex] })),
        },
      },
    });
  }

  /* ---------- Draft event for the readiness checklist ---------- */
  const draftStart = new Date(now + 45 * DAY);
  draftStart.setUTCHours(9, 0, 0, 0);
  const draft = await prisma.event.create({
    data: {
      organisationId: org.id,
      title: "Community Open Data Day",
      slug: "open-data-day",
      description: "A day of exploring Riverside's open data together.",
      tags: ["open data"],
      startDateTime: draftStart,
      endDateTime: new Date(draftStart.getTime() + 7 * HOUR),
      timezone: TIMEZONE,
      location: "Riverside Town Hall",
      capacity: 80,
      status: EventStatus.DRAFT,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: false } },
    },
  });

  /* ---------- Hackathon: team registration, submissions, judging ---------- */
  const hackStart = new Date(now - 3 * DAY);
  hackStart.setUTCHours(9, 0, 0, 0);
  const hackEnd = new Date(hackStart.getTime() + 33 * HOUR);
  const hack = await prisma.event.create({
    data: {
      organisationId: org.id,
      title: "Riverside Hack Weekend",
      slug: "hack-weekend",
      description: "Two days of building tools that help Riverside's community groups.",
      tags: ["hackathon"],
      startDateTime: hackStart,
      endDateTime: hackEnd,
      timezone: TIMEZONE,
      location: "Riverside Makerspace, 3 Mill Lane",
      capacity: 20,
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.APPROVAL_REQUIRED,
      listedPublicly: true,
      registrationMode: RegistrationMode.TEAM,
      teamMinSize: 2,
      teamMaxSize: 4,
      soloPolicy: SoloPolicy.SOLO_WITH_MATCHING,
      submissionsEnabled: true,
      submissionsOpenAt: new Date(hackStart.getTime() + 2 * HOUR),
      submissionsCloseAt: new Date(hackEnd.getTime() - HOUR),
      judgingStatus: JudgingStatus.OPEN,
      judgesSeeAll: true,
      reviewsPerProject: 3,
      createdAt: new Date(now - 60 * DAY),
      page: { create: { isPublished: true, accentColor: "#c2410c", aboutHtml: "<p>Form a team, build something useful, and show it to the judges.</p>" } },
    },
  });
  await prisma.eventCollaborator.createMany({
    data: [
      { eventId: hack.id, userId: judge.id, permissions: [EventPermission.JUDGE] },
      { eventId: hack.id, userId: judge2.id, permissions: [EventPermission.JUDGE] },
    ],
  });

  const teamData = [
    { name: "Byte Club", status: RsvpStatus.CONFIRMED, members: ["Ada Nwosu", "Ben Carter", "Cleo Park"], project: "FoodShare Finder", summary: "A map of community fridges and food banks with live opening times, built with open council data." },
    { name: "Night Owls", status: RsvpStatus.CONFIRMED, members: ["Dara Quinn", "Eoin Walsh", "Fatima Zahra", "Gil Mor"], project: "Volunteer Rota", summary: "A shared rota for volunteer groups that sends reminders and lets people swap shifts in two taps." },
    { name: "Pixel Pushers", status: RsvpStatus.CONFIRMED, members: ["Hana Ito", "Ivan Petrov"], project: "Accessible Bus Times", summary: "A high-contrast, screen-reader friendly view of Riverside bus departures." },
    { name: "Green Routes", status: RsvpStatus.CONFIRMED, members: ["Jade Moss", "Kofi Boateng", "Lena Vogel"], project: "Cycle Safe", summary: "Crowd-sourced reports of unsafe junctions for cyclists, shared with the council." },
    { name: "Team Lagom", status: RsvpStatus.PENDING_APPROVAL, members: ["Maja Berg", "Nils Ek"], project: null, summary: "" },
    { name: "Solo Sparks", status: RsvpStatus.PENDING_APPROVAL, members: ["Omar Haddad"], project: null, summary: "" },
  ];
  const submissions: { id: string; title: string }[] = [];
  for (const [index, entry] of teamData.entries()) {
    const team = await prisma.team.create({
      data: {
        eventId: hack.id,
        name: entry.name,
        nameKey: entry.name.toLowerCase(),
        status: entry.status,
        joinToken: token(),
        manageTokenHash: sha256(token()),
        lookingForMembers: entry.members.length < 2,
        createdAt: new Date(now - (30 - index) * DAY),
      },
    });
    let leaderId: string | null = null;
    for (const [memberIndex, name] of entry.members.entries()) {
      const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.org`;
      const rsvp = await prisma.rSVP.create({
        data: {
          eventId: hack.id,
          teamId: team.id,
          guestEmail: email,
          guestName: name,
          attendeeKey: guestKey(email),
          status: entry.status,
          createdAt: new Date(now - (30 - index) * DAY + memberIndex * HOUR),
          checkedInAt: entry.status === RsvpStatus.CONFIRMED ? new Date(hackStart.getTime() + (index * 4 + memberIndex) * MINUTE) : null,
        },
      });
      leaderId ??= rsvp.id;
    }
    await prisma.team.update({ where: { id: team.id }, data: { leaderRsvpId: leaderId } });
    if (entry.project) {
      const submission = await prisma.submission.create({
        data: {
          eventId: hack.id,
          teamId: team.id,
          title: entry.project,
          summary: entry.summary,
          repoUrl: `https://example.org/${entry.name.toLowerCase().replace(/\s+/g, "-")}/code`,
          demoUrl: `https://example.org/${entry.name.toLowerCase().replace(/\s+/g, "-")}/demo`,
          status: SubmissionStatus.SUBMITTED,
          submittedAt: new Date(hackEnd.getTime() - (5 - index) * HOUR),
        },
      });
      submissions.push({ id: submission.id, title: submission.title });
    }
  }
  // A solo registrant who is still drafting their project.
  const soloEmail = "petra.solo@example.org";
  const solo = await prisma.rSVP.create({
    data: { eventId: hack.id, guestEmail: soloEmail, guestName: "Petra Novak", attendeeKey: guestKey(soloEmail), status: RsvpStatus.CONFIRMED, createdAt: new Date(now - 20 * DAY) },
  });
  await prisma.submission.create({ data: { eventId: hack.id, rsvpId: solo.id, title: "Library Seat Finder", summary: "Work in progress.", status: SubmissionStatus.DRAFT } });

  const criteria = [];
  for (const [position, criterion] of [
    { name: "Impact", description: "How much will this help Riverside's community groups?", weight: 3, maxScore: 10 },
    { name: "Technical execution", description: "Does it work, and is it well built?", weight: 2, maxScore: 10 },
    { name: "Presentation", description: "How clearly did the team explain the idea?", weight: 1, maxScore: 5 },
  ].entries()) {
    criteria.push(await prisma.judgingCriterion.create({ data: { eventId: hack.id, ...criterion, position } }));
  }

  // Reviews: Byte Club and Night Owls have three, Pixel Pushers one, Green Routes none.
  const reviewPlan: [number, string, number[], string][] = [
    [0, owner.id, [9, 8, 4], "Clear real-world need."],
    [0, judge.id, [8, 7, 5], "Lovely demo."],
    [0, judge2.id, [9, 6, 4], "Would like to see offline support."],
    [1, owner.id, [8, 9, 4], "Polished and easy to use."],
    [1, judge.id, [7, 9, 3], "Great technical work."],
    [1, judge2.id, [7, 8, 4], "Solid."],
    [2, judge.id, [6, 7, 5], "Very accessible design."],
  ];
  for (const [submissionIndex, judgeId, scores, comment] of reviewPlan) {
    const submissionId = submissions[submissionIndex]!.id;
    for (const [criterionIndex, score] of scores.entries()) {
      await prisma.judgeScore.create({ data: { submissionId, judgeUserId: judgeId, criterionId: criteria[criterionIndex]!.id, score } });
    }
    await prisma.judgeReview.create({ data: { submissionId, judgeUserId: judgeId, comment, submittedAt: new Date(now - 6 * HOUR) } });
  }
  await prisma.eventAward.create({ data: { eventId: hack.id, name: "Overall winner", description: "The project the judges scored highest.", position: 0 } });
  await prisma.eventAward.create({ data: { eventId: hack.id, name: "Best community impact", description: "The project most likely to help local groups.", position: 1 } });
  await prisma.eventAward.create({ data: { eventId: hack.id, name: "Best newcomers", description: "For a team taking part for the first time.", position: 2 } });

  /* ---------- More public events for Discover ---------- */
  const discoverEvents = [
    { title: "Intro to Python for Beginners", slug: "python-beginners", days: 5, tags: ["python", "workshop"], location: "Riverside Library" },
    { title: "Design Systems Meetup", slug: "design-systems", days: 9, tags: ["design"], location: "Harbour Studios" },
    { title: "Women in Tech Breakfast", slug: "women-in-tech-breakfast", days: 17, tags: ["community"], location: "Quay Coffee" },
  ];
  for (const item of discoverEvents) {
    const start = new Date(now + item.days * DAY);
    start.setUTCHours(18, 0, 0, 0);
    await prisma.event.create({
      data: {
        organisationId: org.id, title: item.title, slug: item.slug, description: `${item.title} with the Riverside Tech Collective.`, tags: item.tags,
        startDateTime: start, endDateTime: new Date(start.getTime() + 2 * HOUR), timezone: TIMEZONE, location: item.location, capacity: 40,
        status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.PUBLIC, page: { create: { isPublished: true, accentColor: "#0f766e" } },
      },
    });
  }
  const repairStart = new Date(now + 11 * DAY);
  repairStart.setUTCHours(10, 0, 0, 0);
  await prisma.event.create({
    data: {
      organisationId: other.id, title: "Repair Café: Fix Your Gadgets", slug: "repair-cafe", description: "Bring broken electronics and fix them with help from volunteers.", tags: ["hardware", "repair"],
      startDateTime: repairStart, endDateTime: new Date(repairStart.getTime() + 4 * HOUR), timezone: TIMEZONE, location: "Northside Community Centre", capacity: 30,
      status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.PUBLIC, page: { create: { isPublished: true, accentColor: "#b45309" } },
    },
  });

  /* ---------- A recurring series ---------- */
  // Weekly on Thursdays, starting with the next one.
  const seriesStart = new Date(now + ((4 - new Date(now).getUTCDay() + 7) % 7 || 7) * DAY);
  seriesStart.setUTCHours(18, 0, 0, 0);
  const stamp = seriesStart.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const series = await prisma.eventSeries.create({
    data: {
      organisationId: org.id, title: "Thursday Code Club", slug: "code-club", description: "A relaxed weekly session to work on your own projects with friendly help.",
      recurrenceRule: `DTSTART:${stamp}\nRRULE:FREQ=WEEKLY;COUNT=4`, instanceDurationMs: 2 * HOUR, timezone: TIMEZONE, privacyType: EventPrivacyType.PUBLIC, capacity: 25, status: EventStatus.PUBLISHED,
    },
  });
  for (let week = 0; week < 4; week++) {
    const start = new Date(seriesStart.getTime() + week * 7 * DAY);
    await prisma.eventInstance.create({ data: { eventSeriesId: series.id, startDateTime: start, endDateTime: new Date(start.getTime() + 2 * HOUR) } });
  }

  /* ---------- Developer settings: API client and webhooks ---------- */
  const apiClient = await prisma.apiClient.create({
    data: {
      organisationId: org.id,
      name: "Attendance sync",
      scopes: { create: [{ scope: "events:read" }, { scope: "participants:read" }, { scope: "participants:attendance:read" }] },
      credentials: { create: { name: "Production", secretHash: crypto.randomBytes(32), lastUsedAt: new Date(now - 3 * HOUR), expiresAt: new Date(now + 180 * DAY) } },
    },
  });
  const webhookSecret = () => encryptWithKey(`whsec_${crypto.randomBytes(24).toString("base64url")}`, webhookKey());
  const crm = await prisma.webhookEndpoint.create({
    data: {
      organisationId: org.id, url: "https://hooks.example.org/yuyu/registrations", description: "Members CRM",
      eventTypes: ["registration.created", "registration.status_changed"], secretEncrypted: webhookSecret(), lastSuccessAt: new Date(now - 40 * MINUTE), createdByUserId: owner.id,
    },
  });
  await prisma.webhookDelivery.create({
    data: {
      endpointId: crm.id, organisationId: org.id, eventId: `evt_${crypto.randomBytes(12).toString("hex")}`, eventType: "registration.created", payload: { type: "registration.created" },
      status: WebhookDeliveryStatus.SUCCEEDED, attempts: 1, lastAttemptAt: new Date(now - 40 * MINUTE), deliveredAt: new Date(now - 40 * MINUTE), lastStatusCode: 200, responseTimeMs: 182,
    },
  });
  await prisma.webhookEndpoint.create({
    data: {
      organisationId: org.id, url: "https://hooks.example.org/yuyu/door-display", description: "Door display",
      eventTypes: ["checkin.created", "checkin.undone"], secretEncrypted: webhookSecret(), enabled: false, disabledReason: "auto_disabled", disabledAt: new Date(now - 2 * DAY),
      consecutiveFailures: 20, lastFailureAt: new Date(now - 2 * DAY), lastSuccessAt: new Date(now - 9 * DAY), createdByUserId: admin.id,
    },
  });

  /* ---------- Instance settings and audit history for the super-admin pages ---------- */
  await prisma.instanceSetting.upsert({
    where: { id: "global" },
    create: { id: "global", emailFrom: "Riverside Events <events@example.org>", smtpHost: "smtp.example.test", smtpPort: 587, smtpUser: "yuyu", backupProvider: "Managed PostgreSQL snapshots", backupLastSuccessAt: new Date(now - 7 * HOUR), backupRetentionDays: 30 },
    update: { emailFrom: "Riverside Events <events@example.org>", smtpHost: "smtp.example.test", smtpPort: 587, smtpUser: "yuyu", backupProvider: "Managed PostgreSQL snapshots", backupLastSuccessAt: new Date(now - 7 * HOUR), backupRetentionDays: 30 },
  });
  const audit = [
    ["MFA_ENABLED", superAdmin.id, 12],
    ["ORGANISATION_INVITE_CREATED", owner.id, 5],
    ["ORGANISATION_INVITE_ACCEPTED", member2.id, 4],
    ["MEMBERSHIP_ROLE_CHANGED", owner.id, 4],
    ["API_CLIENT_CREATED", owner.id, 3],
    ["API_CREDENTIAL_CREATED", owner.id, 3],
    ["SUPER_ADMIN_MFA_VERIFIED", superAdmin.id, 1],
  ] as const;
  for (const [action, actorUserId, daysAgo] of audit) {
    await prisma.auditEvent.create({ data: { action, actorUserId, organisationId: org.id, createdAt: new Date(now - daysAgo * DAY) } });
  }

  return {
    org,
    other,
    owner,
    admin,
    judge,
    superAdmin,
    mfaSecret,
    events: { main, past, draft, hack },
    series,
    apiClient,
    ticketToken: guestRsvps.find((guest) => guest.status === RsvpStatus.CONFIRMED && !guest.checkedIn)!.checkInToken,
    submissions,
  };
}
