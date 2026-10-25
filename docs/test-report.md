# Test Report — MediTrack

Executed on **25 Oct 2026** on macOS (arm64), Node.js 24.13, MySQL 8.4.13 and
MongoDB 8.0 (Docker), Next.js 16.4.3. All results below are from real runs;
nothing is mocked except the `server-only` import guard.

## Summary

| Check | Command | Result |
|---|---|---|
| Type checking | `npm run typecheck` (`next typegen && tsc --noEmit`) | ✅ 0 errors |
| Linting | `npm run lint` (ESLint, next/core-web-vitals + TypeScript rules) | ✅ 0 errors, 0 warnings |
| Unit tests | `npm run test:unit` | ✅ 40 / 40 passed (5 files) |
| Integration tests | `npm run test:integration` | ✅ 56 / 56 passed (9 files, real MySQL + MongoDB) |
| All tests | `npm test` | ✅ **96 / 96 passed** (14 files, ~50 s) |
| Production build | `npm run build` | ✅ compiled, 46 routes, no warnings |
| End-to-end smoke test + screenshots | `npm run screenshots` against `next start` | ✅ 26 pages rendered without errors; staff `POST /api/medicines` → 403 |
| Schema drift | `prisma migrate diff` (migrations ↔ schema, live DB ↔ schema) | ✅ empty diff both ways |
| SQL demo script | `mysql meditrack < docs/sql-demo.sql` | ✅ ran to completion; ledger/operation/quantity totals identical before and after |

### How the integration tests work
`tests/integration/global-setup.ts` drops and recreates the dedicated database
`meditrack_test` and applies **all migrations** with `prisma migrate deploy`, so
the tests exercise the real tables, CHECK constraints, triggers, views,
functions and procedures. Before each test every table is truncated
(`TRUNCATE`, because the append-only trigger correctly blocks `DELETE`) and the
MongoDB database `meditrack_test` is emptied. The harness refuses to run
against any database whose name does not end in `_test`.

## Coverage of the required test areas

| # | Required area | Tests (file › test) | Result |
|---|---|---|---|
| 1 | Successful and unsuccessful login | auth › signs in with valid credentials and stores only a hash of the session token · rejects a wrong password or unknown email with the same generic message · locks the account after repeated failures · rejects deactivated accounts · logout deletes the server-side session · expired sessions and deactivated users are rejected · ignores malformed or forged tokens · stores passwords as bcrypt hashes | ✅ |
| 2 | Admin and staff authorisation | permissions (4 unit tests) · authorization › blocks STAFF from administrative mutations even when called directly · lets STAFF decrease but not increase stock · allows ADMIN to manage the catalogue · hides financial report values from STAFF · prevents admins from demoting/deactivating themselves · never removes the last active administrator · incidents › shows staff only their own reports · only reviewers change status · E2E: staff redirected to /forbidden, API 403 | ✅ |
| 3 | Medicine input validation | validation › medicine validation (4 tests) · catalog › validates updates and rejects duplicates · db-constraints › UNIQUE: duplicate medicines… · CHECK (reorder level) | ✅ |
| 4 | Batch quantity and date constraints | db-constraints › CHECK: expiry must be after manufacture; quantity and cost cannot be negative · TRIGGER: batches start empty and their quantity can only change through the ledger · validation › purchase validation (expiry/manufacture, future dates) | ✅ |
| 5 | Purchase receipts increase stock exactly once | purchases › creates the purchase, items, batches and increases stock exactly once · treats a repeated submission (same idempotency key) as the same receipt (incl. 2 concurrent retries) · rejects the same supplier invoice entered twice · the database refuses a second STOCK_IN for the same purchase line · adds a later delivery of the same batch to the existing batch row | ✅ |
| 6 | Stock issues reduce stock correctly | stock › reduces stock using the earliest-expiring batches first, atomically across batches · is idempotent for repeated submissions | ✅ |
| 7 | Rejection of issues exceeding available stock | stock › rejects an issue larger than the available stock and writes nothing · serialises concurrent issues so stock never goes negative · rejects waste or adjustments larger than the batch balance (trigger) | ✅ |
| 8 | Rejection of ordinary issues from expired batches | stock › never issues from expired batches, even when they are first by expiry · the ledger trigger rejects a direct STOCK_OUT from an expired batch · fefo › excludes expired batches, including one that expires today | ✅ |
| 9 | FEFO selection | fefo (7 unit tests) · stock › reduces stock using the earliest-expiring batches first · matches the read-only FEFO preview | ✅ |
| 10 | Rollback of failed multi-step stock operations | purchases › rolls back the WHOLE receipt when a later line fails · stock › rolls back earlier ledger rows when a later statement in the transaction fails · rejects an issue larger than … and writes nothing · writes off all expired stock through the stored procedure, once | ✅ |
| 11 | Expiry alerts | alerts › separates expired from expiring-soon batches within the window · honours a configurable window · derives batch status from live dates · dates › batchStatus (3 tests) | ✅ |
| 12 | Low-stock alerts | alerts › compares usable (unexpired) stock with the reorder level (includes medicine whose only stock is expired, at-level medicine, inactive medicine excluded) | ✅ |
| 13 | MongoDB incident report persistence | incidents › persists a document with a reference, MySQL snapshots and typed metadata · computes the discrepancy and validates cross-database references · supports text search and filters · status transitions with optimistic concurrency | ✅ |
| 14 | MongoDB aggregation results | incidents › aggregates counts by type, severity, status and month | ✅ |
| 15 | Referential integrity and invalid database operations | db-constraints › FOREIGN KEYS… · TRIGGER: the ledger rejects zero quantities, mismatched operations and is append-only · all views, functions and procedures exist · catalog › protects categories in use | ✅ |
| + | MySQL/MongoDB failure handling | outbox › commits the MySQL change, queues the audit event, and delivers it once MongoDB is back · reports a MongoDB outage for MongoDB-owned data instead of pretending success | ✅ |
| + | Dashboard metrics from live data | alerts › dashboard metrics are computed from the live tables and views | ✅ |
| + | Safe error messages | errors-and-audit › database error mapping (5 tests) · audit detail sanitising | ✅ |

## Full list of executed tests (96)

**Unit (40)** — `tests/unit`
- `fefo.test.ts` (7): takes the earliest-expiring batch first · spans several batches in expiry order when one is not enough · excludes expired batches, including one that expires today · excludes depleted batches · reports a shortfall instead of over-allocating · breaks expiry ties by batch id · rejects zero and negative quantities
- `dates.test.ts` (6): rolls over to the next calendar day at 18:30 UTC · validates calendar dates strictly · counts days until expiry · DEPLETED whenever quantity is zero · EXPIRED on and after the expiry date · EXPIRING_SOON inside the window and AVAILABLE outside it
- `validation.test.ts` (15): medicine (4) · purchase (5) · stock operation (2) · account (2) · incident (2)
- `permissions.test.ts` (4): admin has all permissions · staff day-to-day permissions · management functions denied to staff · assertCan throws ForbiddenError
- `errors-and-audit.test.ts` (8): trigger SIGNAL messages · mariadb driver prefixes · CHECK violations → friendly text · unique index identification · unknown errors never leaked · credential keys dropped from audit details · full-text query builder (2)

**Integration (56)** — `tests/integration` (real MySQL 8.4 + MongoDB 8)
- `auth.test.ts` (8), `authorization.test.ts` (6), `catalog.test.ts` (5),
  `purchases.test.ts` (7), `stock.test.ts` (11), `alerts.test.ts` (5),
  `db-constraints.test.ts` (6), `incidents.test.ts` (6), `outbox.test.ts` (2)
  — names as listed in the coverage table above.

## Manual / browser verification (performed)

Using the in-app browser and the Playwright smoke test:
- Admin and staff login/logout; staff navigating to `/admin/users` lands on
  `/forbidden`; the streamed response contains no admin data.
- FEFO issue of 70 strips of Metformin: preview showed 60 from MET-24C2
  (expires in 25 days) + 10 from MET-25N1; the committed operation page showed
  both batches with trigger-stamped balances 0 and 190.
- Stock receipt of 20 Salbutamol inhalers (batch number typed in lower case was
  stored as `SAL-26A1`); low-stock badge dropped from 6 to 5 after the receipt.
- Incident report created by staff through the form with type-specific
  metadata; review panel hidden for staff.
- Every page rendered at desktop (1440 px) and phone (390 px) widths.

## Remaining limitations

- The end-to-end smoke test uses the locally installed Google Chrome
  (`CHROME_PATH` can point elsewhere); it is a smoke test, not a full UI test suite.
- Admin-only pages requested by staff return HTTP 200 with a streamed redirect
  to `/forbidden` (because of the route's loading boundary) rather than a 403
  status; no protected data is sent. API routes return real 401/403 statuses.
- "Today" is fixed to the business time zone IST (UTC+05:30); a deployment in
  another time zone would need the offset changed in `fn_business_today()` and
  `src/lib/dates.ts`.
- Batch `unit_cost` keeps the cost of the first receipt; later deliveries of the
  same batch at a different price are recorded on their purchase lines but not
  averaged into the batch valuation.
