# Architecture — MediTrack

Diagram: [system-architecture.mmd](system-architecture.mmd) · ER diagram: [er-diagram.mmd](er-diagram.mmd)

## 1. Overview

MediTrack is a single Next.js 16 application (App Router, Node.js runtime)
backed by two databases:

| Layer | Responsibility | Code |
|---|---|---|
| Browser | React pages and forms; client components only for interactivity (forms, FEFO preview, charts, mobile menu) | `src/app/**/*.tsx`, `src/components` |
| Proxy | Optimistic check: requests without a session cookie go to `/login` (pages) or get `401` (API) | `src/proxy.ts` |
| Server Components | Render every page at request time with live data | `src/app/(app)/**/page.tsx` |
| Server Actions | Form mutations (create medicine, receive stock, issue, waste…) | `src/app/(app)/**/actions.ts` |
| Route Handlers | JSON API for the same operations (`/api/medicines`, `/api/stock/issue`, `/api/alerts/expiry`, …) | `src/app/api/**/route.ts`, wrapper `src/server/api.ts` |
| Auth & RBAC | Session validation, `requirePageAccess`, `requireActor`, permission matrix | `src/server/auth/session.ts`, `src/lib/permissions.ts`, `src/lib/authz.ts` |
| Service layer | All business logic and database access; framework-independent (also used by tests and scripts) | `src/server/services/*.ts` |
| MySQL 8.4 (InnoDB) | System of record for every structured / transactional entity | `prisma/schema.prisma`, `prisma/migrations/` |
| MongoDB 8 | Incident reports and the activity/audit log | `src/lib/mongo.ts`, `incidents.service.ts`, `audit.service.ts` |

The **Next.js application communicates with the databases only through the
backend layer** (server actions / route handlers → services). No database
credential or client ever reaches the browser.

## 2. Request flow

### Reading a page (e.g. `/alerts/expiry`)
1. `proxy.ts` sees the session cookie and lets the request through.
2. The `(app)` layout calls `requireUser()`: the cookie token is hashed
   (SHA-256) and looked up in `sessions`; expired sessions or deactivated users
   are rejected → redirect to `/login`.
3. The page calls `requirePageAccess("alerts:view")`; missing permission →
   redirect to `/forbidden`.
4. The service `expiryAlerts()` runs `CALL sp_expiring_batches(30)` through
   the MySQL driver pool and returns typed rows; the page renders them.

### Issuing stock (FEFO)
1. The client form posts `{ idempotencyKey, medicineId, quantity, destination }`
   to the `issueStockAction` server action (Next.js checks the Origin header
   for server actions).
2. `requireActor("stock:issue")` authenticates and authorises; Zod validates.
3. `issueStock()` (service) checks the idempotency key, then opens a MySQL
   transaction:
   - `SELECT … FROM medicine_batches WHERE medicine_id = ? AND quantity > 0
     AND expiry_date > fn_business_today() ORDER BY expiry_date, id FOR UPDATE`
     locks the eligible batches in FEFO order;
   - `allocateFefo()` (pure function) splits the quantity across batches; if
     stock is insufficient a `ValidationError` aborts the transaction;
   - inserts one `stock_operations` header and one `stock_transactions` row per
     batch. The **trigger** re-validates each row (not expired, enough stock),
     updates `medicine_batches.quantity` and stamps `balance_after`;
   - inserts the audit event into `audit_outbox`;
   - COMMIT (or ROLLBACK of everything on any error).
4. After commit the outbox is flushed to MongoDB `activity_logs`.
5. The action revalidates the layout (fresh alert counts) and the browser is
   sent to `/stock/operations/:id`, which lists the batches actually used.

## 3. Why MySQL and why MongoDB

| Data | Store | Reason |
|---|---|---|
| Users, sessions, categories, medicines, suppliers, batches, purchases, purchase items, stock operations, stock ledger | **MySQL** | Highly relational (every movement references a batch, a user and a purchase line or operation); needs **ACID transactions** across several tables, **row locks** for concurrent issues, **foreign keys**, **CHECK constraints** and **triggers** so that stock can never become negative or be issued after expiry. Reporting relies on joins, GROUP BY/HAVING and views. Authoritative quantities therefore live only in MySQL. |
| Incident reports | **MongoDB** | Each incident type records different details (a discrepancy has expected/counted quantities, a temperature excursion has temperature and duration, damaged packaging has packaging type and seal state). A document with a flexible `metadata` object models this without sparse tables or EAV. The review history is an **embedded array** (`timeline`) that grows with the document and is always read together with it. Text search on title/description uses a MongoDB text index; statistics use an aggregation pipeline (`$facet`, `$group`). |
| Activity / audit log | **MongoDB** | Append-mostly, schema-flexible events (`details` differ per action), high write volume, queried by time/actor/entity and aggregated by action. It must not slow down or lock the inventory tables. |

MySQL entities are referenced from MongoDB by id **plus a name snapshot**
(`medicine: { id, name }`), so reports display without cross-database joins and
remain historically accurate if a name changes later. References are validated
against MySQL before an incident is written.

## 4. Consistency between MySQL and MongoDB

MySQL and MongoDB cannot share one atomic transaction. The strategy:

1. **Inventory never depends on MongoDB.** All stock data and rules are in MySQL.
2. **Transactional outbox for audit events.** Every audit event is inserted
   into the MySQL table `audit_outbox` **inside the same transaction** as the
   business change (the stored procedure `sp_write_off_expired` does the same
   in SQL). So the event exists if and only if the change committed.
3. **Delivery** (`flushOutbox()`) runs after each commit: pending rows are
   upserted into `activity_logs` with `_id = "outbox:<id>"` (idempotent — a
   retry can never duplicate an event) and then marked `delivered_at`. If
   MongoDB is down, the rows stay pending, `attempts`/`last_error` are updated
   (connection strings are scrubbed), and the next flush retries. The UI shows
   "Saved. The activity log entry will be delivered when MongoDB is reachable."
   — it never claims the log was written when it was not.
4. **MongoDB-owned data** (incident reports): if MongoDB is unreachable the
   operation fails with a clear `503`-style message and nothing is claimed to
   be saved. Pages that combine both stores (dashboard, medicine details,
   reports) show the MySQL part and a warning panel for the MongoDB part.

Integration test `tests/integration/outbox.test.ts` demonstrates both cases.

## 5. Security boundaries

| Concern | Implementation |
|---|---|
| Passwords | bcrypt (cost 12) via `bcryptjs`; never logged, never returned; password policy ≥ 10 chars with letters and digits |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (production), path `/` cookie (`__Host-` prefix in production); only its SHA-256 hash is stored in `sessions`; 8-hour expiry; logout and deactivation delete sessions; an hourly MySQL event purges old sessions |
| Brute force | 5 failed logins lock the account for 15 minutes; identical error for unknown email / wrong password; dummy bcrypt comparison equalises timing |
| Authorisation | Single permission matrix (`src/lib/permissions.ts`); checked server-side in pages (`requirePageAccess`), actions/route handlers (`requireActor`) **and again inside every service** (`assertCan`); UI hiding is cosmetic only. Staff see only their own incident reports (row-level filter). Financial values are omitted from data sent to staff. |
| CSRF | Server actions: Next.js Origin check; route handlers: explicit Origin check for non-GET; cookies are `SameSite=Lax` |
| Injection | Prisma parameterised queries; raw SQL only through tagged templates (`$queryRaw\`…${value}\``) or driver placeholders (`?`); dynamic `ORDER BY` uses a whitelist; full-text input is stripped of boolean operators; MongoDB filters are built from validated enums, never from raw objects |
| Input validation | Zod on the server for every input; MySQL CHECK constraints, ENUMs, NOT NULL, UNIQUE, FKs and triggers; MongoDB `$jsonSchema` validators |
| Secrets | Only in environment variables (`.env`, git-ignored); `.env.example` has placeholders; audit details are sanitised (keys like password/token/secret/uri removed) |
| Error disclosure | `AppError` messages are user-safe; database rule messages (SIGNAL text, CHECK names) are mapped to friendly text; anything else is logged server-side and replaced with a generic message; the error boundary never shows stack traces |
| Headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`; `X-Powered-By` disabled |

## 6. Dates and time zones

- All `DATETIME(3)` columns store **UTC** (the MySQL server runs at `+00:00`;
  the driver pool sets the session time zone to UTC).
- Calendar facts (manufacture, expiry and purchase dates) are `DATE` columns.
- "Today" is the calendar date in the business time zone **IST (UTC+05:30, no
  DST)**: `fn_business_today()` in SQL and `businessToday()` in
  `src/lib/dates.ts` use the same offset, so database rules and the UI agree.
- A batch is **expired on and after its expiry date** (`expiry_date <= today`):
  it is never issued on its expiry day.
- Timestamps are displayed in IST.

## 7. Key design decisions

1. **One quantity-update mechanism.** Application code never writes
   `medicine_batches.quantity`. The ledger trigger is the only writer (a second
   trigger rejects any other change), so the quantity cannot be updated twice
   and always equals the sum of the ledger (`v_stock_reconciliation`).
2. **Append-only ledger.** UPDATE/DELETE on `stock_transactions` are rejected;
   corrections are adjustment rows. History is therefore trustworthy.
3. **Positive quantities + movement type.** `quantity > 0` always; the type
   decides the sign. This makes "reject zero/negative quantities" a single
   CHECK constraint.
4. **Exactly-once receipts.** `UNIQUE(stock_transactions.purchase_item_id)`
   plus the trigger check (`batch_id` and `quantity` must match the purchase
   line) guarantee that a receipt line adds stock exactly once.
5. **Idempotency keys** (`purchases.idempotency_key`,
   `stock_operations.idempotency_key`, generated per form) turn double-clicks
   and retries into "already recorded" instead of duplicate stock movements.
6. **Concurrency.** Issues lock candidate batches with `SELECT … FOR UPDATE` in
   a fixed order (expiry, id) and the trigger locks the batch row again, so
   concurrent issues serialise instead of overselling; deadlock/lock-timeout
   errors are retried by `runTransaction()`.
7. **Status derived, not stored.** Batch status is computed from
   `expiry_date`, `quantity` and today's date (`fn_batch_status`), so it can
   never be stale.
8. **Deactivate instead of delete.** Medicines, suppliers and users with
   history are deactivated; FKs use `ON DELETE RESTRICT`, so the database
   refuses deletes that would orphan history. Only rows without history can be
   deleted.
9. **Backdated history in the seed.** The seed inserts receipts and movements
   with past timestamps through the same triggers (which check expiry against
   the movement's own date for stock-in and against today for issues), so the
   demo data is internally consistent and realistic.
10. **No Cache Components.** Every page renders at request time because the
    data is live and per-user.
