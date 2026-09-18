# Facility Scheduler — design spec

Status: **people & access is built; the calendar and booking are not.**
See the README for what works today.

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
  expiry). Google sign-in is shown as a second option — still open, see 10a.1.

## 4. Booking rules

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
| Coach can release an approved slot until | 12 hours before start |

Invariants that are *not* settings:

- **One team per block.** A block held by a pending or approved request is
  unavailable to everyone else. A pending request holds the slot — this is what
  stops two coaches requesting the same time and both being told yes.
- Requests must sit entirely inside that weekday's open hours and must not fall
  on a closure date.
- Start times that can't fit the selected length are disabled in the picker
  rather than rejected after submission.

## 5. Facility hours

Per weekday (Sunday through Saturday): open/closed toggle plus an opening and
closing time. A "copy to other days" action handles the common
"Monday–Friday are all the same" case.

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
super admin — still open, see 10a.3.

## 6. Request lifecycle

```
                   withdraw (coach)
                  ┌──────────────────────────► withdrawn
                  │
  [coach submits] ├──► pending ──► approved ──► completed
                  │       │            │
                  │       │            └──────► released (coach, before cutoff)
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
- **released** — a coach giving back an approved slot; it reopens and the
  approver is notified.

Approving from the email and approving from the Approvals queue do the same
thing. Whoever gets there first decides it; the second person sees it already
decided.

## 7. Notifications

| Event | Goes to |
| --- | --- |
| New request | every address on the approver list |
| Approved | the requesting coach |
| Declined (with reason) | the requesting coach |
| Slot released by a coach | the approver list |

Options: one email per request or a daily digest; coach decision emails can be
turned off. Approval/decline buttons in the email are deep links into the app.

## 8. Screens

| Screen | Who | What it does |
| --- | --- | --- |
| Sign in | everyone | Email → one-time link, nothing else on the page. Says plainly that access is by invitation. |
| Check your inbox | everyone | Confirmation, resend, and the "not on the list?" explanation. |
| Week calendar | coach | The main screen. Seven day columns, 30-minute rows, status blocks, empty slots are click targets. |
| Request time | coach | Modal: team (fixed), date, start-time pills with taken times struck out, length segmented control capped at 1.5 hrs, live summary, optional note. |
| My requests | coach | Every request the team has made with its status, the approver's reason when declined, and withdraw / release actions. |
| Approvals | approver | Queue on the left, full detail on the right: who, when, the coach's note, an explicit no-conflicts check, and a strip of the rest of that day. Approve / Decline. |
| Notification emails | — | The approver's request email and the coach's decision email. |
| Phone day view | coach | The calendar as a list of slots for one day; open slots are tappable. |
| Phone request sheet | coach | The same request flow as a bottom sheet, with lengths that don't fit disabled and explained. |
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
| Week calendar, requests, approvals | designed, not built |
| Facility hours, booking rules | designed, not built |
| Notification emails for requests | designed, not built |

Two rules the built screens enforce that are worth knowing about:

- A head coach cannot be left without a team.
- The last super admin cannot be demoted or removed, and nobody can remove their
  own access. Locking everyone out is the one mistake this screen could make
  that the app could not undo.

## 10. Decisions made

- **One location, one bookable space.** Confirmed. The calendar, the conflict
  rules, and the data model all assume a single area. If cages or half-turf are
  ever booked separately, that is a schema change, not a display change.
- **Pending requests show the team name.** Confirmed. Other coaches see which
  team is holding a slot while it waits on the approver, not just that it's taken.
- **Hamilton Jr Chargers brand and logo throughout.** See section 9.

## 10a. Still open

1. **Google sign-in** — the mockup shows it next to the email link. Worth it, or
   is the magic link enough? It only matters if coaches' club emails are Google
   accounts.
2. **Teams** — a coach is currently tied to exactly one team. Does any coach run
   two teams, or does a team ever have two head coaches who both book?
3. **Hours changed under an approved booking** — flag it to the admin and leave
   it, or auto-cancel and notify the coach? The spec currently says flag.
4. **Decline without a free alternative** — should declining suggest the nearest
   open slot of the same length?
5. **Team list** — mockups use 8U / 10U / 12U Red / 12U Black / 13U / 14U as
   sample data. The real roster of teams needs confirming.

## 11. Not in scope yet

Payments, recurring/season-long bookings, waitlists, equipment or coach
assignment, public read-only calendar, calendar feed (ICS) subscriptions.
