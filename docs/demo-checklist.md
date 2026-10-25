# Demo Checklist — evaluator presentation (≈ 20 minutes)

## Before the demo
- [ ] Docker Desktop running; `npm run db:up` (both containers healthy)
- [ ] `npm run db:reset` for clean, date-relative demo data (prints/uses the demo passwords)
- [ ] `npm run build && npm start` (or `npm run dev`) → http://localhost:3000
- [ ] `curl http://localhost:3000/api/health` → `"status":"ok"`
- [ ] Two browser windows: one signed in as **admin**, one (private window) as **staff**
- [ ] A MySQL client open on `meditrack` (e.g. `docker exec -it meditrack-mysql mysql -umeditrack -p meditrack`)

## 1. Problem & motivation (2 min) — README / problem-statement.md
- Batches expire unnoticed, expired stock gets dispensed, shortages surprise, no reliable history.
- Goal: a database-enforced, batch-level inventory with FEFO and alerts.

## 2. Database design (4 min)
- [ ] Show `docs/er-diagram.mmd` (render in any Mermaid viewer / GitHub) and `docs/relational-schema.md`.
- [ ] Explain: 11 tables, 3NF, purchase_item → batch → medicine, ledger with positive quantities + type.
- [ ] Open **Admin → Database inspector**: tables with row counts, 23 CHECK constraints, 12 foreign keys, 42 indexes incl. FULLTEXT, 5 triggers, 7 views, 2 procedures + 3 functions, 1 event, MongoDB collections with `$jsonSchema` validators.
- [ ] Justify SQL vs NoSQL (architecture.md §3): relational/transactional inventory in MySQL; flexible incident documents with embedded timeline and the audit log in MongoDB.

## 3. Authentication & roles (2 min)
- [ ] Sign in as staff → no Administration menu, no "Add medicine".
- [ ] Type `/admin/users` → **Access denied** page.
- [ ] Wrong password 5 times on a throwaway account → lockout message (optional).
- [ ] Mention: bcrypt hashes, server-side sessions (only SHA-256 stored), checks in every service.

## 4. Core workflow (6 min)
1. **Receive stock** (staff or admin): two items, one existing medicine with a new batch → purchase page shows each line's ledger row and balance.
   - [ ] Submit an expiry date earlier than manufacture → field error (Zod) — and in MySQL the CHECK would also reject it.
2. **Issue stock (FEFO)**: choose *Metformin 500 mg* (or *Paracetamol*), enter a quantity larger than the earliest batch → **Preview batches** shows the split → **Issue** → operation page lists both batches.
   - [ ] Request more than available → "Only N … are available" and nothing changes.
3. **Expiry alerts**: expired batches (Ibuprofen IBU-24B3, Amoxicillin AMX-24F1) and expiring soon; change the window to 90 days. Explain `CALL sp_expiring_batches(n)`.
   - [ ] Show that expired batches are not offered by FEFO (Ibuprofen preview only uses IBU-25R6).
4. **Waste**: write off an expired batch (staff) or **Bulk write-off** (admin, stored procedure) → alert count drops.
5. **Low stock**: usable stock vs reorder level; Amoxicillin counts only unexpired units; Clotrimazole out of stock.
6. **Stock ledger**: filter by medicine; every row has user, reference and balance after.

## 5. Advanced database features in MySQL (4 min) — database-concepts.md
- [ ] Triggers: `UPDATE medicine_batches SET quantity = 999 WHERE id = 1;` → rejected. `DELETE FROM stock_transactions WHERE id = 1;` → rejected.
- [ ] Transaction: run sql-demo.sql Part 4.1 (quantity drops inside the transaction, restored after ROLLBACK).
- [ ] Views: `SELECT * FROM v_low_stock_medicines;` and `SELECT * FROM v_stock_reconciliation WHERE difference <> 0;` (empty).
- [ ] Procedure: `CALL sp_expiring_batches(30);`
- [ ] Indexes: `EXPLAIN` from sql-demo.sql §3.5 (`idx_batches_fefo`, `ft_medicines_search`).
- [ ] Full-text: search "amox" / "novacure" on Medicines.
- [ ] DDL/DML sandbox: sql-demo.sql Part 5 (CREATE/ALTER/INSERT/UPDATE/DELETE/DROP in `meditrack_sql_demo`).

## 6. MongoDB (2 min)
- [ ] Staff: **Report incident** → *Stock discrepancy* (expected/counted fields appear) → submit.
- [ ] Admin: open it → change status with a note → timeline grows (embedded array).
- [ ] Incident reports page: charts from the `$facet` aggregation; search a word (text index).
- [ ] Activity log: events by action (`$group`), explain the transactional outbox (outbox.test.ts).

## 7. Reports, tests, contributions (2 min)
- [ ] Reports page: GROUP BY / HAVING / NOT EXISTS / derived-table queries, reconciliation = 0 mismatches.
- [ ] `npm test` → 96 passed (or show docs/test-report.md).
- [ ] Individual contributions: docs/team-contributions.md and the Git history.
