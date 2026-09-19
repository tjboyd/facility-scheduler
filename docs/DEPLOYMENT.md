# Deploying the facility scheduler

A follow-along guide for putting this online with **Railway** (the app and the
database) and **Postmark** (email). No prior Railway experience assumed.

Budget about an hour, most of which is waiting for DNS. You can stop after step
6 and have a working app; steps 7 onward are polish.

> **Why Railway.** The app is a Next.js server that needs Postgres and nothing
> else — no cron, no disk writes, no background worker. Railway runs both in one
> project, so there is one dashboard, one bill and one thing to hand to whoever
> takes this over. It runs as a normal long-lived container, so there are no
> cold starts: a coach tapping a link at the field gets the page immediately.
>
> Nothing here is Railway-specific except the click paths. `npm run build &&
> npm start` plus `npm run db:deploy` will run this anywhere.

---

## What you need before you start

| | |
| --- | --- |
| **GitHub** | Access to `tjboyd/facility-scheduler`. |
| **Railway account** | Sign in with GitHub. Expect roughly $5–10/month for the app and database together at this traffic — check current pricing, it changes. |
| **Postmark account** | For sign-in and approval emails. Free trial covers setup; the smallest paid plan is about $15/month, though this app sends very little. |
| **DNS access** | GoDaddy, for `jrchargersbaseball.com` — two records to add. |
| **Node 20+ locally** | Optional. The first account is created on first boot; this is only for seeding by hand. |

---

## Step 1 — Postmark and DNS

Do this first, because DNS takes from ten minutes to a few hours to propagate
and you want it finished by the time you need it.

**The club sends from `jrchargersbaseball.com` itself**, the root domain. That
is what is set up and verified. Postmark's own records sit alongside the
existing ones rather than replacing anything.

Two records make it work:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `<selector>._domainkey` | the DKIM key Postmark shows you |
| CNAME | `pm-bounces` | `pm.mtasv.net` |

At GoDaddy the **Host** column is relative to the domain, so enter
`pm-bounces` — not the full `pm-bounces.jrchargersbaseball.com`, which GoDaddy
would turn into `pm-bounces.jrchargersbaseball.com.jrchargersbaseball.com`.

Check them from a terminal:

```bash
dig +short CNAME pm-bounces.jrchargersbaseball.com     # → pm.mtasv.net.
dig +short TXT _dmarc.jrchargersbaseball.com
dig +short TXT jrchargersbaseball.com
```

### Do not touch the SPF record

The root already publishes:

```
v=spf1 include:spf.protection.outlook.com a:smtp.ngin.com -all
```

That is Microsoft 365 and SportsEngine, and it ends in `-all`, a hard fail.
**Postmark does not belong in it**, and adding it would be a mistake worth
avoiding: the `pm-bounces` CNAME makes Postmark the *Return-Path* domain, and
SPF is checked against the Return-Path rather than the From address. Postmark
publishes its own SPF there, so the check passes and still *aligns* with
`jrchargersbaseball.com` for DMARC. Editing a working SPF record risks the
club's real mail for no gain.

### DMARC is already set

`_dmarc.jrchargersbaseball.com` publishes `p=none` with reports going to
`dmarc@jrchargersbaseball.com`. Leave it alone — a second DMARC record on one
name is invalid and would break the first. `p=none` is the right setting while
a new sender beds in; tighten it later once the reports look clean.

### Then

1. In Postmark, **Sender Signatures → jrchargersbaseball.com** should show
   **Verified** for both DKIM and Return-Path. If DKIM is still pending, the
   TXT record has not propagated — wait and press Verify again.
2. Copy the server token from **Servers → (your server) → API Tokens**.
3. Use a **transactional** message stream — `outbound` is the default Postmark
   creates. Never a broadcast stream: sign-in links are not marketing and get
   filtered far harder on one.

> **Sending from a subdomain instead.** `mail.jrchargersbaseball.com` would keep
> any bounce reputation off the domain the club's real mail uses, which is the
> safer arrangement for a high-volume sender. At this volume — a handful of
> transactional emails to addresses the club already has — the difference is
> small, and the root is what is set up. If you ever want to move, it is the
> same two records under `mail.` and a change to `MAIL_FROM`.

---

## Step 2 — Create the project and the database

1. Go to <https://railway.app/new> and choose **Deploy from GitHub repo**.
2. Pick `tjboyd/facility-scheduler`. Railway starts building immediately.
3. While it builds, click **+ New → Database → Add PostgreSQL** in the same
   project.

You now have two services side by side: the app and Postgres.

**The first deploy will fail**, because the app has no database connection yet.
That is expected — carry on.

Railway reads [`railway.json`](../railway.json) from the repo, so the build
command, the start command, the migration step and the healthcheck are already
configured. You should not need to touch the service's build settings.

---

## Step 3 — Connect the app to the database

Open the **app** service → **Variables**, and add:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `DIRECT_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

Type those braces literally — they are Railway *reference variables*, which
point at the Postgres service rather than hard-coding a password that would
break the day the database is rotated. If you named the database service
something other than `Postgres`, use that name.

**Both variables, and yes, the same value on Railway.** The app reads
`DATABASE_URL` for queries and `DIRECT_DATABASE_URL` for migrations. On hosts
that put a connection pooler in front of Postgres those are two different
strings, because a transaction pooler cannot run migrations. Railway has no
pooler in front, so here they are identical — the schema keeps both so the app
can move to a pooled host later without a code change.

---

## Step 4 — Set the rest of the environment

Still in the app service's **Variables**, add:

| Name | Value |
| --- | --- |
| `APP_URL` | your public URL, from step 5 — set a placeholder now and correct it |
| `ORG_NAME` | `Hamilton Jr Chargers` |
| `FACILITY_TIMEZONE` | `America/Chicago` |
| `MAIL_TRANSPORT` | `postmark` |
| `MAIL_FROM` | `Jr Chargers Facility <no-reply@jrchargersbaseball.com>` |
| `MAIL_REPLY_TO` | `facility@jrchargersbaseball.com` — an address somebody reads |
| `POSTMARK_SERVER_TOKEN` | the token from step 1 |
| `POSTMARK_MESSAGE_STREAM` | `outbound` |
| `SEED_SUPER_ADMIN_EMAIL` | your address — the first account, created on first boot |
| `SEED_SUPER_ADMIN_NAME` | your name (optional) |

**`SEED_SUPER_ADMIN_EMAIL` is how you get in.** On its very first boot — and
only when the database has no people in it at all — the app creates that super
admin, the club's 20 teams and the facility defaults. Every boot after that it
finds people and does nothing, so it can never re-promote somebody you later
demote or bring back a team you archived. Without it the app deploys fine and
nobody can sign in.

**`MAIL_FROM` must be on the domain Postmark verified** — `jrchargersbaseball.com`. Send from anything else and Postmark rejects the message rather than delivering it.

**`APP_URL` is the one to get right.** Every sign-in link and every one-click
approval link is built from it. If it is wrong, emails go out with links that do
not work. You get the real URL in step 5 — come back and fix it.

`MAIL_REPLY_TO` should be an address somebody reads. Coaches will hit reply
whatever the From address says.

Do **not** set `PORT`. Railway sets it and `next start` already honours it.

> **If Postmark is not verified yet**, set `MAIL_TRANSPORT` to `console` for
> now. Emails are printed to the Railway logs instead of sent, which is enough
> to get yourself signed in. Switch it to `postmark` once DNS verifies.

---

## Step 5 — Get a public URL and deploy

1. App service → **Settings → Networking → Generate Domain**. Railway gives you
   something like `facility-scheduler-production.up.railway.app`.
2. Go back to **Variables** and set `APP_URL` to `https://` + that domain.
3. Saving variables triggers a redeploy. If it does not, use **Deploy** on the
   latest commit.

This deploy will:

1. **Build** — `prisma generate && next build`
2. **Start** — `prisma migrate deploy && next start`, creating every table on
   the way up

Migrations run at startup rather than during the build because Railway's
private network only exists at runtime — a build-time migration could not reach
`postgres.railway.internal` at all. `railway.json` also names a *pre-deploy*
command, which is the tidier place for them: if the host honours it the
migration runs there and the one at startup finds nothing to do. Putting it in
`npm start` as well means the app can never come up against a database with no
tables, whichever way the host reads its config.

`prisma migrate deploy` takes an advisory lock, so it is safe even if more than
one instance starts at once, and it is a no-op once the schema is current.

**If you see `The table "public.Session" does not exist`**, the migration has
not run. Apply it by hand against the public connection string and restart:

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL>" \
DIRECT_DATABASE_URL="<DATABASE_PUBLIC_URL>" \
npm run db:deploy
```

When it goes green, open the URL. You should get the sign-in screen. You cannot
sign in yet — nobody exists.

---

## Step 6 — Sign in

There is nothing to run. The first boot already created your super admin from
`SEED_SUPER_ADMIN_EMAIL`, along with the club's teams and the facility
defaults. The deploy log says so:

```
[bootstrap] first run: created 20 teams, the facility defaults, and the super
admin you@jrchargersbaseball.com. Sign in with that address to invite everyone else.
```

If instead it says the variable is not set, set it and redeploy.

**Seeding by hand**, against a database the app is not running against yet, or
for local development:

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL>" \
DIRECT_DATABASE_URL="<DATABASE_PUBLIC_URL>" \
SEED_SUPER_ADMIN_EMAIL="you@jrchargersbaseball.com" \
npm run db:seed
```

It is the same code the server runs, with the same guard: it does nothing to a
database that already has people in it.

---

## Step 7 — Add everyone and set the place up

1. Open the app and enter your address. Check your inbox and follow the link —
   it is good for 15 minutes and works once.
2. Go to **Admin → People & access** and add the other coaches — paste a whole
   list of addresses at once, then set each person's role and team.

| Role | Can do |
| --- | --- |
| Head coach | Request time for their team. Must have a team. |
| Approver | The above, plus accept or decline requests |
| Super admin | The above, plus manage people, teams, hours and rules |

Then set the facility up for the season:

- **Admin → Hours** — the days and times coaches may request, plus closure dates
  for holidays and tournaments.
- **Admin → Booking rules** — block size, longest request, how far ahead coaches
  can book, notice period, per-team weekly caps.
- **Admin → Assigned schedule** — load the teams' standing practice slots. This
  is most of the facility's time, and only super admins can set up anything
  repeating.

---

## Step 8 — A custom domain (optional)

App service → **Settings → Networking → Custom Domain**. Railway gives you a
CNAME to add at your DNS host.

**Then change `APP_URL` to the new address.** Skip this and sign-in links keep
pointing at the old `.up.railway.app` address.

---

## Day to day

**Deploying a change.** Push to `main`. Railway builds, runs migrations and
deploys. Nothing else to do.

**Rolling back.** **Deployments** → pick an earlier one → **Redeploy**. Note
that this rolls back *code*, not the database: a deploy that added a column
leaves the column there. That is usually what you want.

**Logs.** The app service's **Logs** tab shows every request and anything the
app printed, including mail failures with their reason.

**Backups.** The booking history, the allowlist and the season's assigned
schedules are the product. Losing them mid-season is the failure that actually
hurts, and it is worth five minutes to prevent.

Railway's Postgres has backups in the service's **Backups** tab — turn on a
schedule and check the retention. Independently of that, take a dump you control
before each season and after loading the assigned schedule:

```bash
pg_dump "<DATABASE_PUBLIC_URL>" > facility-$(date +%F).sql
```

Restoring one:

```bash
psql "<DATABASE_PUBLIC_URL>" < facility-2027-03-01.sql
```

---

## Troubleshooting

| Symptom | What it is |
| --- | --- |
| Deploy fails: `Environment variable not found: DIRECT_DATABASE_URL` | Step 3 is incomplete. Both variables are needed even though they hold the same value. |
| Pre-deploy fails: `Can't reach database server at postgres.railway.internal` | The Postgres service is not running, or the reference variable names a service that does not exist — check the spelling inside `${{...}}`. |
| `The table "public.Session" does not exist` (P2021) | The migration never ran. Apply it by hand as in step 5, then redeploy — `npm start` runs it from now on. |
| Pre-deploy fails: `prisma: not found` | The `prisma` CLI must be a production dependency, since the pre-deploy step runs after install. It is in `dependencies` in this repo; check nothing moved it. |
| Deploy fails: `P3009 migrate found failed migrations` | A previous deploy died partway. Connect with `psql` and inspect `_prisma_migrations`; do not simply retry. |
| Healthcheck fails but the app looks fine | The healthcheck hits `/signin`, which does not touch the database — so if it fails, the Node process itself is not serving. Check the logs for a crash on boot. |
| No email arrives | Check Postmark's **Activity** tab. Nothing there means the app never sent — check `MAIL_TRANSPORT` is `postmark` and the token is right, then read the Railway logs. Something there, bounced or suppressed, means the address is the problem. |
| Emails send but the links 404 or hit the wrong site | `APP_URL` is wrong, or was never updated after you generated the domain. |
| "That sign-in link is no longer valid" | They expire after 15 minutes and work once. Clicking the same link twice does this. Request a new one. |
| The sign-in email never arrives and the logs show nothing | Sign-in answers identically whether or not an address is on the list, so an unknown address sends nothing and logs nothing. That address is not in the database — check **Admin → People & access**, or the first-boot log line above. |
| A coach says the app rejects them | They are not on the allowlist, or their access was removed. Check **Admin → People & access**. An address that is not on the list cannot sign in even with a valid link — that is the access control working. |
| A coach has no **Request time** button | Head coaches must be on a team. Assign one in **People & access**. |
| `psql` from your laptop hangs or refuses | You are using `DATABASE_URL` (internal). Use `DATABASE_PUBLIC_URL`. |
| You locked yourself out | The app will not let the last super admin be demoted or removed, so this should not be possible from inside. If it happens anyway, re-run the step 6 seed with your address — it promotes an existing user to super admin. |

---

## If you move off Railway

Nothing here is load-bearing. The app is a standard Next.js server with a
Postgres connection:

- Build: `npm run build`
- Migrate: `npm run db:deploy` — as a release step, before the new version serves
- Start: `npm start`, honouring `PORT`

Moving to Vercel, Render, Fly or a VPS means re-pointing `DATABASE_URL`,
`DIRECT_DATABASE_URL` and `APP_URL`, and nothing else. On a serverless host
— Vercel among them — put a connection pooler in front of Postgres and give
`DATABASE_URL` the pooled string while `DIRECT_DATABASE_URL` keeps the direct
one; that is exactly the split those two variables exist for.
