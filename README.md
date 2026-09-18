# Facility Scheduler

Indoor facility scheduling for Hamilton Jr Chargers coaches.

Head coaches request cage and turf time in 30-minute blocks; an approver accepts
or declines; the calendar shows who has the facility and when.

## What works today

- **Sign in** by emailed link. No passwords.
- **The allowlist is the access control** — an address that isn't on it cannot
  sign in, even with a valid link.
- **People & access** (super admins): invite by email in bulk, set each person's
  role and team, resend a link, remove access, restore it.
- **Teams** (super admins): add, archive, restore. A team must be empty to be
  archived.

## Not built yet

The calendar, booking requests, the approval queue and the notification emails
for requests. Facility hours and booking rules are designed but not wired up —
their tabs are marked *Soon*. The design for all of it is in
[`docs/DESIGN.md`](docs/DESIGN.md), with every screen in
[`docs/facility-scheduler-mockups.pdf`](docs/facility-scheduler-mockups.pdf).

## Roles

| Role | Can do |
| --- | --- |
| Head coach | Request time for their team |
| Approver | The above, plus accept or decline requests |
| Super admin | The above, plus manage people, teams and settings |

A head coach must have a team — it is the name everyone sees on the calendar
once a block is approved. Approvers and super admins needn't have one.

## Getting started

```bash
npm install
cp .env.example .env          # edit SEED_SUPER_ADMIN_EMAIL to your address
npx prisma db push            # create the SQLite database
npm run db:seed               # one super admin + starter teams
npm run dev
```

Open <http://localhost:3000>, enter the seeded address, and **read the sign-in
link from the terminal** — in development nothing is emailed, the link is
printed to the server log.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Unit tests for the domain rules |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:seed` | Seed a super admin and the starter teams |
| `node tools/smoke.mjs` | End-to-end browser check (see below) |
| `npm run pdf` | Rebuild the mockup review PDF |

### End-to-end check

`tools/smoke.mjs` drives a real browser through sign-in, the allowlist, the
super-admin gate and every button on the people screen. It needs the server
running with its output captured, because it reads sign-in links out of the log
the way a person reads them out of an inbox:

```bash
npm run build
PORT=3000 npm start > server.log 2>&1 &
node tools/smoke.mjs
```

## How it is put together

- **Next.js 15** (App Router) and **React 19**, server components with server
  actions — the people screen works without client-side JavaScript except for
  the invite form's inline feedback.
- **Prisma** over **SQLite** in development. For production, point
  `DATABASE_URL` at Postgres and change the provider in
  `prisma/schema.prisma`. SQLite has no enums, so role and status are strings
  validated in `src/lib/domain.ts`.
- **Tailwind v4** with the club's brand as tokens in `src/app/globals.css`;
  see [`docs/DESIGN.md`](docs/DESIGN.md) §9.

### Authentication

Sign-in is a hand-rolled magic link rather than an auth library, so the
allowlist check sits directly in the sign-in path and there is no beta
dependency in the security path. It is deliberately small:

- 256-bit random tokens, **stored only as SHA-256 hashes**, single-use, 15
  minutes.
- Server-side sessions in the database — the cookie holds the secret, only its
  hash is stored, and deleting the row revokes the session at once.
- `httpOnly`, `sameSite=lax`, `secure` in production.
- Role, status and team are re-read on every request, so removing someone's
  access takes effect on their next page load rather than when their cookie
  happens to expire. Removing access also deletes their sessions and any
  outstanding link.
- An unknown address gets exactly the same answer as a known one, so the sign-in
  screen can't be used to find out who is on the list.

It is all in `src/lib/auth.ts` (~150 lines). If you would rather run a managed
provider, that file and `src/lib/guards.ts` are the only places to change.

### Sending email

Development prints emails to the server log, so the app runs with no mail
credentials and the sign-in link is right there in the terminal. Production goes
through **Postmark**.

Nothing about the club's name, domain or addresses is hardcoded — moving to a
different sending domain is an `.env` change plus DNS, with no code edits.

```bash
MAIL_TRANSPORT="postmark"
MAIL_FROM="Jr Chargers Facility <no-reply@mail.yourdomain.org>"
MAIL_REPLY_TO="facility@yourdomain.org"
POSTMARK_SERVER_TOKEN="…"        # Postmark → Servers → API Tokens
POSTMARK_MESSAGE_STREAM="outbound"
ORG_NAME="Hamilton Jr Chargers"
APP_URL="https://…"              # sign-in links are built from this
```

**Send from a subdomain** (`mail.yourdomain.org`). If the scheduler ever
generates bounces, that keeps the reputation damage off the domain the club
sends its ordinary mail from.

Two DNS records, both shown by Postmark once you add the domain under
*Sender Signatures → Domains*:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `<selector>._domainkey.mail.yourdomain.org` | the DKIM key Postmark generates |
| CNAME | `pm-bounces.mail.yourdomain.org` | `pm.mtasv.net` |

The CNAME is Postmark's custom Return-Path. It is what makes SPF *align* for
DMARC, which is why you do **not** need to add Postmark to your main domain's
SPF record. Worth adding a DMARC record too — start at `p=none` and tighten once
you can see reports:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `_dmarc.yourdomain.org` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.org` |

Keep `POSTMARK_MESSAGE_STREAM` on a **transactional** stream. Sign-in links sent
down a broadcast stream get filtered far harder, and an auth email in the spam
folder is worse than no auth email.

**Failures are contained.** A send that fails never undoes the thing that caused
it: people are added to the allowlist first and emailed second, so a Postmark
outage or a missing token leaves them on the list with a message saying the
invite did not go out and to use *Resend*. Sign-in is the same — a failure is
logged, and the visitor still gets the identical "check your inbox" answer,
because whether an address is on the list is not something the form should
reveal either way.

## Layout

```
prisma/schema.prisma      data model
src/lib/domain.ts         pure rules: roles, email parsing, the invariants
src/lib/auth.ts           magic links and sessions
src/lib/guards.ts         requireUser / requireSuperAdmin
src/app/admin/people/     the people & access screen and its server actions
tests/                    unit tests for the domain rules
tools/smoke.mjs           end-to-end browser check
docs/                     design spec, mockups, review PDF
```
