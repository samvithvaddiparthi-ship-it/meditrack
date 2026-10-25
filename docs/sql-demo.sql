-- =====================================================================
-- MediTrack — SQL demonstration script (MySQL 8)
--
-- Run (Docker setup):
--   docker exec -i meditrack-mysql mysql -umeditrack -p meditrack < docs/sql-demo.sql
-- or open it in MySQL Workbench / the mysql client connected to `meditrack`.
--
-- SAFETY
--   * Parts 1-4 only READ the application database `meditrack`, or write
--     inside transactions that are always ROLLED BACK. Application data is
--     never changed.
--   * Part 5 (CREATE / ALTER / INSERT / UPDATE / DELETE / DROP) runs in a
--     separate sandbox schema `meditrack_sql_demo` that is created and
--     dropped by this script. It never touches `meditrack`.
--
-- The real DDL of the application lives in prisma/migrations/*/migration.sql.
-- =====================================================================

USE meditrack;

-- ---------------------------------------------------------------------
-- PART 1. SELECT, JOIN, ORDER BY, aggregates, GROUP BY, HAVING
-- ---------------------------------------------------------------------

-- 1.1 Inner join across four tables: every batch with its medicine and category.
SELECT m.name AS medicine, m.strength, c.name AS category,
       b.batch_number, b.expiry_date, b.quantity
  FROM medicine_batches b
  JOIN medicines  m ON m.id = b.medicine_id
  JOIN categories c ON c.id = m.category_id
 ORDER BY b.expiry_date ASC, m.name
 LIMIT 15;

-- 1.2 LEFT JOIN + aggregates: medicines with total stock (medicines without
--     batches still appear with 0).
SELECT m.id, m.name, m.strength,
       COUNT(b.id)                AS batches,
       COALESCE(SUM(b.quantity),0) AS units_on_hand,
       MIN(b.expiry_date)         AS earliest_expiry
  FROM medicines m
  LEFT JOIN medicine_batches b ON b.medicine_id = m.id
 GROUP BY m.id, m.name, m.strength
 ORDER BY units_on_hand DESC;

-- 1.3 GROUP BY + HAVING: categories holding more than 100 units.
SELECT c.name AS category, SUM(b.quantity) AS units, COUNT(DISTINCT m.id) AS medicines
  FROM categories c
  JOIN medicines m        ON m.category_id = c.id
  JOIN medicine_batches b ON b.medicine_id = m.id
 GROUP BY c.name
HAVING SUM(b.quantity) > 100
 ORDER BY units DESC;

-- 1.4 Aggregates over the ledger: units moved per movement type.
SELECT type, COUNT(*) AS movements, SUM(quantity) AS units, AVG(quantity) AS avg_units,
       MIN(created_at) AS first_at, MAX(created_at) AS last_at
  FROM stock_transactions
 GROUP BY type
 ORDER BY units DESC;

-- 1.5 Purchase value per supplier (derived — totals are never stored).
SELECT s.name AS supplier, COUNT(DISTINCT p.id) AS purchases,
       SUM(pi.quantity) AS units, SUM(pi.quantity * pi.unit_cost) AS amount
  FROM suppliers s
  JOIN purchases p       ON p.supplier_id = s.id
  JOIN purchase_items pi ON pi.purchase_id = p.id
 GROUP BY s.name
 ORDER BY amount DESC;

-- 1.6 Who did what: movements per user and type (multi-column GROUP BY).
SELECT u.name, u.role, t.type, COUNT(*) AS movements, SUM(t.quantity) AS units
  FROM stock_transactions t
  JOIN users u ON u.id = t.performed_by_id
 GROUP BY u.name, u.role, t.type
 ORDER BY u.name, t.type;

-- ---------------------------------------------------------------------
-- PART 2. Subqueries
-- ---------------------------------------------------------------------

-- 2.1 Scalar subquery: batches holding more stock than the average batch.
SELECT batch_number, quantity
  FROM medicine_batches
 WHERE quantity > (SELECT AVG(quantity) FROM medicine_batches)
 ORDER BY quantity DESC;

-- 2.2 IN subquery: medicines supplied by "Coldchain Biologics Pvt Ltd".
SELECT name, strength
  FROM medicines
 WHERE id IN (SELECT b.medicine_id
                FROM medicine_batches b
                JOIN purchase_items pi ON pi.batch_id = b.id
                JOIN purchases p       ON p.id = pi.purchase_id
                JOIN suppliers s       ON s.id = p.supplier_id
               WHERE s.name = 'Coldchain Biologics Pvt Ltd');

-- 2.3 NOT EXISTS: active medicines that were never issued.
SELECT m.name, m.strength
  FROM medicines m
 WHERE m.is_active = TRUE
   AND NOT EXISTS (SELECT 1
                     FROM stock_transactions t
                     JOIN medicine_batches b ON b.id = t.batch_id
                    WHERE b.medicine_id = m.id AND t.type = 'STOCK_OUT');

-- 2.4 Correlated subquery: the most recent supplier of every batch.
SELECT b.batch_number,
       (SELECT s.name
          FROM purchase_items pi
          JOIN purchases p ON p.id = pi.purchase_id
          JOIN suppliers s ON s.id = p.supplier_id
         WHERE pi.batch_id = b.id
         ORDER BY p.purchase_date DESC
         LIMIT 1) AS latest_supplier
  FROM medicine_batches b
 ORDER BY b.batch_number;

-- 2.5 Derived table: suppliers whose spend is above the average supplier spend.
SELECT t.supplier, t.amount
  FROM (SELECT s.name AS supplier, SUM(pi.quantity * pi.unit_cost) AS amount
          FROM suppliers s
          JOIN purchases p       ON p.supplier_id = s.id
          JOIN purchase_items pi ON pi.purchase_id = p.id
         GROUP BY s.name) t
 WHERE t.amount > (SELECT AVG(x.amount)
                     FROM (SELECT SUM(pi.quantity * pi.unit_cost) AS amount
                             FROM purchases p JOIN purchase_items pi ON pi.purchase_id = p.id
                            GROUP BY p.supplier_id) x)
 ORDER BY t.amount DESC;

-- ---------------------------------------------------------------------
-- PART 3. Views, stored functions, stored procedures, indexes
-- ---------------------------------------------------------------------

-- 3.1 Views (created in migration 20261025094000_native_db_objects).
SELECT * FROM v_inventory_summary ORDER BY medicine_name;
SELECT medicine_name, batch_number, quantity, days_to_expiry, status, supplier_name FROM v_batch_stock ORDER BY expiry_date;
SELECT medicine_name, batch_number, quantity, days_to_expiry FROM v_expiring_batches;
SELECT medicine_name, batch_number, quantity, days_to_expiry FROM v_expired_batches;
SELECT medicine_name, reorder_level, usable_quantity, shortfall FROM v_low_stock_medicines;
SELECT * FROM v_purchase_summary ORDER BY purchase_date DESC;

-- 3.2 Consistency proof: batch quantity always equals the ledger sum (expect 0 rows).
SELECT * FROM v_stock_reconciliation WHERE difference <> 0;

-- 3.3 Stored functions.
SELECT fn_business_today()                          AS business_today_ist,
       fn_business_date(UTC_TIMESTAMP(3))            AS same_via_fn_business_date,
       fn_batch_status(10, fn_business_today(), 30)  AS expires_today,
       fn_batch_status(10, fn_business_today() + INTERVAL 10 DAY, 30) AS in_ten_days,
       fn_batch_status(0,  fn_business_today() + INTERVAL 10 DAY, 30) AS empty_batch;

-- 3.4 Stored procedure: batches with stock expiring within N days (expired included).
CALL sp_expiring_batches(30);
CALL sp_expiring_batches(90);
-- Invalid input is rejected inside the procedure (uncomment to see the error):
-- CALL sp_expiring_batches(0);   -- ERROR 1644: p_days must be between 1 and 365

-- 3.5 Indexes and the queries they serve (look at the `key` column).
SHOW INDEX FROM medicine_batches;
EXPLAIN SELECT id, quantity FROM medicine_batches
         WHERE medicine_id = 7 AND quantity > 0 AND expiry_date > fn_business_today()
         ORDER BY expiry_date;                                   -- idx_batches_fefo
EXPLAIN SELECT * FROM medicine_batches WHERE expiry_date <= CURDATE() + INTERVAL 30 DAY;  -- idx_batches_expiry (range)
EXPLAIN SELECT * FROM medicine_batches WHERE medicine_id = 1 AND batch_number = 'PCM-24A1'; -- uq_batches_medicine_number
EXPLAIN SELECT * FROM stock_transactions WHERE batch_id = 1 ORDER BY created_at;          -- idx_transactions_batch_created
EXPLAIN SELECT * FROM medicines WHERE name LIKE 'Para%';                                  -- uq_medicines_identity (leftmost column)

-- 3.6 FULLTEXT index search (boolean mode, prefix matching).
SELECT id, name, generic_name, manufacturer,
       MATCH(name, generic_name, manufacturer) AGAINST ('+amox*' IN BOOLEAN MODE) AS relevance
  FROM medicines
 WHERE MATCH(name, generic_name, manufacturer) AGAINST ('+amox*' IN BOOLEAN MODE);
SELECT name, manufacturer FROM medicines
 WHERE MATCH(name, generic_name, manufacturer) AGAINST ('+novacure*' IN BOOLEAN MODE);

-- ---------------------------------------------------------------------
-- PART 4. Transactions and triggers (every change below is rolled back)
-- ---------------------------------------------------------------------

-- Pick an unexpired batch with stock, an expired batch with stock and a user.
SELECT id, batch_number, quantity INTO @ok_batch, @ok_number, @ok_qty_before
  FROM medicine_batches
 WHERE quantity >= 5 AND expiry_date > fn_business_today() + INTERVAL 30 DAY
 ORDER BY id LIMIT 1;
SELECT id, quantity INTO @expired_batch, @expired_qty_before
  FROM medicine_batches WHERE quantity > 0 AND expiry_date <= fn_business_today()
 ORDER BY id LIMIT 1;
SELECT id INTO @user FROM users WHERE role = 'ADMIN' AND is_active = TRUE ORDER BY id LIMIT 1;
SELECT @ok_batch, @ok_number, @ok_qty_before, @expired_batch, @expired_qty_before, @user;

-- 4.1 COMMIT path shown without committing: the trigger applies the issue.
START TRANSACTION;
  INSERT INTO stock_operations (type, idempotency_key, performed_by_id, destination, notes)
  VALUES ('ISSUE', UUID(), @user, 'SQL demo ward', 'sql-demo.sql — rolled back');
  SET @op = LAST_INSERT_ID();
  INSERT INTO stock_transactions (batch_id, type, quantity, performed_by_id, operation_id)
  VALUES (@ok_batch, 'STOCK_OUT', 3, @user, @op);
  -- The BEFORE INSERT trigger reduced the batch and stamped balance_after:
  SELECT quantity AS qty_inside_transaction FROM medicine_batches WHERE id = @ok_batch;
  SELECT id, type, quantity, balance_after FROM stock_transactions WHERE operation_id = @op;
ROLLBACK;
SELECT quantity AS qty_after_rollback, @ok_qty_before AS qty_before FROM medicine_batches WHERE id = @ok_batch;

-- 4.2 Trigger rules (each statement below fails; uncomment one at a time).
--   Issue from an expired batch:
-- INSERT INTO stock_operations (type, idempotency_key, performed_by_id, destination) VALUES ('ISSUE', UUID(), @user, 'Ward');
-- INSERT INTO stock_transactions (batch_id, type, quantity, performed_by_id, operation_id) VALUES (@expired_batch, 'STOCK_OUT', 1, @user, LAST_INSERT_ID());
--     -> ERROR 1644: Cannot issue from an expired batch; record it as waste instead
--   Over-issue (stock can never become negative):
-- INSERT INTO stock_transactions (batch_id, type, quantity, performed_by_id, operation_id) VALUES (@ok_batch, 'STOCK_OUT', 999999, @user, @op);
--     -> ERROR 1644: Insufficient stock in the batch for this movement
--   Zero quantity:            ... quantity = 0  -> Movement quantity must be a positive whole number
--   Direct quantity edit:
-- UPDATE medicine_batches SET quantity = 500 WHERE id = @ok_batch;
--     -> ERROR 1644: Batch quantity can only change through the stock_transactions ledger
--   Ledger tampering:
-- UPDATE stock_transactions SET quantity = 1 WHERE id = 1;   -> The stock ledger is append-only ...
-- DELETE FROM stock_transactions WHERE id = 1;              -> The stock ledger is append-only ...
--   CHECK constraint:
-- INSERT INTO medicine_batches (medicine_id, batch_number, manufacture_date, expiry_date, unit_cost, updated_at)
-- VALUES (1, 'BAD-1', '2026-01-01', '2025-01-01', 1, NOW(3));
--     -> ERROR 3819: Check constraint 'chk_batches_expiry_after_manufacture' is violated.
--   Foreign key (ON DELETE RESTRICT):
-- DELETE FROM medicines WHERE id = 1;   -> ERROR 1451: Cannot delete or update a parent row ...

-- 4.3 ROLLBACK of a multi-row operation when one row fails: the first
--     movement succeeds, the second violates the stock rule, and the
--     application (or this script) rolls the whole unit back.
START TRANSACTION;
  INSERT INTO stock_operations (type, idempotency_key, performed_by_id, destination)
  VALUES ('ISSUE', UUID(), @user, 'SQL demo ward');
  SET @op2 = LAST_INSERT_ID();
  INSERT INTO stock_transactions (batch_id, type, quantity, performed_by_id, operation_id)
  VALUES (@ok_batch, 'STOCK_OUT', 1, @user, @op2);
  SELECT quantity AS after_first_row FROM medicine_batches WHERE id = @ok_batch;
  -- A second INSERT exceeding the stock would raise ERROR 1644 here; the
  -- application catches it and issues ROLLBACK, exactly like this:
ROLLBACK;
SELECT quantity AS restored_quantity, @ok_qty_before AS original FROM medicine_batches WHERE id = @ok_batch;
SELECT COUNT(*) AS demo_operations_left FROM stock_operations WHERE destination = 'SQL demo ward';  -- 0

-- 4.4 Isolation level used by the application (InnoDB default).
SELECT @@transaction_isolation;

-- ---------------------------------------------------------------------
-- PART 5. DDL + DML in an ISOLATED SANDBOX (never touches `meditrack`)
-- ---------------------------------------------------------------------

DROP DATABASE IF EXISTS meditrack_sql_demo;
CREATE DATABASE meditrack_sql_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE meditrack_sql_demo;

-- CREATE with primary key, unique, foreign key and CHECK constraints.
CREATE TABLE demo_supplier (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE,
  phone       VARCHAR(20)  NOT NULL
);

CREATE TABLE demo_medicine (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  reorder_level INT NOT NULL DEFAULT 0,
  supplier_id   INT NULL,
  CONSTRAINT chk_demo_reorder CHECK (reorder_level >= 0),
  CONSTRAINT fk_demo_medicine_supplier FOREIGN KEY (supplier_id)
    REFERENCES demo_supplier (id) ON DELETE SET NULL
);

-- ALTER: add a column, a constraint and an index.
ALTER TABLE demo_medicine ADD COLUMN strength VARCHAR(40) NOT NULL DEFAULT '-' AFTER name;
ALTER TABLE demo_medicine ADD CONSTRAINT uq_demo_medicine UNIQUE (name, strength);
CREATE INDEX idx_demo_medicine_reorder ON demo_medicine (reorder_level);
SHOW CREATE TABLE demo_medicine;

-- INSERT
INSERT INTO demo_supplier (name, phone) VALUES ('Demo Distributors', '+91 80 0000 0000'), ('Other Pharma', '+91 80 1111 1111');
INSERT INTO demo_medicine (name, strength, reorder_level, supplier_id) VALUES
  ('Paracetamol', '500 mg', 50, 1),
  ('Ibuprofen',   '400 mg', 30, 1),
  ('Cetirizine',  '10 mg',  20, 2);

-- UPDATE
UPDATE demo_medicine SET reorder_level = reorder_level + 10 WHERE supplier_id = 1;
SELECT * FROM demo_medicine;

-- Constraint violations (uncomment to see the errors):
-- INSERT INTO demo_medicine (name, strength, reorder_level) VALUES ('Paracetamol', '500 mg', 1);  -- duplicate (UNIQUE)
-- INSERT INTO demo_medicine (name, reorder_level) VALUES ('Bad', -1);                              -- CHECK
-- INSERT INTO demo_medicine (name, supplier_id) VALUES ('Orphan', 99);                             -- FOREIGN KEY

-- DELETE (ON DELETE SET NULL keeps the medicine but clears the reference)
DELETE FROM demo_supplier WHERE id = 2;
SELECT id, name, supplier_id FROM demo_medicine;
DELETE FROM demo_medicine WHERE reorder_level < 25;
SELECT COUNT(*) AS remaining_medicines FROM demo_medicine;

-- DROP: index, column, tables, schema.
DROP INDEX idx_demo_medicine_reorder ON demo_medicine;
ALTER TABLE demo_medicine DROP COLUMN strength;
DROP TABLE demo_medicine;
DROP TABLE demo_supplier;
DROP DATABASE meditrack_sql_demo;

USE meditrack;
SELECT 'sql-demo.sql finished; the meditrack database is unchanged' AS result;
