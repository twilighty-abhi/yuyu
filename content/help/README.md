# Writing the in-app guide

The guide at `/help` is built from the MDX files in this folder. This page is
for anyone adding or changing an article.

## Where things live

| File | Purpose |
| --- | --- |
| `manifest.ts` | Sections, article order, titles, one-line summaries, and who may read each section (`public`, `org-admin`, `super-admin`). |
| `<section>/<article>.mdx` | The article body. One file per manifest `slug`. |
| `screenshots.json` | Sizes of captured screens in `public/help/`. Written by the capture script; don't edit by hand. |
| `components/help/mdx.tsx` | How Markdown renders, and the components below. |
| `components/help/HelpLink.tsx` | "Help" links from app screens to an article. |

To add an article: add an entry to `manifest.ts`, create the `.mdx` file, and
run `npx vitest run tests/unit/help-content.test.ts`. The test checks that
every manifest entry has a file, every link and anchor resolves, and every
screenshot is known.

## Article shape

- Don't write a `#` title or a summary line. The page shows both from the manifest.
- Open with one or two sentences saying what the feature is for and when you'd use it.
- Use `##` for main sections (they make up "On this page") and `###` sparingly.
- Put the main task early, as numbered steps inside `<Steps>`.
- End with related links or edge cases ("Good to know"), not a summary.
- Aim for 300 to 900 words. Split the article if it grows much longer.

## Voice

- British English, matching the app: organisation, colour, cancelled, programme.
- Second person, plain words, short sentences. Write for a volunteer organiser,
  not a developer. Explain *why* when a rule might surprise people.
- Name buttons, tabs and fields exactly as the app shows them, in **bold**:
  "Open the **Guests** tab and choose **Approve**." Show menu paths with an
  arrow: "**Settings** → **Webhooks**".
- Describe what people can do, never how the code does it. No file names,
  database fields, environment variables or HTTP routes in public sections.
  Developer and instance sections may name endpoints, scopes and settings.
- Never put real-looking secrets, tokens, ticket codes or email addresses in
  examples. Use `ada@example.org` style addresses and obvious placeholders.
- Be exact about limits and rules (sizes, counts, who can do what). If you
  aren't sure the app behaves a certain way, check the code or leave it out.

## Components

```mdx
<Steps>

1. Open the event and choose the **Settings** tab.
2. Turn on **Submissions**.

</Steps>

<Callout kind="tip">Short, useful advice.</Callout>
<Callout kind="note">Background worth knowing.</Callout>
<Callout kind="warning">Something that can't be undone, or that surprises people.</Callout>
<Callout kind="permission">Owners and admins, and co-organisers with **Manage registrations**.</Callout>

<Screenshot name="event-dashboard-overview" alt="The event dashboard Overview tab with the readiness checklist" />

Press <Kbd>Enter</Kbd> to print.
```

Leave a blank line inside `<Steps>` and `<Callout>` around Markdown content.
Link to other articles with absolute paths, optionally with a section anchor:
`[Publishing](/help/events/publishing#who-can-find-it)`. Anchors are the
heading text in lower case with hyphens.

Screenshots are captured from a seeded local instance by
`tests/help-screenshots/capture.spec.ts`. Name a new screen, add a step for it
there, and re-run the capture. Until it is captured, development shows a
placeholder and production shows nothing.

## Capturing screenshots

The capture seeds fictional demo data (the "Riverside Tech Collective"), so
run it only against a **disposable**, migrated database: the seed deletes and
recreates its own organisations and users on every run.

```sh
HELP_SCREENS_SEED=1 \
HELP_SCREENS_DATABASE_URL=postgresql://localhost:5432/yuyu_help_screens \
  npm run help:screenshots
```

The seed refuses to run without `HELP_SCREENS_SEED=1`, when `NODE_ENV` is
`production`, or when the database is not on `localhost`, `127.0.0.1` or `::1`
(`tests/help-screenshots/guard.ts`). Nothing in CI, Docker or Helm runs it.

It starts `next dev` on port 3124 (`HELP_SCREENS_PORT` to change it), or
reuses a server already running there with the same settings, writes
`public/help/<name>.png`, updates `screenshots.json`, and clears queued email
so nothing is ever sent. The seed reads `MFA_ENCRYPTION_KEY` from your `.env`,
as the app does, to enrol the demo super-admin's authenticator.
