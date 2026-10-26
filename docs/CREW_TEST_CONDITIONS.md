# Event crew: test conditions

[Documentation index](README.md) · [Event crew](CREW.md) · [Testing](TESTING.md)

The conditions an event-crew change must keep passing. Each row says what to
check, what should happen, and where it is automated:

- **U**: `tests/unit/crew.test.ts` (and the email/outbox unit tests)
- **I**: `tests/integration/crew.db.test.ts` (PostgreSQL)
- **E**: `tests/e2e/crew.spec.ts`
- **S**: `tests/e2e/crew-smoke.spec.ts` (organiser UI smoke)
- **M**: manual only

For a manual pass, use a published one-off event with a small capacity
(2 is enough) and a registration form, a second browser profile for the
public side, and the mock mailer (blank `SMTP_*`).

## 1. Adding and editing crew (Guests → Crew)

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| C-01 | Add a member with name, email, food, role, bio, photo, LinkedIn | Row appears with the food and "Not checked in"; a crew ticket email is queued ("You're on the crew for …") | I, S, U (email) |
| C-02 | Name or email missing, malformed email | Field error; nothing saved | U |
| C-03 | Name > 120, food > 80, role > 120, bio > 600 characters | Refused with a validation message | U |
| C-04 | LinkedIn not http(s), or not a URL (`linkedin.com/in/x`) | Validation message, no server error | U, S |
| C-05 | Photo: JPEG/PNG/WebP ≤ 5 MB | Uploaded, re-encoded to WebP, shown on the row and the public card | M |
| C-06 | Photo > 5 MB, non-image, or a pasted URL that is not an `event-crew` upload | Refused ("Choose an uploaded crew photo." / size message) | U (URL), M |
| C-07 | Same email twice on one event (any letter case) | "This email is already on the crew." | I, S |
| C-08 | Same email as crew on two different events | Allowed; each event has its own ticket | M |
| C-09 | Edit name/email/role | Row updates; a guest ticket's name and email follow; a changed email gets the ticket email (an unchanged one does not) | I, S |
| C-10 | Edit email to another crew member's, or to one already registered for the event | "This email is already on the crew." / "This email is already registered for this event." | I, M |
| C-11 | Move up/down | Order changes on the dashboard and the public section | I, S |
| C-12 | Show on event page off/on | Member leaves/joins the public section | I, S |
| C-13 | Remove (confirm) | Row, ticket and check-in removed; ticket link stops working; `registration.status_changed` CANCELLED webhook; removing it again says "Crew member not found." | I, S |
| C-16 | Many quick changes (show/hide a dozen times, reorder a whole crew) | No "Too many crew updates" (organiser actions use the dashboard budget, 180 a minute) | S |
| C-14 | 500 members on one event, then one more | The 501st is refused with the limit message | M |
| C-15 | Food summary | Groups case-insensitively ("Vegetarian" + "vegetarian" = 2), blanks as "Not given", most common first | U, S |

## 2. Existing registrations

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| R-01 | Organiser adds an email that has a CONFIRMED solo registration | Same ticket (QR unchanged) becomes the crew ticket and takes the crew name; its place is freed | I, S |
| R-02 | …that has a WAITLISTED or PENDING registration | Becomes a CONFIRMED crew ticket | I |
| R-03 | …that belongs to a team | Refused: remove them from the team first | I |
| R-04 | …that has a *Looking for a team* profile | Profile removed with the conversion | M |
| R-05 | A place freed by a conversion | The waitlist is **not** promoted automatically; the organiser promotes as usual | M |
| R-06 | A crew member later registers through the public form with the same email | "Already registered" (duplicate protection) | M |

## 3. Capacity and counts

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| N-01 | Capacity 1, two crew, then an attendee registers | Attendee CONFIRMED; the next attendee WAITLISTED | I, E |
| N-02 | TEAM event | Crew never count as units | I |
| N-03 | Public card "N going" | Includes crew; "spots left" and the progress bar count attendees only | E |
| N-04 | Public card on a TEAM event | "places taken" wording, crew not added | M |
| N-05 | `showRegistrationCount` off | No counts shown at all | M |
| N-06 | Dashboard overview "Going" | `places used / capacity` plus "+ N crew · M going" (or "incl. N crew" without a capacity) | S |
| N-07 | Analytics capacity, dashboard home fill, mobile `capacityUsed` | Exclude crew | M |
| N-08 | Lowering capacity below attendees + crew but not below attendees | Allowed (crew don't count) | M |

## 4. Crew sign-up link (`/crew/{token}`)

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| L-01 | Create link | Absolute URL shown with Copy; reopening the tab shows the same link | I, S |
| L-02 | Replace link | Old URL 404s immediately; new one works | I, S |
| L-03 | Turn off | URL 404s | I, S |
| L-04 | Unknown, short, or malformed token | Generic 404 (no event revealed) | U, E |
| L-05 | Headers | `Referrer-Policy: no-referrer`, noindex, `no-store`; `/crew/` disallowed in robots | E |
| L-06 | Page content | Only event title, organisation name and date | E |
| L-07 | Sign up with a new email | Success message; member exists **hidden** with "Joined via link"; ticket email queued | I, E |
| L-08 | Sign up again with the same email | Same success; no second member | I |
| L-09 | Sign up with an email already registered for the event | Same confirmation as everyone, which tells already-registered people to ask the organisers; **nothing changes** (only organisers convert) | I, E |
| L-10 | Event cancelled or ended | "No longer taking crew sign-ups"; nothing created | I |
| L-11 | Photo through the link | Uploaded into the event organisation's `event-crew` folder | M |
| L-12 | Repeated sign-ups/uploads from one IP | Rate-limited message | M |
| L-13 | Public form tries to set `showOnPage` | Rejected (strict schema) | U |

## 5. Public event page

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| P-01 | Event page → Sections | A **Crew** row exists, last, switched **off** by default | S |
| P-08 | Crew set to show while the section is off | Guests → Crew warns; with `EDIT_DETAILS`, **Turn on Crew section** switches it on and the public section appears; without it, the warning says who can | S, M |
| P-02 | Section off | No Crew section or nav item, whatever the members' visibility | E |
| P-03 | Section on, no visible members | No Crew section | E |
| P-04 | Section on, visible members | Crew section after Resources: photo, name, role, bio (3 lines), LinkedIn link | E, S |
| P-05 | Privacy | Page HTML never contains crew email, food preference or ticket token | I, E |
| P-06 | Unpublished / invite-only / preview page | Same rules as other sections; drafts never public | M |
| P-07 | Saving page settings from a tab opened before the update (9 sections) | Saves; the Crew setting is left as it was | M |

## 6. Ticket, email and check-in

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| T-01 | Crew ticket email | Subject "You're on the crew for {event}", crew wording, QR ticket | U |
| T-02 | Ticket page | "Crew" chip; no cancel button, team section or project card | S |
| T-03 | Account → Registrations (signed-in crew) | Listed; no cancel | M |
| T-04 | Check-in by QR/search at the desk | Checks in; Crew badge and "Crew food preference" shown | S |
| T-05 | Undo check-in | Works as for attendees | M |
| T-06 | Offline roster / venue station | Crew check in like attendees; known gap: no Crew chip offline (food line still shows) | M |
| T-07 | Badge printing and attendee CSV | Crew included as confirmed people | M |

## 7. Guest flows that must refuse crew

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| G-01 | Crew self-cancel (ticket page, account, mobile API) | Refused: ask an organiser | I |
| G-02 | Guests → People edit / remove on a crew row | Menu items hidden; the server refuses too | I, S |
| G-03 | Join a team by link, accept a team invite, organiser "Move to team" | Refused; RSVP stays team-less | I |
| G-04 | Hackathon: submit/draft a project, request a submission link | Refused; crew not in *Not submitted* | I |
| G-05 | Approve / reject / waitlist actions | Not offered (crew are always confirmed) | M |
| G-06 | Direct database write of an invalid crew ticket (team, non-confirmed, series) | `RSVP_crew_shape` CHECK rejects it | I |

## 8. Permissions and tenancy

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| A-01 | Owner, admin, or co-organiser with `MANAGE_REGISTRATIONS` | Can see and manage Guests → Crew | I |
| A-02 | Member without grants, `CHECK_IN`-only, `JUDGE`-only | No Crew tab content ("no permission"); every action refused | I |
| A-03 | Ids from another organisation | "Not found" for list, update, hide, reorder, remove, link | I |
| A-04 | Turning the public Crew section on | Needs page-editing rights (`EDIT_DETAILS`), like other sections | M |
| A-05 | Every mutation | Audited (`EVENT_CREW_*`), no email or token in audit metadata | M |
| A-06 | Organisation slug `crew` | Reserved | I |

## 9. Other surfaces

| ID | Condition | Expected | Covered |
| --- | --- | --- | --- |
| O-01 | Organisation webhooks | `registration.created` on a new crew ticket, `registration.status_changed` (CANCELLED) on removal | M |
| O-02 | Broadcast emails to confirmed guests | Crew receive them (they are confirmed) | M |
| O-03 | Feedback and certificates | Crew can give feedback and receive certificates like attendees | M |
| O-04 | Deleting the event | Crew, tickets and the link are removed with it | M |
| O-05 | Mobile app guest list | Crew appear as confirmed guests; mobile cancel/remove refused | M |
