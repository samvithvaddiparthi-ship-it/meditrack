# Requirements Checklist — DBMS Level 3 Project rubric

Audit of the implemented repository against *DBMS Experiential Learning –
Level 3 Project Requirements*. Status: **PASS** (implemented and verified),
**ACTION** (needs a step only the team can take), **N/A** (optional, not chosen).

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Unique project title; meaningful real-world problem; not simple CRUD | PASS / ACTION | "MediTrack: Medicine Inventory & Expiry Management System"; problem in docs/problem-statement.md; FEFO, triggers, transactions, alerts, outbox go well beyond CRUD. **ACTION:** confirm the title is unique within your section. |
| 2 | Two-member team; defined responsibilities in both DB and app work | PASS / ACTION | docs/team-contributions.md (proposed split). **ACTION:** agree the split and present it. |
| 3 | Practical database design; SQL (mandatory) + NoSQL; ≥ 2 paradigms | PASS | MySQL 8.4 (relational) + MongoDB 8 (document); docker-compose.yml; src/lib/db.ts, src/lib/mongo.ts |
| 4a | ER diagram converted to relational schema | PASS | docs/er-diagram.mmd, docs/relational-schema.md |
| 4b | Entities, attributes, PKs, FKs, relationships, constraints identified | PASS | relational-schema.md (keys, cardinalities, 23 CHECKs), data-dictionary.md |
| 4c | NoSQL data model, collections/documents, indexes, metadata, retrieval strategy | PASS | relational-schema.md § MongoDB data model; data-dictionary.md § MongoDB; `ensureMongoSchema()` |
| 5 | DDL: CREATE, ALTER, DROP, PK/FK, constraints, indexes, views | PASS | prisma/migrations (CREATE TABLE/INDEX/VIEW/TRIGGER/FUNCTION/PROCEDURE/EVENT, ALTER … ADD CONSTRAINT, DROP INDEX); docs/sql-demo.sql Part 5 |
| 6 | DML: INSERT, UPDATE, DELETE, SELECT; JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | PASS | Services (e.g. inventory.service.ts reports), views, sql-demo.sql Parts 1–2, 5; Reports page shows the queries |
| 7 | ≥ 4 advanced concepts | PASS (8) | Transactions, triggers, views, stored procedures/functions, indexing, full-text search, MongoDB aggregation, scheduled event — docs/database-concepts.md, Database inspector page |
| 8 | Vector database / semantic search (optional) | N/A | Not required for the chosen problem (structured inventory data); listed as a future enhancement in README |
| 9 | Functional Next.js web interface with forms, tables, search, filters, dashboards | PASS | 17 required pages + detail pages (src/app); screenshots 01–26 |
| 10 | Next.js ↔ DB through a backend/API layer; no hard-coded credentials; env variables | PASS | Server actions + `/api/*` route handlers → service layer; `env()` in src/lib/env.ts; .env.example; .env git-ignored |
| 11 | Authentication; ≥ 2 roles where relevant | PASS | Login/logout, sessions, lockout (auth.service.ts); ADMIN and STAFF (permissions.ts); tests auth/authorization |
| 12 | Input validation at database level; data consistency and integrity demonstrated | PASS | CHECK constraints, ENUM, NOT NULL, UNIQUE, FKs, triggers, MongoDB `$jsonSchema`; v_stock_reconciliation; db-constraints.test.ts |
| 13 | Basic DB & web security; passwords/credentials not in plain text | PASS | bcrypt hashes, hashed session tokens, HttpOnly/SameSite/Secure cookies, parameterised queries, Origin checks, security headers, sanitised logs (architecture.md §5) |
| 14 | Documentation: problem statement, objectives, scope, functional requirements, ER diagram, relational schema, DB choice and justification, data dictionary, SQL/NoSQL implementation, important queries, system architecture, screenshots, testing results, conclusion & future enhancements | PASS | problem-statement.md; er-diagram.mmd; relational-schema.md; architecture.md §3; data-dictionary.md; database-concepts.md; sql-demo.sql; system-architecture.mmd; screenshots/ + screenshots-checklist.md; test-report.md; README "Conclusion and future enhancements" |
| 15 | Git/GitHub; commits showing individual contributions; README with setup and execution | PASS / ACTION | README.md (install, env, DB setup, seed, run, test). A Git repository is initialised with no commits. **ACTION:** each member commits their own work and pushes to GitHub. |
| 16 | Demonstration: problem, ER/design, schema, implementation, queries, interface, integration, advanced features, test cases, individual contribution | PASS | docs/demo-checklist.md (step-by-step script) |
| 17 | Originality | PASS | Original design and code written for this project (FEFO + ledger trigger design, transactional outbox, inspector) |
| 18 | Beyond CRUD; clear link between DB concepts, design, implementation and web app; justified DB choice | PASS | Every advanced object is used by the app (e.g. trigger maintains quantities shown everywhere, procedure powers Expiry alerts, views power lists and alerts); justification in architecture.md §3 |

## Project-specific requirements (from the build brief)

| Requirement | Status | Evidence |
|---|---|---|
| Medicines CRUD with search/filter/sort/pagination, deactivate instead of delete | PASS | /medicines, catalog.service.ts, catalog.test.ts |
| Batch-level inventory; unique batch per medicine; non-negative quantity; expiry > manufacture; status derived from dates | PASS | medicine_batches constraints, fn_batch_status, /batches |
| Suppliers and multi-item purchase receipts in one transaction; duplicate protection | PASS | purchases.service.ts, purchases.test.ts |
| Ledger with stock-in/out/waste/adjustments; no zero/negative quantities; no negative stock; no issue from expired; FEFO; atomic multi-batch; batches used recorded; concurrency-safe | PASS | trigger, stock.service.ts, stock.test.ts |
| Single quantity-update mechanism (trigger only) | PASS | trg_stock_transactions_before_insert + trg_batches_before_update |
| Expiry alerts (configurable window, default 30), low-stock, depleted, waste sections | PASS | /alerts/expiry, /alerts/low-stock |
| MongoDB incident reports (create, list, search, filter, details, status updates) + activity log + aggregation | PASS | incidents.service.ts, audit.service.ts, /incidents, /admin/activity |
| MySQL/MongoDB failure strategy documented and honest | PASS | architecture.md §4, outbox.test.ts |
| Dashboard metrics from real queries | PASS | dashboardMetrics(), alerts.test.ts › dashboard metrics |
| Safe demo-account creation without published passwords | PASS | seed reads DEMO_* env vars or prints random passwords once; `npm run user:create` hidden prompt |
| Seed: multiple medicines/batches, expired, near-expiry, low-stock, suppliers, purchases, transactions, incidents — internally consistent | PASS | prisma/seed.ts (self-verifying against the ledger) |
| Tests, typecheck, lint, build executed | PASS | docs/test-report.md |
| All required documentation files | PASS | docs/ (this folder) |
