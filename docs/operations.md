# Operations guide

The dashboard gives the Innovation Diwan virtual camp's operations team
(Misk supervisors) one place, in Arabic, to see every SoWork account, catch
duplicate and misnamed accounts, track attendance across the 14 camp days
(4–17 October 2026, Riyadh time), link recordings, and run the scheduled cues,
personal nudges and operations alerts.

Requirement ids in code comments (FR-USR-*, FR-DUP-*, FR-NAM-*, FR-ATT-*,
FR-REC-*, FR-NOT-*, FR-IMP-*, FR-EXP-*, FR-UI-*, BR-*, N01–N13, S00–S23,
P01–P07, A01–A09, M01–M14) refer to *Innovation Diwan Virtual Camp: Operations
Dashboard Functional Requirements* (5 Oct 2026). The Arabic copy in the
dictionaries, the seeded templates and the exports uses that document's terms
verbatim.

## Going live — in this order

1. **Deploy** with `SOWORK_API_KEY` set ([deployment-cranl.md](deployment-cranl.md)).
   The key must belong to an **office owner** with the **admin team-analytics**
   permission (§2). Only `src/lib/camp/sowork.server.ts` reads it. It is never
   stored in the database or shown on a screen.
2. **Start event capture**: Settings → *بدء استقبال الأحداث*.
   - This creates an **inbox-only** SoWork subscription (no webhook URL) for
     `meeting.started`, `meeting.ended`, `meeting.user_joined`,
     `meeting.user_left` and `office.member_presence_updated`.
   - **SoWork keeps events for 72 hours**, and the inbox only holds events
     from the moment it exists. Every hour before this step loses live
     join/leave data. The meetings API still backfills one join and one leave
     per person per meeting (BR-ATT-07).
   - If a subscription with those five events already exists in the office,
     the worker adopts it.
3. **Add the operators** in *صلاحيات الدخول* (Dashboard access).
   - Viewer reads every screen.
   - Editor also makes decisions, sends messages and runs imports.
   - Admin also controls settings, templates, cues, the sending switch,
     broadcasts and users.
4. **Upload the registry and the agenda** (رفع البيانات). Review the issues and
   the diff, then save.
5. **Fill the room map**:
   - team-room topics and zone ids (§13);
   - committee assignments for days 4, 8 and 12;
   - the day-14 judging order.
6. **Settings**:
   - your own SoWork account, for test messages;
   - alert recipients;
   - the expected account type per role (BR-USR-04);
   - channels — the summary channel must be a private channel the team
     creates, because the API cannot create channels;
   - the main-hall zone id, for the S09 NPC.
7. **Sending stays OFF** until an operator has reviewed every cue and template
   and sent tests (FR-NOT-03; §13 suggests a 10-account trial).
   - The switch is Settings → *الإرسال التلقائي*.
   - Every cue and template is also seeded disabled individually.

## Shape

```
SoWork API ──► sync worker (camp/sync.server.ts, in-process, one tick per minute, DB lease)
                 events inbox → camp_events → intervals + presence spans
                 /v1/meetings (active, last 45 min, backward backfill) → camp_meetings,
                     camp_meeting_users, 'api' intervals for pairs the events never saw
                 /v1/users, working-hours (FR-USR-10 cadence) → camp_sw_users, camp_working_hours
                 meeting library → link on camp_meetings (deep link only)
                 automation.server.ts → naming history, A01–A09, and (switch on) cues/nudges
registry/agenda workbooks ──► browser reads (SheetJS) → previewCampImport → diff → apply
operator decisions ──► link / duplicate / override / room / change-list tables (+ camp_audit)
                                  │
read model (model.server.ts + attendance.server.ts, cached seconds) ◄─┘──► 11 screens + Excel exports
```

* **Everything derived is recomputed on read** from inputs + decisions: event
  role, account type, naming status, duplicate pairs, suggested names, room
  placement, attendance status. A corrected registry, a new role label or a
  changed threshold re-derives every past day. The only stored derivation is
  `camp_naming_daily`, which *is* history (the trend cannot be recomputed after
  a rename).
* **Pure logic** lives in `src/lib/camp/{text,naming,match,agenda,attendance,recordings,cues,import-parse,settings}.ts`
  — relative `.ts` imports and no `@/` alias, so `npm run check:camp` runs it
  under plain Node. Never put real names in that test file.
* **Server functions**:
  * `camp-read` — any signed-in user.
  * `camp-actions` — editor.
  * `camp-admin` — editor for messaging, imports and sync; admin for settings,
    templates, cues, broadcasts and starting event capture.
  * `users` — admin.

  The role guards live in `src/lib/auth/guards.ts`.
* **Database access** goes over the app's one pool (`database.server.ts`). The
  database is reachable only from the server, so the role guards are the
  authorization boundary.
* **The scheduler** (`src/lib/scheduler.server.ts`) starts with the server:
  * the camp tick every minute;
  * session housekeeping every hour.

  `scripts/start.sh` sends one warm-up request so this happens at boot, not on
  the first visit. On SIGTERM it lets a running tick finish, then exits.

## Where the build deliberately departs from the document

| Document | Built | Why |
| --- | --- | --- |
| FR-ATT-04: topic, then participant mix, else غير محدد | Topic → mix → **a meeting of ≥ 15 people is the main hall** → غير محدد | 98 of 100 meetings on day 1 had **no topic**; without a size rule the main hall could never be told apart. Threshold is a setting. |
| FR-REC-01: same topic, start within 2 min | Item **starts inside the meeting** (± 180 s), ≥ half the people shared (of the larger side), or the same topic | Library items start when recording/notes start: 187 s, 364 s and 28 min after the meeting on day 1. Most meetings have no topic while their library item gets a generated one. |
| Registry matching | Automatic link at ≥ 90; 80–89 links only when the team number or role in the name agrees, else "possible match" | A display name usually drops the middle names the registry carries; one-word names are capped at 70 so they never auto-link. |
| N11 for every unmatched account | Not raised for experts, speakers and supervisors | They have no registry list (§1); N11 would flag every one of them. |
| Suggested name (FR-NAM-04) | From the registry when linked; otherwise from the person's own spelling + the inferred team/role | Gives a correction message to people the registry does not hold. |
| "Everyone" at workshops/talks | Includes guiders and coaches for the enabler rate (setting) | The table says *Everyone*; switch it off if only participants are expected. |
| FR-NOT-07 shift on re-import | Cues timed from 15 min before up to a moved session's old start move with it, per day | Times written inside cue texts are not rewritten; the import preview lists every shifted cue to check. |
| Lookalikes (§5 expects the Albaradei family) | Siblings with different first names score below 80 | Scoring family names alone would flag every pair sharing a common family name (الغامدي، العتيبي…). |

## What SoWork cannot do (§2) and how the dashboard handles it

* Account type changes, renames, removing duplicates: prepared as the change
  list (FR-USR-07), exported, applied by an owner in SoWork admin; the list
  marks itself done when the API shows the new type (FR-USR-08).
* Guests are only visible after their first activity.
* No room on a meeting: placement above.
* Video links expire after 24 h: fetched on click, never stored (FR-REC-03);
  exports carry the library deep link.

## Traps learned building it

* **A library item's start is not the meeting's start** — see the table. The
  first version (start proximity) linked 3 of 21 large meetings; containment
  links every one that has an item.
* **A retry window can starve a backlog.** Matching anchored on the newest
  pending meeting; recently ended meetings stay pending for 30 minutes, so the
  same batch was picked every tick and 1,600 backfilled meetings never moved.
  Recent and backlog are now separate batches each tick.
* **A truncated listing is not "no recording".** When the library listing hits
  its page cap, nothing is concluded as "none".
* **A drained 72-hour backlog carries old names.** Event payloads hold the name
  at event time; `/v1/users` is the authority for members' current names, and
  name history is recorded from it.
* **Relative to the meeting alone, overlap lies**: a 2-person chat beside a
  50-person workshop "fully overlaps" the workshop's library item. Overlap is
  shared over the larger side.
* **First-run alerts are a flood.** The first automation run records existing
  A04/A05/A06 conditions as seen, silently; only what appears after go-live is
  DMed.

## Verification

* `npm run check:camp` — 108 assertions, covering:
  * normalization and romanization;
  * N01–N13;
  * matching, duplicate levels and registry checks;
  * room placement and BR-ATT-01..04 scoring;
  * library matching;
  * both importers and cue shifting;
  * the settings patch (a one-key save must never rewrite the other keys).
* `scripts/qa/db-assertions.sql` — 9 assertions against the migrated schema,
  inside a transaction that rolls back:
  * sign-in constraints;
  * the decision-table guards (FR-USR-05, FR-ATT-09);
  * every cue and template seeded disabled, with popups within 100 characters.
* Live smoke (2026-10-05), read-only against the camp office:
  * the sync read every member and guest, and the working hours;
  * it backfilled the meetings since the camp started;
  * it linked every titled large meeting to its library item;
  * a synthetic registry and agenda built from the live names imported with
    0 issues, and produced day sheets, summaries, coverage and time windows.
* Browser pass of every screen in Arabic, English and dark mode, plus:
  * sign-in;
  * the forced password change;
  * user creation, roles and disabling (a disabled user is signed out on their
    next request).
