# Facility Scheduler — design spec

Status: **for review, nothing implemented yet.**

Interactive mockups: <https://claude.ai/artifact/QJmBR8jyCiP981pYTkXd6x>
(private — share from the page's Share menu before sending it to anyone else).
Sources for those screens are in [`mockups/`](./mockups).

---

## 1. What this is

One indoor facility, one bookable space. Head coaches request blocks of time for
their team; a facility approver accepts or declines; the calendar is the shared
source of truth for who has the turf and when.

## 2. Roles

| Role | Sees the calendar | Requests time | Accepts / declines | Changes settings |
| --- | --- | --- | --- | --- |
| Head coach | yes | yes | no | no |
| Approver | yes | yes | yes | no |
| Super admin | yes | yes | yes | yes |

Roles are per person, set by a super admin. An approver does not have to be a
super admin, and a super admin does not have to be an approver — the list of
people who get request emails is its own setting.

## 3. Access control

The people list **is** the access control. An email address that isn't on it
cannot sign in, even with a valid sign-in link.

- Super admins add addresses (one at a time or pasted in bulk), pick a role, and
  assign a team.
- Each address moves through `invited → active`, and can be set to
  `access removed` without deleting its booking history.
- Sign-in is passwordless: enter your email, get a one-time link (15-minute
  expiry). Google sign-in is shown as a second option — see open question Q1.

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

**Closures** are dated overrides — holidays, tournaments, floor work — that shut
the facility regardless of the weekly hours.

Changing hours does not retroactively cancel bookings that are already approved.
Approved bookings that fall outside the new hours stay put and are flagged to the
super admin (see open question Q4).

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

- **pending** — slot is held, shown amber and dashed on the calendar, labelled
  "Pending". The team name is visible (see open question Q3).
- **approved** — shown solid green, labelled with the team name. This is the
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
| Sign in | everyone | Email → one-time link. Says plainly that access is by invitation. |
| Check your inbox | everyone | Confirmation, resend, and the "not on the list?" explanation. |
| Week calendar | coach | The main screen. Seven day columns, 30-minute rows, status-coloured blocks, empty slots are click targets. |
| Request time | coach | Modal: team (fixed), date, start-time pills with taken times struck out, length segmented control capped at 1.5 hrs, live summary, optional note. |
| My requests | coach | Every request the team has made with its status, the approver's reason when declined, and withdraw / release actions. |
| Approvals | approver | Queue on the left, full detail on the right: who, when, the coach's note, an explicit no-conflicts check, and a strip of the rest of that day. Approve / Decline. |
| Notification emails | — | The approver's request email and the coach's decision email. |
| Phone day view | coach | The calendar as a list of slots for one day; open slots are tappable. |
| Phone request sheet | coach | The same request flow as a bottom sheet, with lengths that don't fit disabled and explained. |
| People & access | super admin | The allowlist: email, name, team, role, status, plus a bulk add panel. |
| Hours | super admin | Per-day open/closed and times with a visual week-at-a-glance bar, plus closures. |
| Booking rules | super admin | Block size, max length, timing limits, per-team limits, approver list, email options. |

## 9. Visual language

- **Green, solid** — reserved / approved.
- **Amber, dashed** — pending. Dashed on purpose: it reads as "not settled yet"
  even in greyscale or for anyone who can't separate the two hues.
- **Hatched grey** — closed.
- Type: Archivo for headings, Public Sans for body, IBM Plex Mono for times.
- Every status is carried by a text label as well as a colour.

## 10. Open questions

1. **Google sign-in** — the mockup shows it next to the email link. Worth it, or
   is the magic link enough? It only matters if coaches' emails are Google
   accounts.
2. **Teams** — a coach is currently tied to exactly one team. Does any coach run
   two teams, or does a team ever have two head coaches who both book?
3. **Pending visibility** — should other coaches see *which* team has a pending
   request, or just that the slot is held? Showing the name is friendlier;
   hiding it avoids sniping.
4. **Hours changed under an approved booking** — flag it to the admin and leave
   it, or auto-cancel and notify the coach? The spec currently says flag.
5. **Decline without a free alternative** — should declining suggest the nearest
   open slot of the same length?
6. **One space, or several?** — everything here assumes a single bookable area.
   If the facility splits into cages, courts, or half-turf, that is a real change
   to the calendar and the conflict rules, and is much cheaper to decide now.
7. **Facility name and branding** — screens show `[FACILITY NAME]`.

## 11. Not in scope yet

Payments, recurring/season-long bookings, waitlists, equipment or coach
assignment, public read-only calendar, calendar feed (ICS) subscriptions.
