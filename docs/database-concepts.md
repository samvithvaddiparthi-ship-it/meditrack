# Advanced Database Concepts — MediTrack

The rubric asks for at least four advanced concepts. MediTrack implements
**eight**, all as real database objects or operations used by the application:

| # | Concept | Where | Demonstrate |
|---|---|---|---|
| 1 | Transactions (commit / rollback, row locking) | `src/server/services/{purchases,stock}.service.ts`, `tx.ts`; procedure `sp_write_off_expired` | §1 |
| 2 | Triggers | migration `20261025094000_native_db_objects` §3 | §2 |
| 3 | Views | same migration §4 | §3 |
| 4 | Stored procedures & functions | same migration §2 and §5 | §4 |
| 5 | Indexing (B-tree, composite, unique) | `prisma/schema.prisma`, init migration | §5 |
| 6 | Full-text search | FULLTEXT `ft_medicines_search`, `listMedicines()` | §6 |
| 7 | NoSQL aggregation (MongoDB) | `incidentSummary()`, `activitySummary()` | §7 |
| 8 | Scheduled event | `ev_purge_expired_sessions` | §8 |

Everything can be inspected live on **Administration → Database inspector**
(`/admin/database`) and executed from [sql-demo.sql](sql-demo.sql).

---

## 1. Transactions

**Where:** every multi-step write runs inside `runTransaction()`
(`src/server/services/tx.ts`), an interactive Prisma transaction on one InnoDB
connection (isolation `REPEATABLE READ`, the MySQL default). Deadlocks and
lock-wait timeouts are retried because InnoDB has already rolled back the
victim.

| Operation | Statements in ONE transaction |
|---|---|
| Stock receipt `receivePurchase()` | INSERT purchase → per line: `SELECT … FOR UPDATE` existing batch or INSERT batch → INSERT purchase_item → INSERT STOCK_IN ledger row (trigger adds quantity) → INSERT audit_outbox |
| FEFO issue `issueStock()` | `SELECT … FOR UPDATE` eligible batches in FEFO order → INSERT stock_operation → INSERT one STOCK_OUT row per batch (trigger subtracts & validates) → INSERT audit_outbox |
| Waste / adjustment | INSERT stock_operation → INSERT ledger row → INSERT audit_outbox |
| Bulk expired write-off | Stored procedure with explicit `START TRANSACTION … COMMIT`, `EXIT HANDLER FOR SQLEXCEPTION … ROLLBACK; RESIGNAL` |
| Catalogue / user changes | the change + its audit_outbox row |

**Rollback examples (all automated tests):**
- A receipt whose 2nd line conflicts with an existing batch → the purchase,
  the 1st line's new batch and its ledger row are all rolled back
  (`purchases.test.ts › rolls back the WHOLE receipt`).
- An issue for more than the available stock → no operation, no ledger rows,
  quantities unchanged (`stock.test.ts › rejects an issue larger…`).
- Two ledger inserts where the second violates the stock rule → the first is
  undone too (`stock.test.ts › rolls back earlier ledger rows…`).

**Concurrency:** the FEFO `SELECT … FOR UPDATE` and the trigger's own
`SELECT … FOR UPDATE` lock the batch rows until commit, so concurrent issues
queue up. Test `serialises concurrent issues` fires three issues (60, 60, 30)
at 100 units simultaneously: exactly two succeed, one is rejected, 10 remain.

**Duplicate submissions:** `purchases.idempotency_key` and
`stock_operations.idempotency_key` are UNIQUE; a repeated form submission
returns the original result (`duplicate: true`) instead of moving stock twice.

**Demo:** sql-demo.sql Part 4 (START TRANSACTION → trigger-applied issue →
ROLLBACK → quantity restored). In the app: issue more than is available on
*Issue stock* → error, then open the medicine — nothing changed.

## 2. Triggers

| Trigger | Timing / event | Rule enforced |
|---|---|---|
| `trg_batches_before_insert` | BEFORE INSERT on medicine_batches | New batches start at quantity 0 (stock only via the ledger); manufacturing date not in the future |
| `trg_batches_before_update` | BEFORE UPDATE on medicine_batches | `quantity` may change only when the ledger trigger authorised it (session flag `@meditrack_ledger_batch`, consumed on use); medicine, batch number and dates are immutable |
| `trg_stock_transactions_before_insert` | BEFORE INSERT on stock_transactions | (1) quantity > 0; (2) not dated in the future; (3) movement type matches the operation type; (4) STOCK_IN must match its purchase line's batch and quantity; (5) locks the batch row `FOR UPDATE`; (6) no stock-in to a batch already expired at the movement date; (7) **no STOCK_OUT from an expired batch** (expiry ≤ today); (8) **stock may not become negative**; then applies `quantity ± n`, sets `updated_at` and stamps `NEW.balance_after` |
| `trg_stock_transactions_before_update` | BEFORE UPDATE on stock_transactions | Ledger is append-only |
| `trg_stock_transactions_before_delete` | BEFORE DELETE on stock_transactions | Ledger is append-only |

**Why a trigger owns the quantity:** it is the single update mechanism. The
application only inserts ledger rows and never writes `quantity`, so the
quantity cannot be applied twice, cannot be changed by a stray UPDATE, and
always equals the ledger sum (`v_stock_reconciliation`). Because the trigger
runs inside the caller's transaction, a ROLLBACK undoes the quantity change and
the ledger row together.

Errors raised with `SIGNAL SQLSTATE '45000'` carry user-readable messages that
the application shows directly (e.g. *"Cannot issue from an expired batch;
record it as waste instead"*).

**Demo:** sql-demo.sql §4.2 (uncomment one statement at a time), or
`tests/integration/db-constraints.test.ts`. In MySQL:
```sql
UPDATE medicine_batches SET quantity = 999 WHERE id = 1;
-- ERROR 1644 (45000): Batch quantity can only change through the stock_transactions ledger
DELETE FROM stock_transactions WHERE id = 1;
-- ERROR 1644 (45000): The stock ledger is append-only; ledger rows cannot be deleted
```

## 3. Views

| View | Used by | Notes |
|---|---|---|
| `v_batch_stock` | Batch inventory page, `/api/batches`, procedure `sp_expiring_batches` | Joins batches/medicines/categories; computes stock value, days to expiry, status (`fn_batch_status`) and latest supplier (correlated subquery) |
| `v_expiring_batches` | SQL demo | Stock expiring in 1–30 days |
| `v_expired_batches` | SQL demo | Expired stock awaiting write-off |
| `v_inventory_summary` | Medicine list, medicine details, issue form, reports | `LEFT JOIN` + `GROUP BY`; usable vs expired quantities; next expiry; value |
| `v_low_stock_medicines` | Low-stock page, dashboard, sidebar badge | Active medicines with usable ≤ reorder level, plus shortfall |
| `v_purchase_summary` | Purchase history, dashboard, supplier report | Derived totals (amounts are never stored) |
| `v_stock_reconciliation` | Dashboard alert, Reports page, tests, seed verification | `recorded_quantity − ledger_quantity` must be 0 |

**Demo:** `SELECT * FROM v_low_stock_medicines;` (sql-demo.sql §3.1–3.2).

## 4. Stored procedures and functions

### `sp_expiring_batches(IN p_days INT)`
- **Input:** `p_days` 1–365 (else `SIGNAL 'p_days must be between 1 and 365'`).
- **Output:** result set — batch_id, medicine_id, medicine_name, strength,
  unit, category_name, batch_number, expiry_date, quantity, days_to_expiry,
  alert_status (`EXPIRED` / `EXPIRING_SOON`), supplier_name, stock_value — for
  batches that hold stock and expire within `p_days` (already-expired included),
  ordered by expiry.
- **Called by the application:** *Expiry alerts* page and `GET /api/alerts/expiry?days=N`
  (`expiryAlerts()` → `CALL sp_expiring_batches(?)`).
- **Example:** `CALL sp_expiring_batches(30);`

### `sp_write_off_expired(IN p_user_id INT, IN p_idempotency_key CHAR(36))`
- Verifies the user is an active ADMIN; `START TRANSACTION`; inserts one WASTE
  operation (reason EXPIRED); a **cursor** loops over expired batches with
  stock inserting one WASTE ledger row each (the trigger zeroes the batch);
  queues the audit event in `audit_outbox`; `COMMIT`. Any error →
  `ROLLBACK; RESIGNAL`. Nothing expired → rollback and `operation_id = NULL`.
  Re-using the idempotency key fails on the UNIQUE index (no double write-off).
- **Output:** one row `operation_id, batch_count, unit_count`.
- **Called by the application:** *Waste & adjustments → Bulk write-off* (admin).
- Why a cursor: `INSERT … SELECT FROM medicine_batches` cannot be used because
  the trigger updates `medicine_batches` (MySQL error 1442).

### Functions
- `fn_business_today()` — today's date in IST; used by triggers, views, procedures and queries.
- `fn_business_date(ts)` — IST date of a UTC timestamp (monthly reports, movement dates).
- `fn_batch_status(qty, expiry, window)` — status rule shared by views and the batch list.

## 5. Indexing

| Index | Columns | Queries that benefit |
|---|---|---|
| PRIMARY (every table) | id | Row lookup, FK targets |
| `uq_users_email` | users.email | Login lookup; duplicate e-mails rejected |
| `idx_users_role_active` | (role, is_active) | "At least one active admin" check |
| `idx_sessions_user`, `idx_sessions_expires` | user_id; expires_at | Revoking a user's sessions; hourly purge event |
| `uq_categories_name` | name | Duplicate prevention |
| `uq_medicines_identity` | (name, strength, dosage_form, manufacturer) | Duplicate-product prevention; its leftmost column serves name lookups/sorting (`WHERE name LIKE 'Para%'`, `ORDER BY name`) — the separate name index was dropped as redundant (migration `…_drop_redundant_medicine_name_index`) |
| `idx_medicines_category_active` | (category_id, is_active) | Category filter on the medicine list; FK lookup |
| `idx_medicines_active_name` | (is_active, name) | Default list "active medicines ordered by name"; issue-form picker |
| `ft_medicines_search` (FULLTEXT) | (name, generic_name, manufacturer) | Medicine search (§6) |
| `uq_suppliers_name`, `uq_suppliers_license` | name; license_number | Duplicate prevention |
| `idx_suppliers_active_name` | (is_active, name) | Active supplier picker / filter |
| `uq_batches_medicine_number` | (medicine_id, batch_number) | Batch identification on receipt (`WHERE medicine_id=? AND batch_number=? FOR UPDATE`); FK lookup by medicine |
| `idx_batches_fefo` | (medicine_id, expiry_date) | FEFO selection `WHERE medicine_id=? … ORDER BY expiry_date` (no filesort) |
| `idx_batches_expiry` | expiry_date | Expiry alerts / dashboard counts (`expiry_date <= today + N`) |
| `uq_purchases_idempotency` | idempotency_key | Duplicate-submission check |
| `uq_purchases_supplier_invoice` | (supplier_id, invoice_number) | Same invoice never received twice; supplier's purchases |
| `idx_purchases_date`, `idx_purchases_received_by` | purchase_date; received_by_id | History sorted/filtered by date; FK |
| `uq_purchase_items_purchase_batch` | (purchase_id, batch_id) | Lines of a purchase; one line per batch |
| `idx_purchase_items_batch` | batch_id | "Received through" on batch page; latest-supplier subquery |
| `uq_operations_idempotency` | idempotency_key | Duplicate-submission check |
| `idx_operations_type_created`, `idx_operations_user` | (type, created_at); performed_by_id | Waste summary by period; FK |
| `idx_transactions_batch_created` | (batch_id, created_at) | Batch ledger in time order; reconciliation |
| `idx_transactions_type_created` | (type, created_at) | Top-issued / waste reports over a date range |
| `idx_transactions_created` | created_at | Ledger newest-first, dashboard trend, monthly report |
| `idx_transactions_user`, `idx_transactions_operation` | performed_by_id; operation_id | "By user" filter; batches of an operation |
| `uq_transactions_purchase_item` | purchase_item_id | Exactly-once stock-in |
| `idx_outbox_pending` | (delivered_at, id) | Fetching undelivered audit events in order |

**Demo:** sql-demo.sql §3.5 runs `EXPLAIN` for the FEFO, expiry, batch-lookup,
ledger and name-prefix queries; the `key` column shows the index chosen.
MongoDB indexes are listed in [relational-schema.md](relational-schema.md#mongodb-data-model).

## 6. Full-text search

`FULLTEXT ft_medicines_search (name, generic_name, manufacturer)`. The medicine
list converts the search box into a safe boolean-mode query (operators
stripped, each term required and prefix-matched: `amox cap` → `+amox* +cap*`)
and runs `MATCH(name, generic_name, manufacturer) AGAINST (? IN BOOLEAN MODE)`.
Terms shorter than InnoDB's minimum token size (3) fall back to `LIKE`.
Code: `toFullTextQuery()` / `listMedicines()` in `catalog.service.ts`.
**Demo:** search "amox" or "novacure" on *Medicines*; sql-demo.sql §3.6.

## 7. NoSQL aggregation (MongoDB)

```js
db.incident_reports.aggregate([
  { $match: visibility },                       // staff: { "reporter.id": me }
  { $facet: {
      byType:         [{ $group: { _id: "$type", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
      bySeverity:     [{ $group: { _id: "$severity", count: { $sum: 1 } } }],
      byStatus:       [{ $group: { _id: "$status", count: { $sum: 1 } } }],
      openBySeverity: [{ $match: { status: { $in: ["OPEN","UNDER_REVIEW"] } } },
                       { $group: { _id: "$severity", count: { $sum: 1 } } }],
      monthly:        [{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "Asia/Kolkata" } },
                                   count: { $sum: 1 },
                                   critical: { $sum: { $cond: [{ $in: ["$severity", ["HIGH","CRITICAL"]] }, 1, 0] } } } },
                       { $sort: { _id: 1 } }],
      total:          [{ $count: "count" }] } }
])
```
Displayed on *Incident reports* (type and severity charts, KPI tiles) and
*Reports* (status chart, monthly trend). A second pipeline
(`$match` last 30 days → `$group` by action → `$sort`) powers the
*Activity log* chart. Also used: `$text` search, atomic `findOneAndUpdate($inc)`
counters, optimistic-concurrency `updateOne({_id, status}, {$set, $push})`.
**Demo:** `/incidents`, `/reports`, `/admin/activity`; test
`incidents.test.ts › aggregates counts by type, severity, status and month`.

## 8. Scheduled event

`ev_purge_expired_sessions` runs every hour and deletes sessions that expired
more than a day ago (`event_scheduler` is ON by default in MySQL 8).
**Demo:** `SHOW EVENTS FROM meditrack;` or the Database inspector.

---

## DDL / DML coverage

| Statement | Where |
|---|---|
| CREATE (TABLE, INDEX, VIEW, TRIGGER, FUNCTION, PROCEDURE, EVENT) | migrations; sql-demo.sql Part 5 |
| ALTER (ADD CONSTRAINT CHECK, ADD FOREIGN KEY, ADD COLUMN) | migrations; sql-demo.sql Part 5 |
| DROP (INDEX, COLUMN, TABLE, DATABASE) | migration `…_drop_redundant_medicine_name_index`; sql-demo.sql Part 5 |
| INSERT / UPDATE / DELETE / SELECT | every service; sql-demo.sql; deletes of unused medicines, suppliers, categories in the app |
| JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries (scalar, IN, EXISTS/NOT EXISTS, correlated, derived table) | `inventory.service.ts` (Reports page), views, sql-demo.sql Parts 1–2 |
