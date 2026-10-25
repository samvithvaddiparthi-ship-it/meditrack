# Team Contributions

| Member | SRN |
|---|---|
| Samvith Vaddiparthi | PES1UG24AM468 |
| Sanjit C | PES1UG24AM448 |

The rubric requires each member to contribute to **both** database and
application development, with individual commits in the Git history. The
work is divided as follows (each member commits their own files).

| Area | Samvith Vaddiparthi | Sanjit C |
|---|---|---|
| Database design | ER diagram, relational schema, normalisation (`docs/er-diagram.mmd`, `docs/relational-schema.md`) | Data dictionary, MongoDB document model, collections, `$jsonSchema` validators and indexes (`docs/data-dictionary.md`, `src/lib/mongo.ts`) |
| SQL implementation | Tables, keys, CHECK constraints, indexes, full-text index (`prisma/schema.prisma`, init migration) | Analytical SQL: inventory reports with GROUP BY / HAVING / subqueries, alert and dashboard queries (`inventory.service.ts`) |
| Advanced DB features | Triggers, views, stored procedures and functions, scheduled event (`native_db_objects` migration); transactions, row locking and FEFO (`tx.ts`, `fefo.ts`, `stock.service.ts`, `purchases.service.ts`); transactional outbox (`audit.service.ts`) | MongoDB aggregation pipelines, text search, optimistic concurrency (`incidents.service.ts`); database inspector (`inspector.service.ts`) |
| Backend | Database client, date strategy, error mapping (`db.ts`, `dates.ts`, `errors.ts`); purchase, issue, waste and adjustment services | Authentication, sessions, RBAC, validation (`src/server/auth`, `permissions.ts`, `src/lib/validation`); users, catalogue, alerts, incidents services; REST API (`src/app/api`, `api.ts`) |
| Frontend | Inventory pages: medicines, categories, batches, receipts, purchase history, issue, waste, ledger, operations | Layout, components and charts, login, dashboard, alerts, suppliers, incidents, reports and admin pages |
| Testing | Seed data; integration tests for purchases, stock, database constraints and outbox | Unit tests; integration tests for auth, authorisation, alerts, catalogue and incidents; E2E screenshot script |
| Documentation | README, architecture, database concepts, SQL demo script | Problem statement, data dictionary, test report, demo / screenshot / requirements checklists, screenshots |

## Suggested Git workflow

```bash
git init && git branch -M main
git config user.name "Your Name" && git config user.email "you@example.com"   # each member, on their own machine
git add <your files> && git commit -m "Add stock ledger triggers and procedures"
git remote add origin https://github.com/<team>/meditrack.git
git push -u origin main
```

Never commit `.env` (already in `.gitignore`); only `.env.example` is tracked.
