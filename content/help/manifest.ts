/**
 * The in-app guide's table of contents (`/help`). Each article's body lives in
 * `content/help/<slug>.mdx`; titles, summaries and who may read it live here so
 * navigation, search and metadata never have to parse MDX.
 *
 * `access` gates whole sections: `public` is readable by anyone, `org-admin`
 * by owners and admins of any organisation, `super-admin` by the instance
 * super-admin only (lib/help/access.ts). It is a reading convenience, never an
 * authorization boundary for the features described.
 */

export type HelpAccess = "public" | "org-admin" | "super-admin";

export type HelpArticleEntry = {
  /** Path under /help and under content/help, e.g. "events/publishing". */
  slug: string;
  title: string;
  /** One sentence shown under the title, in lists and in search results. */
  summary: string;
};

export type HelpSectionEntry = {
  id: string;
  title: string;
  description: string;
  access: HelpAccess;
  articles: readonly HelpArticleEntry[];
};

export const helpSections = [
  {
    id: "getting-started",
    title: "Getting started",
    description: "What Yuyu is, the words it uses, and your first event from start to finish.",
    access: "public",
    articles: [
      { slug: "getting-started/welcome", title: "Welcome to Yuyu", summary: "What Yuyu does, who it is for, and how this guide is organised." },
      { slug: "getting-started/key-terms", title: "Key terms", summary: "Organisations, events, series, registrations, tickets and the other words used throughout Yuyu." },
      { slug: "getting-started/organiser-quick-start", title: "Run your first event", summary: "From a new account to a published event with guests checked in at the door." },
    ],
  },
  {
    id: "account",
    title: "Your account",
    description: "Signing in, keeping your account secure, and looking after your own data.",
    access: "public",
    articles: [
      { slug: "account/sign-up-and-sign-in", title: "Creating an account and signing in", summary: "Sign up with email or Google, verify your address, and sign in." },
      { slug: "account/forgotten-password", title: "Forgotten your password?", summary: "Reset your password with an emailed link." },
      { slug: "account/two-step-verification", title: "Two-step verification", summary: "Protect your account with an authenticator app and recovery codes." },
      { slug: "account/profile-and-security", title: "Profile, appearance and security", summary: "Change your name, photo and theme, see recent security activity, and sign out everywhere." },
      { slug: "account/your-data", title: "Your data and memberships", summary: "Download your personal data and leave organisations you no longer help run." },
    ],
  },
  {
    id: "attending",
    title: "Going to events",
    description: "For guests: finding events, registering, your ticket, teams, projects and certificates.",
    access: "public",
    articles: [
      { slug: "attending/finding-events", title: "Finding events", summary: "Discover, search, organisation pages and short links." },
      { slug: "attending/registering", title: "Registering for an event", summary: "Sign up as a guest or with an account, and what happens with approvals and waitlists." },
      { slug: "attending/your-ticket", title: "Your ticket", summary: "Open, download and use your QR ticket, add it to your calendar, or cancel." },
      { slug: "attending/teams", title: "Registering as a team", summary: "Create or join a team, register solo, find teammates, and manage your team page." },
      { slug: "attending/submitting-a-project", title: "Submitting a hackathon project", summary: "Draft, submit, edit and withdraw your team's or your own project." },
      { slug: "attending/feedback-and-certificates", title: "Feedback and certificates", summary: "Answer an event's feedback form and download your certificate." },
    ],
  },
  {
    id: "organisations",
    title: "Organisations and people",
    description: "Set up the group that runs your events and decide who can do what.",
    access: "public",
    articles: [
      { slug: "organisations/create", title: "Creating an organisation", summary: "Start the workspace your events live in." },
      { slug: "organisations/roles", title: "Roles and permissions", summary: "What owners, admins, members and co-organisers can each do." },
      { slug: "organisations/members", title: "Inviting and managing members", summary: "Invite people, change roles and remove members." },
      { slug: "organisations/co-organisers", title: "Event co-organisers", summary: "Give someone outside your organisation exact permissions on one event." },
      { slug: "organisations/settings", title: "Organisation settings", summary: "Name, address, logo, public page, and deleting an organisation." },
    ],
  },
  {
    id: "events",
    title: "Creating events",
    description: "Create, set up, publish and share events and recurring series.",
    access: "public",
    articles: [
      { slug: "events/create", title: "Creating an event", summary: "The three-step Create event dialog and what to do next." },
      { slug: "events/event-dashboard", title: "The event dashboard", summary: "A tour of the tabs you use to run an event." },
      { slug: "events/details", title: "Event details", summary: "Title, dates, time zone, location, online events, accent colour and cover." },
      { slug: "events/cover-photo", title: "The cover photo editor", summary: "Crop, straighten and adjust your cover before it goes live." },
      { slug: "events/publishing", title: "Publishing and visibility", summary: "Draft, Live and Offline; who can find the event; and sign-up rules." },
      { slug: "events/sharing", title: "Sharing your event", summary: "Event links, short links, social cards and the embeddable event card." },
      { slug: "events/clone-cancel-delete", title: "Cloning, cancelling and deleting", summary: "Reuse an event as a template, call one off, or remove it." },
      { slug: "events/recurring-series", title: "Recurring series", summary: "Weekly meetups and other repeating events, each date with its own guest list." },
    ],
  },
  {
    id: "event-page",
    title: "Event pages and programmes",
    description: "Build the public website for your event: sections, schedule, speakers and sponsors.",
    access: "public",
    articles: [
      { slug: "event-page/building-your-page", title: "Building your event page", summary: "Sections, highlights, venue, FAQs and resources." },
      { slug: "event-page/programme", title: "Building the programme", summary: "Tracks and sessions for a public schedule." },
      { slug: "event-page/live-delays", title: "Running late: live delays", summary: "Tell guests about delays on the day without editing every session." },
      { slug: "event-page/speakers-and-sponsors", title: "Speakers and sponsors", summary: "Speaker profiles and pages, and sponsors with their tiers." },
    ],
  },
  {
    id: "registration",
    title: "Registration",
    description: "Decide who can sign up, what you ask them, and how places are given out.",
    access: "public",
    articles: [
      { slug: "registration/form", title: "The registration form", summary: "Question types, settings, and questions that only show when needed." },
      { slug: "registration/capacity-and-waitlist", title: "Capacity, waitlists and approvals", summary: "Limit places, run a waitlist, approve each sign-up, and close registration." },
      { slug: "registration/invitations", title: "Invite-only events", summary: "Send invitations and keep an event to the people you choose." },
      { slug: "registration/team-registration", title: "Setting up team registration", summary: "Register people in teams for hackathons, jams and competitions." },
    ],
  },
  {
    id: "guests",
    title: "Guests and emails",
    description: "Manage your guest list, teams and exports, and email the people coming.",
    access: "public",
    articles: [
      { slug: "guests/guest-list", title: "The guest list", summary: "Statuses, approving and declining, adding guests by hand, and undo." },
      { slug: "guests/managing-teams", title: "Managing teams", summary: "Approve whole teams, move members and tidy up teams." },
      { slug: "guests/saved-views", title: "Filters and saved views", summary: "Filter long lists, save the views you use and share them with your team." },
      { slug: "guests/exports", title: "Exporting guest data", summary: "Download guests, teams and email addresses as CSV." },
      { slug: "guests/emailing-guests", title: "Emailing your guests", summary: "Templates, placeholders, designs, drafts, tests and sending." },
      { slug: "guests/automatic-emails", title: "Automatic emails", summary: "The emails Yuyu sends for you, and when." },
    ],
  },
  {
    id: "check-in",
    title: "Tickets and check-in",
    description: "Get guests through the door quickly, online or off, and print badges.",
    access: "public",
    articles: [
      { slug: "check-in/check-in-desk", title: "The check-in desk", summary: "Scan tickets, type codes or search by name, and undo mistakes." },
      { slug: "check-in/offline", title: "Checking in offline", summary: "Keep the door moving when the Wi-Fi drops." },
      { slug: "check-in/door-station", title: "The door station", summary: "A PIN-locked check-in page for volunteers without an account." },
      { slug: "check-in/check-in-lists", title: "Custom check-in lists", summary: "Track swag, meals and workshops alongside entry." },
      { slug: "check-in/badges", title: "Printing badges", summary: "Design name badges and print one after each check-in." },
    ],
  },
  {
    id: "hackathons",
    title: "Hackathons and judging",
    description: "Take project submissions, judge them against a rubric, and publish results.",
    access: "public",
    articles: [
      { slug: "hackathons/overview", title: "Running a hackathon", summary: "How submissions, judging and results fit together." },
      { slug: "hackathons/submissions", title: "Submissions and the gallery", summary: "The submission window, reviewing projects, and the public gallery." },
      { slug: "hackathons/judging", title: "Judges, rubric and scoring", summary: "Invite judges, build the rubric, and score projects." },
      { slug: "hackathons/progress", title: "Assigning judges and tracking progress", summary: "Spread projects across judges and spot reviews that need attention." },
      { slug: "hackathons/results", title: "Awards and results", summary: "Rank projects, give awards and publish the results page." },
    ],
  },
  {
    id: "after",
    title: "Feedback and reporting",
    description: "Hear from your guests, send certificates and see how the event went.",
    access: "public",
    articles: [
      { slug: "after/feedback", title: "Feedback forms", summary: "Collect anonymous or verified feedback after your event." },
      { slug: "after/certificates", title: "The certificate designer", summary: "Design certificates guests download after giving feedback." },
      { slug: "after/analytics", title: "Analytics", summary: "Your registration funnel and attendance at a glance." },
      { slug: "after/event-report", title: "The post-event report", summary: "A PDF summary of your event for sponsors, funders and your team." },
    ],
  },
  {
    id: "developers",
    title: "Connecting other tools",
    description: "For organisation owners and admins: the machine API and outgoing webhooks.",
    access: "org-admin",
    articles: [
      { slug: "developers/api", title: "The machine API", summary: "Read events and participant rosters from your own systems." },
      { slug: "developers/webhooks", title: "Webhooks", summary: "Get notified in other tools when guests register, check in and more." },
    ],
  },
  {
    id: "instance",
    title: "Instance administration",
    description: "For the person who runs this Yuyu server: the super-admin area.",
    access: "super-admin",
    articles: [
      { slug: "instance/super-admin-access", title: "The super-admin area", summary: "Who can open it and the extra verification step." },
      { slug: "instance/insights", title: "Overview and insights", summary: "Growth, activity, storage and support views across the instance." },
      { slug: "instance/settings", title: "Instance settings", summary: "Sign-ups, email delivery, Google sign-in, alerts and backup posture." },
      { slug: "instance/email-delivery", title: "Email delivery", summary: "How the outbox sends email, and what to do when it fails." },
      { slug: "instance/security-and-audit", title: "Security and the audit log", summary: "MFA adoption, API clients and the searchable record of important actions." },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    description: "Answers to common questions and fixes for common problems.",
    access: "public",
    articles: [
      { slug: "troubleshooting/faq", title: "Frequently asked questions", summary: "Quick answers for guests and organisers." },
      { slug: "troubleshooting/common-problems", title: "Common problems", summary: "Emails not arriving, tickets that won't scan, pages that won't load, and more." },
    ],
  },
] as const satisfies readonly HelpSectionEntry[];

export type HelpArticleSlug = (typeof helpSections)[number]["articles"][number]["slug"];
