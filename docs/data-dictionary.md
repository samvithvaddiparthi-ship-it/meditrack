# Data Dictionary — MediTrack

Types are the actual MySQL column types created by the migrations. "PK" primary
key, "FK" foreign key, "UK" unique. All `DATETIME(3)` values are UTC; `DATE`
values are calendar dates (see [architecture.md §6](architecture.md#6-dates-and-time-zones)).

## MySQL

### users — application accounts
| Column | Type | Null | Key / default | Description / constraints |
|---|---|---|---|---|
| id | INT | no | PK, auto-increment | User identifier |
| name | VARCHAR(100) | no | | Full name; not blank (CHECK) |
| email | VARCHAR(191) | no | UK `uq_users_email` | Login email, stored lower-case; format CHECK |
| password_hash | VARCHAR(255) | no | | bcrypt hash (cost 12); never the plain password |
| role | ENUM('ADMIN','STAFF') | no | default STAFF | Role for access control |
| is_active | BOOLEAN | no | default TRUE | Inactive users cannot sign in; existing sessions are rejected |
| failed_login_count | INT | no | default 0 | Consecutive failed sign-ins (≥ 0) |
| locked_until | DATETIME(3) | yes | | Temporary lock after 5 failures (15 min) |
| last_login_at | DATETIME(3) | yes | | Last successful sign-in |
| created_at / updated_at | DATETIME(3) | no | CURRENT_TIMESTAMP(3) / set by app | Audit timestamps |

Index: `idx_users_role_active (role, is_active)` — counting active admins.

### sessions — server-side login sessions
| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| id | CHAR(64) | no | PK | SHA-256 (hex) of the random cookie token |
| user_id | INT | no | FK → users.id ON DELETE CASCADE | Owner |
| expires_at | DATETIME(3) | no | idx | Absolute expiry (8 h); purged hourly by `ev_purge_expired_sessions` |
| user_agent | VARCHAR(255) | yes | | Browser identification (informational) |
| created_at | DATETIME(3) | no | | Sign-in time |

### categories — medicine categories
| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| id | INT | no | PK | |
| name | VARCHAR(60) | no | UK | Category name; not blank |
| description | VARCHAR(255) | yes | | |
| created_at / updated_at | DATETIME(3) | no | | |

### medicines — catalogue
| Column | Type | Null | Key / default | Description / constraints |
|---|---|---|---|---|
| id | INT | no | PK | Medicine ID |
| name | VARCHAR(120) | no | part of UK `uq_medicines_identity`, FULLTEXT | Brand or common name; not blank |
| generic_name | VARCHAR(120) | yes | FULLTEXT | Generic / INN name |
| category_id | INT | no | FK → categories.id (RESTRICT) | |
| manufacturer | VARCHAR(120) | no | part of UK, FULLTEXT | |
| dosage_form | ENUM(TABLET, CAPSULE, SYRUP, SUSPENSION, INJECTION, OINTMENT, CREAM, DROPS, INHALER, POWDER, OTHER) | no | part of UK | |
| strength | VARCHAR(40) | no | part of UK | e.g. "500 mg"; not blank |
| unit | VARCHAR(20) | no | default 'unit' | Counting unit for stock (strip, vial, bottle…) |
| storage_condition | ENUM(ROOM_TEMPERATURE, COOL_DRY, REFRIGERATED, FROZEN) | no | default ROOM_TEMPERATURE | Storage requirement |
| description | VARCHAR(1000) | yes | | |
| reorder_level | INT | no | default 0 | Low-stock threshold; CHECK 0 … 1 000 000 |
| is_active | BOOLEAN | no | default TRUE | Inactive medicines cannot be received or issued |
| created_at / updated_at | DATETIME(3) | no | | |

UK `(name, strength, dosage_form, manufacturer)` prevents duplicate products
(case-insensitive collation). Indexes: `idx_medicines_category_active`,
`idx_medicines_active_name`, FULLTEXT `ft_medicines_search`.

### suppliers
| Column | Type | Null | Key / default | Description |
|---|---|---|---|---|
| id | INT | no | PK | Supplier ID |
| name | VARCHAR(120) | no | UK | Not blank |
| contact_person | VARCHAR(100) | yes | | |
| phone | VARCHAR(20) | no | | CHECK `^[0-9+() -]{7,20}$` |
| email | VARCHAR(191) | yes | | CHECK format when present |
| address | VARCHAR(255) | no | | |
| license_number | VARCHAR(50) | yes | UK | Drug licence number |
| is_active | BOOLEAN | no | default TRUE | Inactive suppliers cannot be used for new receipts |
| created_at / updated_at | DATETIME(3) | no | | |

### medicine_batches — physical lots
| Column | Type | Null | Key / default | Description / constraints |
|---|---|---|---|---|
| id | INT | no | PK | Batch ID |
| medicine_id | INT | no | FK → medicines.id (RESTRICT); UK with batch_number | |
| batch_number | VARCHAR(50) | no | UK `(medicine_id, batch_number)` | Manufacturer's lot number, stored upper-case; immutable |
| manufacture_date | DATE | no | | Not in the future (trigger); immutable |
| expiry_date | DATE | no | idx | CHECK `> manufacture_date`; immutable |
| quantity | INT | no | default 0 | On-hand balance; CHECK ≥ 0; **written only by the ledger trigger**; must be 0 on insert |
| unit_cost | DECIMAL(10,2) | no | | Cost per unit at first receipt; CHECK ≥ 0 |
| created_at / updated_at | DATETIME(3) | no | | updated_at also set by the trigger |

Derived (never stored): status, days to expiry, stock value — see `v_batch_stock`.

### purchases — supplier deliveries / receipts
| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| id | INT | no | PK | |
| supplier_id | INT | no | FK → suppliers.id; UK with invoice_number | |
| invoice_number | VARCHAR(50) | no | UK `(supplier_id, invoice_number)` | Same invoice cannot be received twice |
| purchase_date | DATE | no | idx | Invoice / receipt date (not in the future — validated) |
| received_by_id | INT | no | FK → users.id | Who recorded the receipt |
| notes | VARCHAR(500) | yes | | |
| idempotency_key | CHAR(36) | no | UK | UUID per form; prevents duplicate submission |
| created_at / updated_at | DATETIME(3) | no | | |

Totals (units, amount) are derived in `v_purchase_summary`.

### purchase_items — invoice lines
| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| id | INT | no | PK | |
| purchase_id | INT | no | FK → purchases.id; UK with batch_id | |
| batch_id | INT | no | FK → medicine_batches.id | Batch created or topped up by this line (medicine reached through it) |
| quantity | INT | no | | CHECK > 0 |
| unit_cost | DECIMAL(10,2) | no | | CHECK ≥ 0 |
| created_at | DATETIME(3) | no | | |

### stock_operations — issue / waste / adjustment headers
| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| id | INT | no | PK | Operation reference |
| type | ENUM('ISSUE','WASTE','ADJUSTMENT') | no | idx with created_at | |
| idempotency_key | CHAR(36) | no | UK | Duplicate-submission protection |
| performed_by_id | INT | no | FK → users.id | |
| destination | VARCHAR(120) | yes | | Ward / department / counter; required for ISSUE (CHECK) |
| reason | ENUM(EXPIRED, DAMAGED, RECALLED, CONTAMINATED, COUNT_CORRECTION, OTHER) | yes | | NULL for ISSUE; allowed values per type (CHECK) |
| notes | VARCHAR(500) | yes | | Mandatory justification for adjustments (validated) |
| created_at | DATETIME(3) | no | | |

### stock_transactions — append-only stock ledger
| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| id | INT | no | PK | Transaction ID |
| batch_id | INT | no | FK → medicine_batches.id; idx with created_at | Batch moved |
| type | ENUM(STOCK_IN, STOCK_OUT, WASTE, ADJUSTMENT_IN, ADJUSTMENT_OUT) | no | idx with created_at | Movement type; IN types add, others subtract |
| quantity | INT | no | | Always positive (CHECK > 0; trigger) |
| balance_after | INT | no | default 0 → set by trigger | Batch quantity after this movement (CHECK ≥ 0) |
| performed_by_id | INT | no | FK → users.id | Acting user |
| purchase_item_id | INT | yes | FK → purchase_items.id; **UK** | Set only for STOCK_IN (CHECK); unique ⇒ a line adds stock once |
| operation_id | INT | yes | FK → stock_operations.id | Set for every non-STOCK_IN movement (CHECK) |
| notes | VARCHAR(500) | yes | | Reason / notes |
| created_at | DATETIME(3) | no | idx | Movement time (future dates rejected by trigger) |

UPDATE and DELETE are rejected by triggers.

### audit_outbox — transactional outbox for MongoDB audit events
| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| id | INT | no | PK | Becomes `_id = "outbox:<id>"` in MongoDB |
| payload | JSON | no | | Sanitised event (action, entity, summary, actor, details, occurredAt) |
| attempts | INT | no | default 0 | Failed delivery attempts (≥ 0) |
| last_error | VARCHAR(500) | yes | | Last delivery error (connection strings removed) |
| delivered_at | DATETIME(3) | yes | idx `(delivered_at, id)` | NULL = pending |
| created_at | DATETIME(3) | no | | |

### Views
| View | Columns (main) | Purpose |
|---|---|---|
| v_batch_stock | batch_id, medicine_id, medicine_name, strength, dosage_form, unit, medicine_active, category_name, batch_number, manufacture_date, expiry_date, quantity, unit_cost, stock_value, days_to_expiry, status, supplier_name | Every batch with live status (30-day default window) and latest supplier (correlated subquery) |
| v_expiring_batches | as v_batch_stock | Batches with stock expiring in 1–30 days |
| v_expired_batches | as v_batch_stock | Expired batches still holding stock |
| v_inventory_summary | medicine_id, medicine_name, generic_name, strength, dosage_form, unit, manufacturer, category_id, category_name, reorder_level, is_active, batch_count, total_quantity, usable_quantity, expired_quantity, next_expiry, usable_value | Stock per medicine; usable excludes expired batches |
| v_low_stock_medicines | v_inventory_summary columns + shortfall | Active medicines with usable_quantity ≤ reorder_level |
| v_purchase_summary | purchase_id, invoice_number, purchase_date, supplier_id, supplier_name, received_by_id, received_by_name, item_count, total_units, total_amount, created_at | Purchase history with derived totals |
| v_stock_reconciliation | batch_id, medicine_id, batch_number, recorded_quantity, ledger_quantity, difference | Integrity check — difference must be 0 |

### Stored functions and procedures
| Routine | Parameters | Returns |
|---|---|---|
| fn_business_today() | — | DATE: today in IST (UTC+05:30) |
| fn_business_date(p_utc DATETIME(3)) | UTC timestamp | DATE in IST |
| fn_batch_status(p_quantity INT, p_expiry DATE, p_window_days INT) | | 'DEPLETED' / 'EXPIRED' / 'EXPIRING_SOON' / 'AVAILABLE' |
| sp_expiring_batches(IN p_days INT) | 1–365 | Result set of batches with stock and days_to_expiry ≤ p_days, with alert_status |
| sp_write_off_expired(IN p_user_id INT, IN p_idempotency_key CHAR(36)) | active admin id, UUID | One row: operation_id (NULL if nothing expired), batch_count, unit_count |

## MongoDB

### incident_reports
| Field | BSON type | Required | Description |
|---|---|---|---|
| _id | ObjectId | yes | Document id (used in URLs) |
| reference | string `^INC-[0-9]{5,}$` | yes, unique | Human-readable reference from `counters` |
| type | enum DAMAGED_MEDICINE, DAMAGED_PACKAGING, STOCK_DISCREPANCY, STORAGE_TEMPERATURE, OTHER | yes | |
| title | string (5–120) | yes | Text-indexed (weight 3) |
| description | string (10–2000) | yes | Text-indexed |
| severity | enum LOW, MEDIUM, HIGH, CRITICAL | yes | |
| status | enum OPEN, UNDER_REVIEW, RESOLVED, DISMISSED | yes | Changes only along allowed transitions |
| medicine | object `{ id: int, name: string }` or null | no | MySQL medicine reference + name snapshot |
| batch | object `{ id: int, batchNumber, expiryDate }` or null | no | Must belong to the medicine (validated against MySQL) |
| reporter | object `{ id: int, name, role }` | yes | Creator; staff only see their own reports |
| metadata | object | no | Type-specific: affectedQuantity, location, damageCause, packagingType, sealIntact, expectedQuantity, countedQuantity, difference (computed), recordedTemperatureC, durationMinutes |
| timeline | array of `{ at: date, actor, action: CREATED/STATUS_CHANGED, fromStatus?, toStatus?, note? }` | yes (≥ 1) | Embedded review history; appended atomically with each status change |
| createdAt / updatedAt | date | yes | |

### activity_logs
| Field | BSON type | Required | Description |
|---|---|---|---|
| _id | string `outbox:<id>` | yes | Idempotent delivery key |
| action | string `entity.verb` (e.g. `stock.issue`) | yes | |
| entityType | string | yes | medicine, purchase, stock_operation, incident, user, … |
| entityId | string or null | no | |
| summary | string (≤ 300) | yes | Human-readable description |
| actor | object `{ id: int, name, role }` or null | no | NULL for anonymous events (failed sign-in) |
| details | object | no | Sanitised extra data (no passwords/tokens/URIs) |
| createdAt | date | yes | When the event occurred |
| outboxId | int | no | Source row in MySQL `audit_outbox` |

### counters
| Field | Type | Description |
|---|---|---|
| _id | string | Sequence name (`incident_reports`) |
| value | int | Last issued number (atomic `$inc`) |
