# Screenshots Checklist

All screenshots below are **real captures** of the running production build
(`next start`) with the seeded demo data, taken by `npm run screenshots`
(scripts/capture-screenshots.ts, headless Google Chrome, 1440×900 full page;
the mobile one at 390×844). They are stored in [docs/screenshots/](screenshots/).
Re-capture at any time with the app running:

```bash
APP_URL=http://localhost:3000 npm run screenshots
```

| # | File | Shows | Rubric item |
|---|---|---|---|
| 1 | `01-login.png` | Login page | Authentication |
| 2 | `02-dashboard.png` | Admin dashboard: KPIs, 14-day movement chart, recent movements / purchases / incidents | Dashboard, live data |
| 3 | `03-medicines.png` | Medicine list with filters, sorting, pagination, stock badges | Tables, search, filtering |
| 4 | `04-medicine-search-fulltext.png` | Search "amox" via FULLTEXT index | Full-text search |
| 5 | `05-medicine-details.png` | Medicine details: stock summary, batches with status, movement history, incidents | Details page |
| 6 | `06-medicine-form.png` | Add medicine form | Forms, validation |
| 7 | `07-batch-inventory.png` | Batch inventory with live statuses | Batch-level inventory |
| 8 | `08-receive-stock.png` | Multi-item stock receipt form | Purchases / receipts |
| 9 | `09-purchase-history.png` | Purchase history (v_purchase_summary) | Purchases |
| 10 | `10-purchase-details.png` | Purchase lines, batches and their STOCK_IN ledger rows | Exactly-once receipts |
| 11 | `11-issue-stock-fefo-preview.png` | FEFO allocation preview across batches | FEFO |
| 12 | `12-stock-operation-multi-batch.png` | Committed issue that used two batches | Atomic multi-batch issue |
| 13 | `13-waste-and-adjustments.png` | Waste, adjustment and bulk write-off (stored procedure) | Waste / adjustments |
| 14 | `14-stock-ledger.png` | Append-only stock ledger with filters | Stock history |
| 15 | `15-suppliers.png` | Supplier management | Suppliers |
| 16 | `16-expiry-alerts.png` | Expired and expiring-soon batches (sp_expiring_batches) | Expiry alerts |
| 17 | `17-low-stock-alerts.png` | Low stock, depleted batches, waste summary | Low-stock alerts |
| 18 | `18-incident-reports.png` | Incident list + MongoDB aggregation charts | MongoDB, NoSQL aggregation |
| 19 | `19-incident-details.png` | Incident document: metadata, embedded timeline, review form | MongoDB documents |
| 20 | `20-reports.png` | SQL reports (GROUP BY, HAVING, subqueries) + MongoDB stats | Important queries |
| 21 | `21-users-and-roles.png` | User management | Roles |
| 22 | `22-activity-log.png` | Activity / audit log (MongoDB) | Audit |
| 23 | `23-database-inspector.png` | Live tables, CHECKs, FKs, indexes, triggers, views, routines, collections | Database implementation |
| 24 | `24-staff-dashboard.png` | Staff view (no admin menu, no financial values) | RBAC |
| 25 | `25-staff-access-denied.png` | Staff blocked from an admin page | Server-side authorisation |
| 26 | `26-mobile-dashboard.png` | Responsive phone layout | Responsive UI |

Optional extra screenshots to take manually for the report:
- [ ] MySQL client running `CALL sp_expiring_batches(30);`
- [ ] A trigger rejection (`UPDATE medicine_batches SET quantity = 999 WHERE id = 1;`)
- [ ] `npm test` output showing 96 passed
- [ ] MongoDB Compass (or `mongosh`) showing an `incident_reports` document
