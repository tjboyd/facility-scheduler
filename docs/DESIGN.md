# Facility Scheduler — design spec

Status: **everything in this spec is built**, phones included. See §9a for the
screen-by-screen state and the README for how to run it.

**PDF for review:** [`facility-scheduler-mockups.pdf`](./facility-scheduler-mockups.pdf)
— one screen per landscape page, with a cover, contents and a caption on each.
Rebuild it with `python3 tools/build_review_pdf.py`.

**Clickable canvas:** <https://claude.ai/artifact/QJmBR8jyCiP981pYTkXd6x>
(private — share from the page's Share menu before sending it to anyone else).
Sources for those screens are in [`mockups/`](./mockups).

---

## 1. What this is

One indoor facility, one bookable space. Head coaches request blocks of time for
their team; a facility approver accepts or declines; the calendar is the shared
source of truth for who has the cage and turf time, and when.

One location, one bookable space — confirmed, not an assumption.

## 2. Roles

| Role | Sees the calendar | Requests time | Accepts / declines | Changes settings |
| --- | --- | --- | --- | --- |
| Head coach | yes | yes | no | no |
| Approver | yes | yes | yes | no |
| Super admin | yes | yes | yes | yes |

Roles are per person, set by a super admin. An approver does not have to be a
super admin, and a super admin does not have to be an approver — the list of
people who get request emails is its own setting.

## 3. Access control  ·  *built*

The people list **is** the access control. An email address that isn't on it
cannot sign in, even with a valid sign-in link.

- Super admins add addresses (one at a time or pasted in bulk), pick a role, and
  assign a team.
- Each address moves through `invited → active`, and can be set to
  `access removed` without deleting its booking history.
- Sign-in is passwordless: enter your email, get a one-time link (15-minute
  expiry). **That is the only way in** — see section 10.

## 4. Booking rules  ·  *built*

Defaults shown; every value is a super admin setting.

| Rule | Default |
| --- | --- |
| Block size | 30 minutes |
| Longest single request | 1.5 hours (3 blocks) |
| Shortest request | 1 block |
| How far ahead coaches can request | 4 weeks |
| Minimum notice | 24 hours before start |
| Approved bookings per team per week | 3 |
| Open pending requests per team | 2 |

A team can release a block **right up to its start time** — there is no cutoff.
Late notice is better than an empty facility. Blocks a team has *picked up* do
not count against its weekly limit either: that is time nobody else wanted.

Invariants that are *not* settings:

- **One team per block.** A block held by a pending or approved request is
  unavailable to everyone else. A pending request holds the slot — this is what
  stops two coaches requesting the same time and both being told yes.
- Requests must sit entirely inside that weekday's open hours and must not fall
  on a closure date.
- The picker never offers a start that nothing fits into, and once a start is
  chosen it offers only the lengths that fit before the next booking or closing
  time. Nothing is rejected after submission that could have been prevented
  before it — but the rules still run again on submit, because the picker is a
  convenience and not the enforcement.

## 5. Facility hours  ·  *built*

Per weekday (Sunday through Saturday): open/closed toggle plus an opening and
closing time, with a bar showing the week at a glance. A "copy to other days"
shortcut for the common "Monday–Friday are all the same" case was drawn but not
built — seven pairs of dropdowns on one form, saved in one go, turned out to be
quick enough that the shortcut earned nothing.

Sample configuration used in the mockups:

| Day | Hours |
| --- | --- |
| Sunday | 8:00 AM – 6:00 PM |
| Monday – Friday | 3:00 PM – 9:00 PM |
| Saturday | 8:00 AM – 8:00 PM |

**Closures** are dated overrides — holidays, tournaments, maintenance — that shut
the facility regardless of the weekly hours.

Changing hours does not retroactively cancel bookings that are already approved.
Approved bookings that fall outside the new hours stay put and are flagged to the
super admin — confirmed, see section 10.

## 5a. Assigned schedules, releasing and picking up  ·  *built*

Most of the facility's time is not requested — it is **assigned**. A super admin
gives a team a repeating block: *U9 - White, Saturdays 8:00–9:30, from today
through 30 April*. Assigned time needs no approval; the club has already decided.

**Setting up repeating time is the club's call, not a coach's.** Only super
admins can create or end a schedule — it is gated on the admin layout, on the
page, and on both server actions, so there is no route to it from a coach's
session. A coach's part of this is releasing dates their team won't use and
picking up what other teams have let go.

**Every date is written out as its own booking.** A series is stored as the rule
*and* its occurrences, because each occurrence has a life of its own: it can be
released, picked up by another team, or left alone. A rule evaluated on the fly
could not carry that state.

**8:00 AM Saturday is 8:00 AM all season**, before and after the daylight-saving
change. A block is stored as a calendar date plus minutes from midnight rather
than as an instant, which is what makes that hold.

**Clashing dates are skipped, not fatal.** One busy Saturday in October should
not stop the other thirty being assigned. The skipped dates are named back to
the admin. Where *every* date clashes, nothing is created and it says so.

**Assigned time is not held to the 1.5-hour cap.** That cap exists to stop one
coach hogging the request queue; a club can assign a team a three-hour block if
it wants to. It does still have to sit on the 30-minute grid.

### Release and pick up

| | |
| --- | --- |
| Who can release | The team holding the block, or a super admin on their behalf — clubs run on phone calls, and the admin is who gets them |
| What it does | The block goes back to the club and shows as **Available** on the calendar, saying which team let it go |
| Who can pick up | Any team with a head coach. **No approval** — it is time that would otherwise go empty |
| Order | First come, first served |
| Undo | None. Releasing is itself the undo; once released, the original team takes its chances like anyone else |

Two coaches tapping *Pick it up* at the same moment is a real race, so the claim
is a conditional update on the row still being released. Exactly one wins, and
the other is told plainly that another team got there first.

Ending a series removes its **upcoming** dates only. Past dates stay as history,
and so does anything already released or picked up — those are somebody else's
plans by the time you end the schedule.

## 6. Request lifecycle  ·  *built*

```
                   withdraw (coach)
                  ┌──────────────────────────► withdrawn
                  │
  [coach submits] ├──► pending ──► approved ──► completed
                  │       │            │
                  │       │            └──────► released (coach, any time before it starts)
                  │       └──► declined (approver, with a reason)
                  │
                  └──► rejected on the spot if the slot is taken or out of hours
```

- **pending** — slot is held, shown as a crimson dashed outline over stripes and
  labelled "Pending". The requesting team's name is visible to everyone.
- **approved** — solid crimson fill, team name in white. This is the
  "reserved / blocked" state.
- **declined** — the approver types a short reason; the coach sees it in email
  and in *My requests*, and the slot reopens immediately.
- **released** — a coach giving back a slot they hold; it reopens as first come,
  first served. **No email goes out**, for either the release or the pick-up:
  the calendar is the record. See 10a.2.

Approving from the email and approving from the Approvals queue do the same
thing. Whoever gets there first decides it; the second person sees it already
decided.

## 7. Notifications  ·  *built*

| Event | Goes to |
| --- | --- |
| New request | every address on the approver list |
| Approved | the requesting coach |
| Declined (with reason) | the requesting coach |
| Slot released by a coach | nobody — see 10a.2 |

Each approver chooses whether new requests email them, on the approvals screen
or, for the whole roster, on *Booking rules*. Muting is about email and not
access: a muted approver still sees every request in the queue. Somebody has to
stay listening, and the rule is checked against the state a save would produce
rather than per person changed — two approvers turned off in one save are each
harmless alone and fatal together.

Coach decision emails can be turned off on *Booking rules*, and each approver
chooses whether new requests email them at all. The daily-digest option in the
original spec was declined — see section 10.

**Transport: Postmark**, on a transactional message stream, sending from a
subdomain (`mail.<domain>`) so the scheduler's sending reputation is separate
from the club's everyday mail. The domain is configuration, not code — see the
README. Sending never rolls back the action that triggered it: the booking or
the invite is written first and emailed second, and a failure is reported rather
than thrown away.

**Approve is one click from the email — decided.** No sign-in, no app. The
button carries a *decision token*, built like the sign-in token and with the
same properties, plus two more:

- 256-bit random, stored only as a SHA-256 hash, single-use.
- **Bound to one request and to approving it** — it cannot decline, cannot touch
  another booking, and cannot be replayed.
- Dead the moment the request is decided by anyone, whichever route decided it,
  and expired once the slot has passed.
- The booking records that it was approved from the email and which approver's
  token was used, so the decision has a trail.

The residual risk, stated plainly: anyone who gets that email forwarded can
approve *that one request*. The mitigations above keep the blast radius to a
single booking that was already going to be approved or declined by somebody on
a short list, which for a club facility is a fair trade for approvers not having
to sign in on a phone at the field.

**Decline still opens the app**, because declining asks for a reason the coach
will read. The button deep-links to that request with the reason box ready.

## 8. Screens

| Screen | Who | What it does |
| --- | --- | --- |
| Sign in | everyone | Email → one-time link, nothing else on the page. Says plainly that access is by invitation. |
| Check your inbox | everyone | Confirmation, resend, and the "not on the list?" explanation. |
| Week calendar | coach | The main screen. Seven day columns, 30-minute rows, status blocks, empty slots are click targets. |
| Request time | coach | Page: team (fixed), date, start-time pills, length capped at 1.5 hrs, a summary naming the exact block, optional note. Built with the start and the length as *links* rather than form controls, so the server resolves the selection and can state the real end time — and so the screen works with JavaScript off. Times that are taken, or that can't fit any length, are simply not offered. |
| My requests | coach | Every request the team has made with its status, the approver's reason when declined, and withdraw / release actions. |
| Approvals | approver | One card per waiting request: team, when, the coach and their note, and an explicit clash check. Approve, or decline with a reason. Built as a single column rather than the drawn list-plus-detail — with a handful of requests at a time, the master/detail split was navigation for its own sake. |
| Notification emails | — | The approver's request email and the coach's decision email. |
| Phone day view | coach | The calendar as a list of slots for one day; open slots are tappable. **Built** as a responsive branch of the week calendar rather than a separate screen — same URL, same data, one rendering per width. |
| Phone request | coach | **Built** as the same request screen, stacked. It was drawn as a bottom sheet; a sheet needs JavaScript to open and this flow works without any, so it stays a page. The mockup's explanation of why a length does not fit was worth having and is now on both widths. |
| People & access | super admin | The allowlist: email, name, team, role, status, plus a bulk add panel. |
| Hours | super admin | Per-day open/closed and times with a visual week-at-a-glance bar, plus closures. |
| Booking rules | super admin | Block size, max length, timing limits, per-team limits, approver list, email options. |

## 9. Brand and visual language

The app uses the Jr Chargers Baseball brand as it is already applied in the
club's tryout, camp and registration materials — same palette, same typographic
treatment, so a screen and a printed check-in sheet look like the same
organisation.

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| Crimson | `#AD0303` | Primary actions, active nav, reserved blocks, accents |
| Black | `#0A0A0A` | Top bar, table headers, headings, primary text |
| Light grey | `#F5F5F5` | Page background, inset panels |
| White | `#FFFFFF` | Cards, inputs |
| Secondary text | `#555555` | Supporting copy |
| Muted text | `#767676` | Captions, hints (lightest usable on white at body size) |
| Border | `#CCCCCC` / `#DDDDDD` / `#EEEEEE` | Card, control, and row rules |
| Crimson on black | `#E05A5A` | Crimson text on the black bar, where `#AD0303` is too dark |

Squared-off geometry throughout: 3–4px radii on controls, 6px on cards. No soft
rounded corners.

### Type

| Face | Use |
| --- | --- |
| Barlow Condensed 600/700 | Wordmark, headings, team names, buttons, nav, table headers — uppercase with open letter-spacing |
| Barlow 400–700 | Body copy, form labels, table cells |
| IBM Plex Mono 400/500 | Times, block counts, numeric settings |

Barlow Condensed is the web equivalent of the condensed face the printed
materials use; the PDF generators substitute Liberation Sans Narrow for it.

### Status treatment

Everything is crimson, black, or grey — no green, no amber — so the three
booking states are told apart by **fill, outline, and texture** rather than hue,
and survive greyscale printing:

| State | Treatment |
| --- | --- |
| Reserved (approved) | Solid crimson fill, team name in white |
| Pending | Crimson dashed outline over diagonal crimson stripes, name in `#8A0202` |
| Closed | Grey diagonal hatch |
| Declined | Solid black chip |
| Completed | Flat grey chip |

Approve is the solid crimson button; Decline is a black outline. Two red buttons
side by side would be unreadable, so the hierarchy carries the meaning.

Every status also carries a text label, never colour alone.

### Logo and header

The club logo (`brand/jr-chargers-logo.png`) sits top-left on every screen, and
large above the card on sign-in.

The header bar is **white with a 3px crimson rule beneath it**, not black. The
logo's wordmark is black with a white keyline, so on a black bar the letterforms
lose their fill and collapse into outlines — tested and rejected. Black stays as
the accent it always was: table headers, the calendar's day-header row, the
modal title bars.

Nav on the white bar: the active item is a crimson block with white text, the
rest are `#555555`.

## 9a. What is built

| Area | State |
| --- | --- |
| Sign in by emailed link, allowlist enforced | built |
| People & access: invite, role, team, remove, restore | built |
| Teams: add, archive, restore | built |
| Week calendar | built |
| Assigned schedules, release, pick up | built |
| Ad-hoc requests and approvals | built |
| One-click approve from the approver's email | built |
| Facility hours and closures | built |
| Booking rules | built |
| Notification emails for requests and decisions | built |
| Phone layouts (day view, tab bar) | built |
| Per-approver email preferences | built |

Rules the built screens enforce that are worth knowing about:

- A head coach cannot be left without a team.
- The last super admin cannot be demoted or removed, and nobody can remove their
  own access. Locking everyone out is the one mistake this screen could make
  that the app could not undo.
- The request screen only offers starts and lengths that already pass every
  rule, and the *same* rules run again on submit — the picker is a convenience,
  never the enforcement.
- Approving re-checks for a clash first, because the request may have sat in an
  inbox while somebody else took the slot.
- Both decision routes end in one `decide()` and a conditional update guarded on
  `status = PENDING`, so two approvers arriving together produce one decision and
  the loser is told so.

### Phones, as built

The week grid is seven columns side by side, which is right on a laptop and
impossible at 390px. Rather than a second set of screens to keep in step, each
page carries one layout per width:

- **The calendar** becomes a single day as a list, with a week strip above it to
  change day. Free time is merged into runs — "Open · 1 hour" reads far better
  than a column of half-hours, and each run is a tap straight into the request
  screen with the day and start already filled in.
- **Navigation** moves to a fixed bottom bar, which is where a thumb reaches.
  Two tabs for a coach, four for a super admin.
- **The dense admin tables** — people and assigned schedules — keep their shape
  and scroll sideways inside their own card. Six columns that only mean anything
  together are worse torn into stacked cards, and this is the screen a volunteer
  opens once a season rather than at the field.

Both rules are measured by `tools/smoke-mobile.mjs` rather than eyeballed: no
page may scroll sideways, and nothing visible may end up behind the bottom bar.

### The one-click link, as built

The link is a route handler, not a page: it decides, then redirects to a result
screen. Two reasons. A page render is not allowed to have side effects — Next
refuses `revalidatePath` from one, and React may render a page twice or throw
the render away. And redirecting means the token never reaches the address bar,
the browser history, or an outbound `Referer` header.

## 10. Decisions made

- **One location, one bookable space.** Confirmed. The calendar, the conflict
  rules, and the data model all assume a single area. If cages or half-turf are
  ever booked separately, that is a schema change, not a display change.
- **Pending requests show the team name.** Confirmed. Other coaches see which
  team is holding a slot while it waits on the approver, not just that it's taken.
- **Hamilton Jr Chargers brand and logo throughout.** See section 9.
- **The team list is complete at 20.** SportsEngine's 21st row is an admin chat
  group, not a team.
- **Teams mirror SportsEngine**, names and all (`U12 - Red`, not `12U Red`), so
  the two systems line up. A team SportsEngine has as Inactive is seeded
  archived here: it keeps its history but cannot be assigned or booked against.
  15 active, 5 archived.
- **Approving from the email takes one click.** See section 7.
- **Only super admins set up repeating time.** Coaches release and pick up; they
  never define a schedule.
- **Admins define the facility's hours, and may assign time outside them.** An
  8:00 Saturday block is fine whether or not the coach-bookable window opens
  then — the club opens the building when it needs to.
- **No release cutoff, and no email when a released block is picked up.** Both
  were offered and both declined: the calendar is the record.
- **Picked-up blocks don't count against a team's weekly limit.**
- **One coach per team, one team per coach.** No coach runs two teams and no
  team has two head coaches both booking. The data model already matches the
  second half — a person carries a single team — so nothing changed. Note that
  the app does not *stop* a super admin putting two head coaches on one team;
  it is simply not a case the club has. Weekly limits are per team rather than
  per coach, so two would share one allowance rather than get two.
- **Hours changed under an approved booking: flag it, leave it.** A booking that
  falls outside the new hours stays as it is and is shown to the super admin,
  rather than being cancelled automatically. A block already in somebody's
  calendar is worth more than a tidy rule, and the admin can cancel the few that
  genuinely have to go.
- **One email per request, no daily digest.** Section 7 offered a digest; at
  club volume it would add a delay for no relief. An approver who finds the
  emails too much turns them off for themselves, which is built.
- **No Google sign-in.** The mockup offered it beside the email link and it was
  declined: the emailed link already works for any address, and adding an OAuth
  provider would mean a second way in to keep secure for no coach who could not
  already sign in. The mockup has been updated to match. The allowlist stays the
  only thing that decides who gets in.

## 10a. Still open

Two, neither blocking:

1. **Decline without a free alternative** — should declining suggest the nearest
   open slot of the same length? Today the coach is told why and left to look
   themselves.
2. **Nobody is emailed when a block is released.** Emailing on *pick-up* was
   offered and declined, on the grounds that the calendar is the record; the
   same reasoning was applied to the release itself, so neither sends. If
   released time turns out to go unnoticed and unused, a release email to the
   approvers is the smallest fix.

## 11. Not in scope yet

Payments, recurring/season-long bookings, waitlists, equipment or coach
assignment, public read-only calendar, calendar feed (ICS) subscriptions.
