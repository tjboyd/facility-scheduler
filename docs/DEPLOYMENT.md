# Deploying the facility scheduler

A follow-along guide for putting this online with **Vercel** (the app) and
**Neon** (the database). No prior Vercel experience assumed.

Budget about an hour, most of which is waiting for DNS. You can stop after step
6 and have a working app; steps 7 onward are polish.

> **Why this stack.** The app is a Next.js server app that needs Postgres and
> nothing else — no cron, no disk writes, no background worker. Vercel runs
> Next.js natively and Neon installs into it as a marketplace add-on, so there
> is one bill, one dashboard and no server to keep alive. It would run equally
> well on Railway, Render or a VPS; nothing here is Vercel-specific except the
> click paths.

---

## What you need before you start

| | |
| --- | --- |
| **GitHub** | Access to `tjboyd/facility-scheduler`. |
| **Vercel account** | Sign in with GitHub. The Hobby plan is free. |
| **Postmark account** | For sign-in and approval emails. Free trial covers setup; ~$15/mo for the smallest paid plan once you exceed it, though this app sends very little. |
| **DNS access** | Wherever the club's domain is managed — you will add two or three records. |
| **Node 20+ and `psql` locally** | Only for the one-off seed in step 6. |

A note on cost: Vercel Hobby is free but its terms restrict commercial use. A
club's internal scheduling tool is very likely fine; if it ever becomes a
question, Pro is $20/month.

---

## Step 1 — Start the DNS records first

Do this before anything else, because DNS can take anywhere from ten minutes to
a few hours to propagate, and you will want it finished by the time you need it.

**Send from a subdomain**, not the club's main domain — `mail.yourdomain.org`.
If the scheduler ever generates bounces, that keeps the damage away from the
domain the club sends its ordinary mail from.

1. In Postmark, go to **Sender Signatures → Add Domain** and enter
   `mail.yourdomain.org`.
2. Postmark shows you the records to add. Add them at your DNS host:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `<selector>._domainkey.mail.yourdomain.org` | the DKIM key Postmark shows you |
| CNAME | `pm-bounces.mail.yourdomain.org` | `pm.mtasv.net` |

   The CNAME is Postmark's custom Return-Path. It is what makes SPF *align* for
   DMARC, and it is why you do **not** need to add Postmark to your main
   domain's SPF record.

3. While you are in DNS, add a DMARC record if the domain has none. Start
   permissive and tighten once you can see reports:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `_dmarc.yourdomain.org` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.org` |

4. Back in Postmark, click **Verify**. Come back later if it has not propagated.

Finally, get your server token: **Servers → (your server) → API Tokens**. Copy
it somewhere for step 4. Make sure the message stream you use is a
**transactional** one — `outbound` is the default Postmark creates. Never point
this at a broadcast stream: sign-in links are not marketing, and they get
filtered far harder on one.

---

## Step 2 — Create the Vercel project

1. Go to <https://vercel.com/new>.
2. Import `tjboyd/facility-scheduler`.
3. Leave every build setting alone — Vercel detects Next.js correctly, and the
   build command in `package.json` already does the right thing.
4. Click **Deploy**.

**This first build will fail.** That is expected: the build runs database
migrations, and there is no database yet. Carry on to step 3.

---

## Step 3 — Add the database

1. In the project, go to **Storage → Create Database → Neon**.
2. Pick a region near the club — for Wisconsin, a US East or US Central region.
3. Accept the free plan to start.

Neon provisions the database, bills through Vercel, and sets several variables
on the project automatically. Two of them matter:

- `DATABASE_URL` — the **pooled** connection.
- `DATABASE_URL_UNPOOLED` — the **direct** connection.

### Add one variable by hand

Go to **Settings → Environment Variables** and add:

| Name | Value |
| --- | --- |
| `DIRECT_DATABASE_URL` | paste the same string as `DATABASE_URL_UNPOOLED` |

**These two are not interchangeable, and both are needed.** The app queries
through the pooler, because Vercel may answer every request from a fresh
instance and a few hundred of those would exhaust Postgres' connection limit.
Migrations cannot go through a transaction pooler at all — they run
session-level statements it does not support — so they take the direct
connection.

While you are there, check that `DATABASE_URL` ends with
`?sslmode=require&pgbouncer=true&connection_limit=1`. Neon usually includes the
first; add the other two if missing. Prisma needs to be told it is talking to a
transaction pooler.

---

## Step 4 — Set the rest of the environment

Still under **Settings → Environment Variables**, add these for **Production**
and **Preview** both:

| Name | Value |
| --- | --- |
| `APP_URL` | `https://your-project.vercel.app` — your actual deployment URL |
| `ORG_NAME` | `Hamilton Jr Chargers` |
| `FACILITY_TIMEZONE` | `America/Chicago` |
| `MAIL_TRANSPORT` | `postmark` |
| `MAIL_FROM` | `Jr Chargers Facility <no-reply@mail.yourdomain.org>` |
| `MAIL_REPLY_TO` | `facility@yourdomain.org` |
| `POSTMARK_SERVER_TOKEN` | the token from step 1 |
| `POSTMARK_MESSAGE_STREAM` | `outbound` |

**`APP_URL` is the one to get right.** Every sign-in link and every one-click
approval link is built from it. If it is wrong, the emails go out with links
that do not work. Update it the day you add a custom domain (step 7).

`MAIL_REPLY_TO` should be an address somebody reads. Coaches will hit reply
whatever the From address says.

> **If Postmark is not verified yet**, set `MAIL_TRANSPORT` to `console` for
> now. Emails will be printed to the Vercel function logs instead of sent, which
> is enough to get yourself signed in — see the troubleshooting table. Switch it
> to `postmark` once DNS verifies.

---

## Step 5 — Deploy

Go to **Deployments**, open the failed one, and click **Redeploy**.

This time the build will:

1. `prisma generate` — build the database client
2. `prisma migrate deploy` — create every table
3. `next build` — build the app

The schema is applied as part of every deployment, so there is no separate
release step to remember, now or later.

When it goes green, open the URL. You should get the sign-in screen. You cannot
sign in yet — nobody exists.

---

## Step 6 — Create the first account

Nothing can happen in the app until one super admin exists, and Vercel gives you
no shell to run the seed in. So run it once from your own machine, pointed at
the production database.

From **Storage → your database → Connect**, copy the **unpooled / direct**
connection string. Then, in a clone of the repo:

```bash
npm install

DATABASE_URL="<the unpooled Neon string>" \
DIRECT_DATABASE_URL="<the unpooled Neon string>" \
SEED_SUPER_ADMIN_EMAIL="you@yourdomain.org" \
SEED_SUPER_ADMIN_NAME="Your Name" \
npm run db:seed
```

This creates your super admin account and the club's 20 teams (15 active, 5
archived to match SportsEngine), and sets the facility hours and booking rules
to their defaults.

**Pass the variables inline as shown; do not edit your `.env` to point at
production.** Inline variables take precedence, and this way there is no chance
of leaving your local setup aimed at the live database and later running
something destructive against it.

The seed is safe to run again: teams are upserted, hours and rules are only
created if absent, and an existing admin is left alone.

---

## Step 7 — Sign in and add everyone

1. Open the app and enter the address you seeded.
2. Check your inbox and follow the link. It is good for 15 minutes and works
   once.
3. Go to **Admin → People & access** and add the other coaches — paste a whole
   list of addresses at once, then set each person's role and team.

Roles:

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

**Settings → Domains → Add**, then follow Vercel's DNS instructions.

**Then change `APP_URL` to the new address and redeploy.** Environment variables
are read at build time, so an edit alone does nothing until you redeploy. Skip
this and sign-in links will keep pointing at the old `.vercel.app` address.

---

## Day to day

**Deploying a change.** Push to `main`. Vercel builds and deploys it, migrations
included. Nothing else to do.

**Preview deployments.** Every pull request gets its own URL. Neon's integration
gives each preview its own database branch, so a preview migrates its own copy
rather than production. If you ever wire the database up by hand instead, do
**not** give previews the production `DIRECT_DATABASE_URL` — every preview build
would run migrations against live data.

**Backups.** The booking history, the allowlist and the season's assigned
schedules are the product. Losing them mid-season is the failure that actually
hurts, and it is worth five minutes to prevent.

Neon offers point-in-time restore; check the retention window on your plan, as
the free tier's is short. Independently of that, take a dump you control before
each season and after loading the assigned schedule:

```bash
pg_dump "<the unpooled Neon string>" > facility-$(date +%F).sql
```

**Logs.** Vercel's **Logs** tab shows every request and anything the app printed.
Mail failures are logged there with the reason.

---

## Troubleshooting

| Symptom | What it is |
| --- | --- |
| Build fails: `Environment variable not found: DIRECT_DATABASE_URL` | Step 3's manual variable is missing, or was added to only one environment. |
| Build fails: `Can't reach database server` | `DIRECT_DATABASE_URL` is the pooled string rather than the direct one, or the database is still provisioning. |
| Build fails: `P3009 migrate found failed migrations` | A previous deploy died partway. Connect with `psql` and inspect `_prisma_migrations`; do not simply retry. |
| No email arrives | Check Postmark's **Activity** tab. Nothing there means the app never sent — check `MAIL_TRANSPORT` is `postmark` and the token is right, then read the Vercel logs. Something there, marked bounced or suppressed, means the address is the problem. |
| Emails send but the links 404 or hit the wrong site | `APP_URL` is wrong, or you changed it without redeploying. |
| "That sign-in link is no longer valid" | They expire after 15 minutes and work once. Clicking the same link twice does this. Request a new one. |
| A coach says the app rejects them | They are not on the allowlist, or their access was removed. Check **Admin → People & access**. An address that is not on the list cannot sign in even with a valid link — that is the access control working. |
| `too many connections` under load | `DATABASE_URL` is missing `?pgbouncer=true&connection_limit=1`, or it is the direct string rather than the pooled one. |
| A coach has no **Request time** button | Head coaches must be on a team. Assign one in **People & access**. |
| You locked yourself out | The app will not let the last super admin be demoted or removed, so this should not be possible from inside. If it happens anyway, re-run the step 6 seed with your address — it promotes an existing user to super admin. |

---

## If you outgrow this

Nothing here is load-bearing on Vercel. The app is a standard Next.js server
with a Postgres connection: `npm run build && npm start` runs it anywhere, and
`prisma migrate deploy` applies the schema. Moving to Railway, Render, Fly or a
VPS means re-pointing `DATABASE_URL`, `DIRECT_DATABASE_URL` and `APP_URL`, and
nothing else.
