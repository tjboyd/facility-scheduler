# Mockup sources

These are the artboards behind the design canvas at
<https://claude.ai/artifact/QJmBR8jyCiP981pYTkXd6x>.

Each `.dc.html` file is one screen, laid out on the canvas by `canvas.json`.
They are checked in as the record of the design — they are not application
code and do not render on their own outside the canvas (each one expects the
canvas runtime's `support.js`).

| File | Screen |
| --- | --- |
| `Main.dc.html` | Sign in |
| `SignInSent.dc.html` | Check your inbox |
| `CoachCalendar.dc.html` | Coach · week calendar |
| `RequestBooking.dc.html` | Coach · request time |
| `MyRequests.dc.html` | Coach · my requests |
| `ApproverQueue.dc.html` | Approver · queue and decision |
| `ApprovalEmail.dc.html` | Notification emails |
| `MobileCalendar.dc.html` | Phone · day view |
| `MobileRequest.dc.html` | Phone · request sheet |
| `AdminUsers.dc.html` | Super admin · people & access |
| `AdminHours.dc.html` | Super admin · hours |
| `AdminRules.dc.html` | Super admin · booking rules |

Sample data throughout (team names, coach names, dates in the week of
Sep 20–26 2026) is illustrative. `[FACILITY NAME]`, `[YOUR NAME]` and
`[APPROVER NAME]` are placeholders.
