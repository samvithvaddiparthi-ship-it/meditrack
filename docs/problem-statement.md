# Problem Statement — MediTrack

## Problem

Pharmacies, hospital stores and medical shops stock the same medicine in many
**batches**, each with its own batch number, manufacturing date, expiry date,
quantity, cost, supplier and storage condition. When this is tracked on paper
or in spreadsheets:

- batches **expire unnoticed** on the shelf and are discovered only at disposal;
- **expired stock can be dispensed** by mistake, a patient-safety risk;
- **shortages are not detected** until a medicine runs out;
- older stock is not used first, so **wastage and financial loss** grow;
- there is **no trustworthy history** of who received, issued, wasted or
  corrected which stock, and quantities drift away from reality;
- incidents (damaged packs, count mismatches, fridge failures) are reported
  informally and never reviewed.

## Objectives

1. Keep an accurate, **batch-level** inventory whose quantities can change only
   through a validated, permanent stock ledger.
2. Enforce **First-Expiry-First-Out** allocation and make it **impossible to
   issue expired stock** through ordinary issues.
3. Record supplier **purchases and stock receipts** atomically and protect
   against duplicate submissions.
4. Give early warning through **expiry** and **low-stock** alerts computed from
   live data.
5. Capture **incident reports** with flexible, type-specific details and an
   auditable review workflow.
6. Provide **role-based** access (administrators vs. pharmacy staff) with
   secure authentication.
7. Demonstrate sound **database design**: normalised relational schema,
   constraints, indexes, transactions, triggers, views, stored procedures,
   full-text search and a NoSQL document store chosen for the right data.

## Scope

**In scope:** medicines and categories; suppliers; purchases and receipts;
medicine batches; stock issue (FEFO), waste and adjustments; the stock ledger;
expiry, low-stock, depletion and waste alerts; dashboards and reports;
incident reports and their review; activity/audit logging; user accounts and
roles for a single store.

**Out of scope (deliberately):** patient records, prescriptions, diagnoses or
any clinical recommendation; billing/point-of-sale; multi-store transfers;
integration with external supplier systems.

## Users and roles

| Role | Responsibilities |
|---|---|
| **ADMIN** (pharmacy manager) | Everything staff can do, plus: manage medicines, categories, suppliers and user accounts; increase stock through adjustments; bulk write-off of expired stock; review and resolve incident reports; view financial values, the activity log and the database inspector. |
| **STAFF** (pharmacist / store keeper) | View medicines, batches and suppliers; record stock receipts, issues, waste and stock decreases; view alerts, the ledger and reports (without financial values); create incident reports and view their own. |

## Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | Users sign in with email and password; sessions expire after 8 hours; repeated failures lock the account temporarily; users can sign out. |
| FR-2 | The system enforces ADMIN/STAFF permissions on the server for every page, form submission and API call. |
| FR-3 | Admins add, edit, deactivate/reactivate and (if unused) delete medicines; duplicate medicines (same name, strength, form, manufacturer) are rejected. |
| FR-4 | Users search medicines by name, generic name or manufacturer and filter/sort/paginate the list; each medicine shows its batches, stock summary, movement history and related incidents. |
| FR-5 | Each batch has a unique number per medicine, manufacturing and expiry dates (expiry after manufacture), non-negative quantity and unit cost; its status (Available, Expiring soon, Expired, Depleted) is computed from the current date. |
| FR-6 | Admins manage suppliers (contact details, address, licence number, active flag); suppliers with purchases cannot be deleted. |
| FR-7 | Users record a purchase receipt with several items (medicine, batch number, dates, quantity, unit cost); everything is saved in one transaction; the same submission or the same supplier invoice cannot be recorded twice; expired stock cannot be received. |
| FR-8 | Users issue stock of a medicine to a destination; the system allocates eligible batches FEFO (earliest expiry first, excluding expired and empty batches), records each batch used, and rejects issues exceeding available stock. |
| FR-9 | Users record waste (expired, damaged, recalled, contaminated, other) and stock decreases; only admins record increases; every adjustment needs a justification. |
| FR-10 | Admins write off all expired stock in a single atomic operation. |
| FR-11 | Every stock movement is stored permanently in the ledger with batch, type, quantity, user, reference, notes, time and resulting balance; ledger rows cannot be edited or deleted. |
| FR-12 | Expiry alerts list expired and soon-to-expire batches (window configurable, default 30 days) with medicine, batch, quantity, expiry date, days remaining, supplier and recommended action. |
| FR-13 | Low-stock alerts list active medicines whose usable (unexpired) stock is at or below their reorder level; depleted batches and waste are summarised. |
| FR-14 | Users create incident reports (damaged medicine, damaged packaging, stock discrepancy, storage temperature, other) with type-specific details; staff see their own reports; admins search, filter and change status along allowed transitions, each change being added to a timeline. |
| FR-15 | The dashboard shows active medicines, units in stock, low-stock medicines, expired batches, batches expiring soon, recent movements, recent purchases and recent incidents — all from live queries. |
| FR-16 | Reports show stock by category, monthly movement, top issued medicines, supplier totals, wastage, slow movers, ledger reconciliation and incident statistics. |
| FR-17 | Important actions are recorded in an activity log viewable by admins; no passwords, tokens or secrets are logged. |
| FR-18 | Admins create users, change roles, deactivate accounts (which signs them out) and reset passwords; the last active admin cannot be removed. |

## Non-functional requirements

- Data integrity enforced in the database (constraints, triggers, transactions), not only in the UI.
- Passwords hashed (bcrypt); secrets only in environment variables.
- Concurrency-safe stock updates and idempotent form submissions.
- Responsive, accessible interface (labels, keyboard focus, table views of charts).
- Reproducible setup: migrations, seed data, Docker Compose, automated tests.
