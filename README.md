# Liferaft Services Operations

The service workflow system for Liferaft Services, LLC: customer tree, safety asset
records, QR labels, workflow stages, routes and loaners. Billing, customer messages,
inspections and parts forecasting follow in later stages.

The full design is in the blueprint document ("Liferaft Services Operations System:
Blueprint"), with the stage 1 build plan in its second tab.

## What is here so far (step 1, foundation)

| Path | What it is |
| --- | --- |
| `supabase/migrations/0001_core.sql` | Database structure for every stage 1 record |
| `supabase/migrations/0002_access.sql` | Access rules: signed-in, active staff only |
| `src/lib/workflow.ts` | Every stage and every allowed move, used by screens and server alike |
| `src/lib/system-id.ts` | The IDs printed on QR labels |
| `tests/` | Checks for the workflow rules, the IDs and the database structure |
| `src/app/` | The web app (a placeholder page for now) |

## Running it

```bash
npm install
npm test          # workflow, ID and database checks
npm run typecheck
npm run lint
npm run dev       # the app at http://localhost:3000
```

The database tests apply the real migration files to an in-memory PostgreSQL, so no
database account is needed to run them.

## Technology

- Next.js and TypeScript for the app.
- PostgreSQL for the data, hosted on Supabase, which also provides sign-in and file storage.
- Render for hosting the app.

## Rules worth knowing before changing anything

- `job_events` is the permanent record. Rows cannot be edited or deleted.
- An asset has one current owner and at most one open service job at a time.
- A workflow move is only valid if `checkMove` in `src/lib/workflow.ts` allows it.
- Training records are named with a `TRAINING` prefix and must never trigger customer contact.
