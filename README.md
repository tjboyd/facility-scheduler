# Facility Scheduler

Indoor facility scheduling for head coaches.

Head coaches request blocks of turf time; a facility approver accepts or declines;
the calendar shows pending blocks as tentatively held and approved blocks as
reserved with the team name visible.

## Status

Design phase — nothing is implemented yet. On the
`claude/vibrant-mccarthy-2sstux` branch under `docs/`:

- `facility-scheduler-mockups.pdf` — every screen, one per page, for review
- `DESIGN.md` — roles, rules, flows, and what is still open
- `mockups/` — the artboard sources behind both

## Core rules

- Access is limited to an allowlist of email addresses managed by a super admin.
- Time is booked in 30-minute blocks, 1.5 hours maximum per request (both configurable).
- One team holds a block at a time — no double-booking.
- Available days and hours are configured per weekday by a super admin.
- Requests are emailed to approvers, who accept or decline.

## Roles

| Role | Can do |
| --- | --- |
| Head coach | Request time for their team, withdraw or release their own slots |
| Approver | Everything a coach can, plus accept or decline requests |
| Super admin | Everything, plus manage the email allowlist, hours, and booking rules |
