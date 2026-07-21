# Deploying the Units Agent System (Railway — ~$5/mo)

The app auto-creates its database tables on first boot. You only supply the
database and the environment variables.

## One-time setup (~15 minutes)

1. **Create a GitHub account** (github.com) if you don't have one, and a
   Railway account (railway.app) — sign in with GitHub.

2. **Push this folder to GitHub:**
   - github.com → New repository → name it `units-agents`, Private → Create
   - Follow GitHub's "push an existing folder" instructions, or ask Claude
     to run the git commands once you're logged in.

3. **On Railway:** New Project → Deploy from GitHub repo → pick `units-agents`.
   Railway detects the Dockerfile automatically.

4. **Add Postgres:** in the same project, New → Database → PostgreSQL.
   Railway sets `DATABASE_URL` on the service automatically when you
   reference it: service → Variables → Add Variable Reference → DATABASE_URL.

5. **Set the remaining variables** (service → Variables):
   - `SMTP_HOST` = smtp.gmail.com
   - `SMTP_PORT` = 587
   - `SMTP_USER` = your Gmail address
   - `SMTP_PASS` = a Gmail App Password (myaccount.google.com → Security →
     2-Step Verification → App passwords)
   - `EMAIL_FROM` = "Units Real Estate <your@gmail.com>"
   - `FOLLOWUP_SIGNATURE` = "Best regards,\nUnits Real Estate — Soma Bay\n+20 10 20010666"

6. **Deploy.** Railway builds and starts it. Check the logs for
   `initdb: schema applied` and `listening on :3000`.

## What runs once deployed

- Lead aggregation pass every 15 min (`leadAggregator` — feed it CSVs via
  POST /agents/aggregate-leads with {"csvPath": ...} or wire the webhook later)
- Scoring every hour (`leadScorer`)
- Follow-up emails daily at 09:00 (`leadFollowUp` — sends only if SMTP vars are set)

## Daily lead import (until the Meta webhook is built)

Download the leads CSV from Meta → Ads Manager → your form → Download leads,
then POST it to the server or ask Claude to ingest it. Alternative: your
Zapier "Units For Real Estate CRM Connection" already pushes Meta leads —
Claude can add an endpoint to receive them (POST /agents/aggregate-leads
with a leads[] array) if you point Zapier at it.

## Alternative: Render.com

Render works the same way (New → Web Service → connect repo, plus a
PostgreSQL instance). Avoid Render's free tier — it puts the service to
sleep, which kills the cron jobs. Use the $7/mo starter.
