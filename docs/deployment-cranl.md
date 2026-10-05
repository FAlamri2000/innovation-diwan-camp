# Deploying on CranL

One application (this repository's `Dockerfile`) and one PostgreSQL database,
in the **falak apps** project. There is no Schedule to add: the SoWork sync
runs inside the server.

## 1. The application

1. CranL dashboard → project **falak apps** → **New application** → from GitHub:
   `FAlamri2000/innovation-diwan-camp`, branch `main`.
2. Build type **Dockerfile** (repository root), container port **3000**.
3. Health check: **`/api/ready`**. It proves PostgreSQL as well as the process
   and returns 503 when the database is unreachable. (`/api/health` checks the
   process only.)
4. Region **`riyadh-1`** (Riyadh), where the database must also go. A CranL
   project has no region of its own, and an app's region is fixed at
   creation.

## 2. The database

Create the PostgreSQL database **from the dashboard**, with **Inject into App**
set to this application. That places it on the app's private network and
writes `DATABASE_URL`.

A database created through the API with only a region is NOT reachable from
the app (`could not translate host name`). This is not a region mismatch.

## 3. Environment

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Written by **Inject into App**. |
| `SOWORK_API_KEY` | The SoWork office **owner** key (`sw_…`) with admin team-analytics. Secret. |
| `ADMIN_EMAIL` | The first admin's email. |
| `ADMIN_PASSWORD` | A temporary password, at least 10 characters. Used only while no active admin exists, and replaced at first sign-in. Remove it after the first sign-in. |
| `ADMIN_NAME` | Optional display name. |

Optional:

| Variable | Default / use |
| --- | --- |
| `SOWORK_API_BASE` | `https://api.sowork.com/public` |
| `CAMP_SCHEDULER` | On in production. `off` disables the in-process sync. Then POST `/api/tick` with header `x-tick-secret: $TICK_SECRET` every minute. |
| `TICK_SECRET` | Only needed with `CAMP_SCHEDULER=off`. |
| `PG_POOL_SIZE` | `8` |

## 4. First deployment

1. Deploy. The log should show `[migrate] applied 0001_auth.sql`,
   `[migrate] applied 0002_camp.sql`, `first admin ready: …`, then
   `[scheduler] camp sync every minute`.
2. Open the app URL and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. You are
   asked for a new password. Then delete `ADMIN_PASSWORD` from the
   environment.
3. **Settings → بدء استقبال الأحداث (start event capture). Do this first, the
   same day.** SoWork keeps join/leave events for only 72 hours, and capture
   only holds events from the moment it starts.
4. **صلاحيات الدخول (Dashboard access) → add the operators** with their roles.
   Each one gets a one-time password to hand over privately.
5. Continue with the go-live order in [operations.md](operations.md):
   - upload the registry and agenda;
   - fill the room map;
   - choose your own SoWork account for test messages;
   - review texts and send tests. Sending stays **off** until then.

## Redeploys and restarts

- Migrations are applied at every start and recorded in `app_migrations` with
  a checksum. A migration file that changed after it was applied stops the
  start. Add a new file instead of editing an old one.
- SIGTERM lets a running sync finish (up to 15 s), then exits. Running two
  replicas is safe: the sync holds a database lease.
- Sessions live in the database, so a restart signs nobody out.

## Recovering admin access

From the application's console in CranL:

```bash
node scripts/create-admin.ts someone@example.com "Display name"
```

This prints a one-time password and signs that user out everywhere.

## Backups

Use CranL's database backups (dashboard). Without a fresh dump, losing the
database loses:

- the operator decisions (links, duplicates, overrides);
- the naming history;
- events older than SoWork's 72 hours.

The registry and agenda can be re-imported from the workbooks.
