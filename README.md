# Innovation Diwan — Camp operations dashboard

**ديوان الابتكار — لوحة عمليات المعسكر الافتراضي**

The operations dashboard for the Innovation Diwan virtual camp (فكّر للحرمين
2026, 14 days, 4–17 October 2026, Riyadh time), built on the SoWork API. It is
Arabic-first with full RTL, with English available.

It gives the operations team one place to:

- see every SoWork account, and prepare the account-type change list;
- catch duplicate and lookalike accounts;
- check naming compliance (rules N01–N13), with suggested names and correction
  messages;
- track attendance with the 10-minute rule, room placement and guider coverage;
- link meeting recordings;
- run the scheduled cues (S00–S23), personal nudges (P01–P07) and operations
  alerts (A01–A09);
- export everything to Excel (Arabic, RTL);
- import the registry and agenda workbooks, with a preview and a diff before
  anything is saved.

A standalone app with its own frontend, backend, database and sign-in. Nothing
is shared with any other platform.

## Stack

TanStack Start (React 19, SSR, file routes, server functions) · Tailwind v4 +
shadcn/ui · Nitro `node-server` · PostgreSQL (`pg`) · Node 22. One container:
the Node server, which also runs the SoWork sync every minute.

## Run it locally

```bash
cp .env.example .env          # fill DATABASE_URL, SOWORK_API_KEY, ADMIN_*
npm install
npm run migrate               # creates the tables and the first admin
npm run dev                   # http://127.0.0.1:8080
```

The dev server does not sync with SoWork unless `CAMP_SCHEDULER=on`. Sending
DMs, gongs and announcements is off until an admin turns it on in Settings.

## Checks

```bash
npm run typecheck             # tsc — the main gate
npm run check:camp            # 108 domain-logic assertions (plain node)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/qa/db-assertions.sql   # rolls back
npm run build                 # production build → .output/
```

## Deploy

See **[docs/deployment-cranl.md](docs/deployment-cranl.md)**. In short:

1. A Dockerfile app on port 3000, with `/api/ready` as the health check.
2. PostgreSQL, wired in as `DATABASE_URL`.
3. Set `SOWORK_API_KEY` and `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

No scheduler is needed.

## Who can do what

| Role | Can |
| --- | --- |
| Viewer (مشاهد) | Read every screen. |
| Editor (محرر) | Everything a viewer can, plus decisions (links, duplicates, overrides, rooms), messages to participants, imports and "sync now". |
| Admin (مسؤول) | Everything an editor can, plus settings (including the sending switch), templates and cues, broadcasts, starting event capture, and managing who can sign in (صلاحيات الدخول). |

Accounts are created by an admin, who gets a one-time password to hand over.
The user replaces it at first sign-in. To recover a lost admin, run inside the
container: `node scripts/create-admin.ts you@example.com "Your name"`.

## Where things are

```
db/migrations/        0001 sign-in tables · 0002 camp data + seeds (applied at start-up)
scripts/              migrate.ts · create-admin.ts · start.sh · qa/
src/lib/camp/         pure domain logic (*.ts, runs under plain node) + *.server.ts (SoWork, sync, read model)
src/lib/auth/         passwords, sessions, the auth middleware and role guards
src/lib/*.functions.ts  server functions (camp-read, camp-actions, camp-admin, auth, users)
src/components/camp/  the eleven screens
src/routes/           file routes; _app.* is everything behind sign-in
src/styles.css        the Innovation Diwan identity (colours, Misk font, motif)
docs/operations.md    go-live order, how it works, departures from the requirements
```

## Brand assets

`public/fonts/` (Misk) and `public/brand/` (the Innovation Diwan, Misk and
Al-Haramain marks) come from the programme's visual identity guide
(دليل الهوية البصرية — فكّر للحرمين 2026). They belong to their owners. Keep
this repository private.
