# Relational Schema — MediTrack (MySQL 8.4, InnoDB, utf8mb4)

Source of truth: [prisma/schema.prisma](../prisma/schema.prisma) and the SQL in
[prisma/migrations/](../prisma/migrations/). The ER diagram is
[er-diagram.mmd](er-diagram.mmd); column details are in
[data-dictionary.md](data-dictionary.md). Underlined = primary key, *italic* =
foreign key.

## Relations

```
users            (id, name, email, password_hash, role, is_active, failed_login_count,
                  locked_until, last_login_at, created_at, updated_at)
sessions         (id, *user_id*, expires_at, user_agent, created_at)
categories       (id, name, description, created_at, updated_at)
medicines        (id, name, generic_name, *category_id*, manufacturer, dosage_form, strength,
                  unit, storage_condition, description, reorder_level, is_active,
                  created_at, updated_at)
suppliers        (id, name, contact_person, phone, email, address, license_number,
                  is_active, created_at, updated_at)
medicine_batches (id, *medicine_id*, batch_number, manufacture_date, expiry_date, quantity,
                  unit_cost, created_at, updated_at)
purchases        (id, *supplier_id*, invoice_number, purchase_date, *received_by_id*, notes,
                  idempotency_key, created_at, updated_at)
purchase_items   (id, *purchase_id*, *batch_id*, quantity, unit_cost, created_at)
stock_operations (id, type, idempotency_key, *performed_by_id*, destination, reason, notes,
                  created_at)
stock_transactions (id, *batch_id*, type, quantity, balance_after, *performed_by_id*,
                  *purchase_item_id*, *operation_id*, notes, created_at)
audit_outbox     (id, payload, attempts, last_error, delivered_at, created_at)
```

All primary keys are surrogate `INT AUTO_INCREMENT` except `sessions.id`
(`CHAR(64)`, the SHA-256 hash of the session token).

## Keys

| Table | Primary key | Alternate (UNIQUE) keys | Foreign keys → referenced table (ON DELETE / ON UPDATE) |
|---|---|---|---|
| users | id | email (`uq_users_email`) | — |
| sessions | id | — | user_id → users (**CASCADE** / RESTRICT) |
| categories | id | name | — |
| medicines | id | (name, strength, dosage_form, manufacturer) `uq_medicines_identity` | category_id → categories (RESTRICT / RESTRICT) |
| suppliers | id | name; license_number (NULLs allowed) | — |
| medicine_batches | id | (medicine_id, batch_number) | medicine_id → medicines (RESTRICT / RESTRICT) |
| purchases | id | idempotency_key; (supplier_id, invoice_number) | supplier_id → suppliers (RESTRICT); received_by_id → users (RESTRICT) |
| purchase_items | id | (purchase_id, batch_id) | purchase_id → purchases (RESTRICT); batch_id → medicine_batches (RESTRICT) |
| stock_operations | id | idempotency_key | performed_by_id → users (RESTRICT) |
| stock_transactions | id | purchase_item_id (NULLs allowed) | batch_id → medicine_batches; performed_by_id → users; purchase_item_id → purchase_items; operation_id → stock_operations (all RESTRICT) |
| audit_outbox | id | — | — |

`ON DELETE RESTRICT` everywhere except sessions protects history: a medicine
with batches, a supplier with purchases or a user with ledger rows cannot be
deleted (the application offers *deactivate* instead). Sessions cascade because
they have no historical value. `ON UPDATE RESTRICT` is used because surrogate
keys never change (and MySQL forbids CHECK constraints on columns with
cascading FK actions).

## Relationships and cardinalities

| Relationship | Cardinality | Implemented by |
|---|---|---|
| Category classifies Medicine | 1 : N | medicines.category_id (NOT NULL) |
| Medicine is stocked as Batch | 1 : N | medicine_batches.medicine_id (NOT NULL) |
| Supplier supplies Purchase | 1 : N | purchases.supplier_id |
| User receives Purchase | 1 : N | purchases.received_by_id |
| Purchase contains Purchase item | 1 : N (≥ 1, enforced by the application/transaction) | purchase_items.purchase_id |
| Batch received via Purchase item | 1 : N (a batch can arrive in several deliveries) | purchase_items.batch_id |
| Purchase item produces STOCK_IN transaction | 1 : 0..1 (exactly one after commit) | UNIQUE stock_transactions.purchase_item_id + trigger |
| Batch moves in Stock transaction | 1 : N | stock_transactions.batch_id |
| User performs Stock transaction / Operation | 1 : N | performed_by_id |
| Stock operation groups Stock transactions | 1 : N (a FEFO issue may use several batches) | stock_transactions.operation_id |
| User has Sessions | 1 : N | sessions.user_id |

Purchase items reference the medicine **through the batch**
(`purchase_items → medicine_batches → medicines`). Storing `medicine_id` again
in `purchase_items` would create the transitive dependency
`batch_id → medicine_id` and break 3NF.

## Constraints

### CHECK constraints (23, database-level validation)

| Table | Constraint | Rule |
|---|---|---|
| users | chk_users_email_format | email matches `^[^@\s]+@[^@\s]+\.[^@\s]+$` |
| users | chk_users_name_not_blank | `CHAR_LENGTH(TRIM(name)) > 0` |
| users | chk_users_failed_logins | failed_login_count ≥ 0 |
| categories | chk_categories_name_not_blank | name not blank |
| medicines | chk_medicines_name_not_blank, chk_medicines_strength_not_blank | not blank |
| medicines | chk_medicines_reorder_level | reorder_level BETWEEN 0 AND 1 000 000 |
| suppliers | chk_suppliers_name_not_blank | not blank |
| suppliers | chk_suppliers_phone_format | `^[0-9+() -]{7,20}$` |
| suppliers | chk_suppliers_email_format | NULL or valid format |
| medicine_batches | chk_batches_number_not_blank | not blank |
| medicine_batches | chk_batches_quantity_non_negative | quantity ≥ 0 |
| medicine_batches | chk_batches_unit_cost | unit_cost ≥ 0 |
| medicine_batches | chk_batches_expiry_after_manufacture | expiry_date > manufacture_date |
| purchases | chk_purchases_invoice_not_blank | not blank |
| purchase_items | chk_purchase_items_quantity | quantity > 0 |
| purchase_items | chk_purchase_items_unit_cost | unit_cost ≥ 0 |
| stock_operations | chk_operations_reason | ISSUE ⇒ reason NULL; WASTE ⇒ reason ∈ {EXPIRED, DAMAGED, RECALLED, CONTAMINATED, OTHER}; ADJUSTMENT ⇒ reason ∈ {COUNT_CORRECTION, DAMAGED, OTHER} |
| stock_operations | chk_operations_destination | ISSUE ⇒ destination NOT NULL |
| stock_transactions | chk_transactions_quantity_positive | quantity > 0 |
| stock_transactions | chk_transactions_balance_non_negative | balance_after ≥ 0 |
| stock_transactions | chk_transactions_source | STOCK_IN ⇔ purchase_item_id NOT NULL and operation_id NULL; otherwise operation_id NOT NULL and purchase_item_id NULL |
| audit_outbox | chk_outbox_attempts | attempts ≥ 0 |

### Other constraints

- **NOT NULL** on every mandatory attribute; optional ones are explicitly NULL.
- **ENUM** domains: `role`, `dosage_form`, `storage_condition`,
  `stock_operations.type`, `stock_transactions.type`, `reason`.
- **Triggers** enforce rules a CHECK cannot (they need other rows or the
  current date): no issue from expired batches, no negative stock, no stock-in
  to expired batches, stock-in must match its purchase line, movement type must
  match the operation type, no future-dated movements, batch quantity changes
  only through the ledger, batch identity/dates immutable, ledger append-only.
  See [database-concepts.md](database-concepts.md#2-triggers).

## Indexes (42 in total, incl. primary keys)

Listed with purpose in [database-concepts.md](database-concepts.md#5-indexing).

## Normalisation

- **1NF** — atomic columns, no repeating groups (purchase lines and ledger rows
  are separate tables, not lists inside a row).
- **2NF** — every table has a single-column surrogate key, so there are no
  partial dependencies; natural composite keys (e.g. medicine_id +
  batch_number) are enforced as UNIQUE.
- **3NF** — no transitive dependencies: category name lives only in
  `categories`; supplier details only in `suppliers`; the medicine of a
  purchase line is reached through its batch; **derived values are not
  stored** — purchase totals, medicine stock totals, batch status and days to
  expiry are computed by views/queries.
- **Deliberate, controlled redundancy:** `medicine_batches.quantity` (the
  current balance) and `stock_transactions.balance_after` duplicate
  information derivable from the ledger. They are kept for performance and
  auditability, written **only by the trigger**, and continuously verified by
  `v_stock_reconciliation` (difference must be 0; tested and shown on the
  Reports page).

## MongoDB data model

| Collection | Document shape | Validation | Indexes | Retrieval |
|---|---|---|---|---|
| `incident_reports` | `{ reference "INC-00001", type, title, description, severity, status, medicine {id,name}?, batch {id,batchNumber,expiryDate}?, reporter {id,name,role}, metadata {…type-specific}, timeline [{at, actor, action, fromStatus, toStatus, note}], createdAt, updatedAt }` | `$jsonSchema` (required fields, enums, int ids, reference pattern, timeline items) — `validationLevel: strict` | unique `reference`; `{status, severity, createdAt}`; `{type, createdAt}`; `{reporter.id, createdAt}`; `{medicine.id}`; text `{title, description}` | list with filters + `$text` search; staff filtered by `reporter.id`; `$facet` aggregation for statistics |
| `activity_logs` | `{ _id "outbox:<n>", action "entity.verb", entityType, entityId, summary, actor {id,name,role}?, details {…}, createdAt, outboxId }` | `$jsonSchema` (action pattern, required fields) | `{createdAt}`; `{entityType, entityId, createdAt}`; `{actor.id, createdAt}`; `{action, createdAt}` | paginated by time with filters; `$group` by action |
| `counters` | `{ _id "incident_reports", value }` | — | `_id` | atomic `findOneAndUpdate($inc)` for references |

Details: [data-dictionary.md](data-dictionary.md#mongodb).
