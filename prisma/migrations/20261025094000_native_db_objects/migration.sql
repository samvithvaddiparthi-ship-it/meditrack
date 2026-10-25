-- =====================================================================
-- MediTrack — native MySQL objects that Prisma's schema language cannot
-- express. Applied by `prisma migrate deploy` right after the base tables.
--
--   1. CHECK constraints            (database-level input validation)
--   2. Stored functions             (business date, batch status)
--   3. Triggers                     (stock ledger -> batch quantity, integrity)
--   4. Views                        (inventory summary, expiry, low stock ...)
--   5. Stored procedures            (expiry report, bulk expired write-off)
--   6. Scheduled event              (purge expired login sessions)
--
-- No DELIMITER statements are needed: the migration runner sends each
-- compound statement (BEGIN ... END) to the server as a whole.
-- SIGNAL messages are kept under MySQL's 128-character limit.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. CHECK CONSTRAINTS
-- ---------------------------------------------------------------------

ALTER TABLE `users`
  ADD CONSTRAINT `chk_users_email_format`
    CHECK (`email` REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
  ADD CONSTRAINT `chk_users_name_not_blank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  ADD CONSTRAINT `chk_users_failed_logins` CHECK (`failed_login_count` >= 0);

ALTER TABLE `categories`
  ADD CONSTRAINT `chk_categories_name_not_blank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0);

ALTER TABLE `medicines`
  ADD CONSTRAINT `chk_medicines_name_not_blank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  ADD CONSTRAINT `chk_medicines_strength_not_blank` CHECK (CHAR_LENGTH(TRIM(`strength`)) > 0),
  ADD CONSTRAINT `chk_medicines_reorder_level` CHECK (`reorder_level` BETWEEN 0 AND 1000000);

ALTER TABLE `suppliers`
  ADD CONSTRAINT `chk_suppliers_name_not_blank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  ADD CONSTRAINT `chk_suppliers_phone_format` CHECK (`phone` REGEXP '^[0-9+() -]{7,20}$'),
  ADD CONSTRAINT `chk_suppliers_email_format`
    CHECK (`email` IS NULL OR `email` REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$');

ALTER TABLE `medicine_batches`
  ADD CONSTRAINT `chk_batches_number_not_blank` CHECK (CHAR_LENGTH(TRIM(`batch_number`)) > 0),
  ADD CONSTRAINT `chk_batches_quantity_non_negative` CHECK (`quantity` >= 0),
  ADD CONSTRAINT `chk_batches_unit_cost` CHECK (`unit_cost` >= 0),
  ADD CONSTRAINT `chk_batches_expiry_after_manufacture` CHECK (`expiry_date` > `manufacture_date`);

ALTER TABLE `purchases`
  ADD CONSTRAINT `chk_purchases_invoice_not_blank` CHECK (CHAR_LENGTH(TRIM(`invoice_number`)) > 0);

ALTER TABLE `purchase_items`
  ADD CONSTRAINT `chk_purchase_items_quantity` CHECK (`quantity` > 0),
  ADD CONSTRAINT `chk_purchase_items_unit_cost` CHECK (`unit_cost` >= 0);

ALTER TABLE `stock_operations`
  ADD CONSTRAINT `chk_operations_reason` CHECK (
        (`type` = 'ISSUE' AND `reason` IS NULL)
     OR (`type` = 'WASTE' AND `reason` IN ('EXPIRED', 'DAMAGED', 'RECALLED', 'CONTAMINATED', 'OTHER'))
     OR (`type` = 'ADJUSTMENT' AND `reason` IN ('COUNT_CORRECTION', 'DAMAGED', 'OTHER'))),
  ADD CONSTRAINT `chk_operations_destination` CHECK (`type` <> 'ISSUE' OR `destination` IS NOT NULL);

ALTER TABLE `stock_transactions`
  ADD CONSTRAINT `chk_transactions_quantity_positive` CHECK (`quantity` > 0),
  ADD CONSTRAINT `chk_transactions_balance_non_negative` CHECK (`balance_after` >= 0),
  -- A stock-in always comes from a purchase line; every other movement
  -- belongs to a stock operation (issue / waste / adjustment).
  ADD CONSTRAINT `chk_transactions_source` CHECK (
        (`type` = 'STOCK_IN' AND `purchase_item_id` IS NOT NULL AND `operation_id` IS NULL)
     OR (`type` <> 'STOCK_IN' AND `operation_id` IS NOT NULL AND `purchase_item_id` IS NULL));

ALTER TABLE `audit_outbox`
  ADD CONSTRAINT `chk_outbox_attempts` CHECK (`attempts` >= 0);


-- ---------------------------------------------------------------------
-- 2. STORED FUNCTIONS
-- ---------------------------------------------------------------------
-- DATETIME columns are stored in UTC. Calendar decisions (is a batch
-- expired *today*?) use the business time zone, India Standard Time
-- (UTC+05:30, no daylight saving). src/lib/dates.ts uses the same offset.

CREATE FUNCTION `fn_business_today`() RETURNS DATE
  NOT DETERMINISTIC NO SQL
  COMMENT 'Current calendar date in the business time zone (IST, UTC+05:30)'
  RETURN DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'));

CREATE FUNCTION `fn_business_date`(p_utc DATETIME(3)) RETURNS DATE
  DETERMINISTIC NO SQL
  COMMENT 'Calendar date (IST) of a UTC timestamp'
  RETURN DATE(CONVERT_TZ(p_utc, '+00:00', '+05:30'));

CREATE FUNCTION `fn_batch_status`(p_quantity INT, p_expiry DATE, p_window_days INT) RETURNS VARCHAR(16)
  NOT DETERMINISTIC NO SQL
  COMMENT 'DEPLETED | EXPIRED | EXPIRING_SOON | AVAILABLE, derived from live dates'
  RETURN CASE
    WHEN p_quantity = 0 THEN 'DEPLETED'
    WHEN p_expiry <= fn_business_today() THEN 'EXPIRED'
    WHEN p_expiry <= fn_business_today() + INTERVAL p_window_days DAY THEN 'EXPIRING_SOON'
    ELSE 'AVAILABLE'
  END;


-- ---------------------------------------------------------------------
-- 3. TRIGGERS
-- ---------------------------------------------------------------------
-- Single quantity-update mechanism: application code NEVER writes
-- medicine_batches.quantity. It inserts a stock_transactions row and the
-- BEFORE INSERT trigger validates the movement, locks the batch row,
-- applies the change and stamps balance_after — all inside the caller's
-- transaction, so a failed statement or ROLLBACK undoes both together.

-- 3a. New batches start empty; stock arrives only through the ledger.
CREATE TRIGGER `trg_batches_before_insert`
BEFORE INSERT ON `medicine_batches`
FOR EACH ROW
BEGIN
  IF NEW.quantity <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A new batch must start at quantity 0; stock is added through stock_transactions';
  END IF;
  IF NEW.manufacture_date > fn_business_today() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Manufacturing date cannot be in the future';
  END IF;
END;

-- 3b. Batch quantity may change only when the ledger trigger authorises it
--     (it sets @meditrack_ledger_batch to the batch id immediately before
--     its UPDATE; the flag is consumed here). Received batch identity and
--     dates are immutable; corrections go through adjustments.
CREATE TRIGGER `trg_batches_before_update`
BEFORE UPDATE ON `medicine_batches`
FOR EACH ROW
BEGIN
  IF NEW.quantity <> OLD.quantity THEN
    IF @meditrack_ledger_batch IS NULL OR @meditrack_ledger_batch <> OLD.id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Batch quantity can only change through the stock_transactions ledger';
    END IF;
    SET @meditrack_ledger_batch = NULL;
  END IF;
  IF NEW.medicine_id <> OLD.medicine_id
     OR BINARY NEW.batch_number <> BINARY OLD.batch_number
     OR NEW.manufacture_date <> OLD.manufacture_date
     OR NEW.expiry_date <> OLD.expiry_date THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Batch medicine, number and dates cannot be changed after receipt';
  END IF;
END;

-- 3c. The ledger trigger: validation + quantity maintenance.
CREATE TRIGGER `trg_stock_transactions_before_insert`
BEFORE INSERT ON `stock_transactions`
FOR EACH ROW
BEGIN
  DECLARE v_quantity INT DEFAULT NULL;
  DECLARE v_expiry DATE DEFAULT NULL;
  DECLARE v_delta INT;
  DECLARE v_op_type VARCHAR(16) DEFAULT NULL;
  DECLARE v_movement_date DATE;

  -- Rule 1: zero / negative movement quantities are rejected.
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movement quantity must be a positive whole number';
  END IF;

  IF NEW.created_at > UTC_TIMESTAMP(3) + INTERVAL 1 MINUTE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A stock movement cannot be dated in the future';
  END IF;

  -- The movement type must agree with its operation header.
  IF NEW.operation_id IS NOT NULL THEN
    SELECT `type` INTO v_op_type FROM stock_operations WHERE id = NEW.operation_id;
    IF (NEW.type = 'STOCK_OUT' AND v_op_type <> 'ISSUE')
       OR (NEW.type = 'WASTE' AND v_op_type <> 'WASTE')
       OR (NEW.type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') AND v_op_type <> 'ADJUSTMENT') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movement type does not match its stock operation type';
    END IF;
  END IF;

  -- A stock-in must mirror its purchase line exactly (same batch, same
  -- quantity). Together with UNIQUE(purchase_item_id) this guarantees a
  -- receipt increases stock exactly once.
  IF NEW.type = 'STOCK_IN' AND NOT EXISTS (
       SELECT 1 FROM purchase_items pi
        WHERE pi.id = NEW.purchase_item_id
          AND pi.batch_id = NEW.batch_id
          AND pi.quantity = NEW.quantity) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stock-in must match the batch and quantity of its purchase item';
  END IF;

  -- Lock the batch row until the surrounding transaction ends, so
  -- concurrent movements on the same batch are serialised.
  SELECT quantity, expiry_date INTO v_quantity, v_expiry
    FROM medicine_batches WHERE id = NEW.batch_id FOR UPDATE;
  IF v_quantity IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Batch does not exist';
  END IF;

  SET v_movement_date = fn_business_date(NEW.created_at);
  SET v_delta = IF(NEW.type IN ('STOCK_IN', 'ADJUSTMENT_IN'), NEW.quantity, -NEW.quantity);

  IF NEW.type IN ('STOCK_IN', 'ADJUSTMENT_IN') AND v_expiry <= v_movement_date THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot add stock to a batch that has already expired';
  END IF;

  -- Rule 3: ordinary issues never come from expired batches (expired
  -- stock leaves inventory only as WASTE).
  IF NEW.type = 'STOCK_OUT' AND (v_expiry <= fn_business_today() OR v_expiry <= v_movement_date) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot issue from an expired batch; record it as waste instead';
  END IF;

  -- Rule 2: stock can never become negative.
  IF v_quantity + v_delta < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient stock in the batch for this movement';
  END IF;

  SET @meditrack_ledger_batch = NEW.batch_id;
  UPDATE medicine_batches
     SET quantity = quantity + v_delta,
         updated_at = UTC_TIMESTAMP(3)
   WHERE id = NEW.batch_id;

  SET NEW.balance_after = v_quantity + v_delta;
END;

-- 3d. The ledger is append-only.
CREATE TRIGGER `trg_stock_transactions_before_update`
BEFORE UPDATE ON `stock_transactions`
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'The stock ledger is append-only; record a correcting adjustment instead';

CREATE TRIGGER `trg_stock_transactions_before_delete`
BEFORE DELETE ON `stock_transactions`
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'The stock ledger is append-only; ledger rows cannot be deleted';


-- ---------------------------------------------------------------------
-- 4. VIEWS
-- ---------------------------------------------------------------------

-- 4a. Every batch with live expiry status, value and most recent supplier
--     (correlated subquery). Status uses the default 30-day window; the
--     application recomputes it when a different window is configured.
CREATE VIEW `v_batch_stock` AS
SELECT
  b.id                                        AS batch_id,
  b.medicine_id,
  m.name                                      AS medicine_name,
  m.strength,
  m.dosage_form,
  m.unit,
  m.is_active                                 AS medicine_active,
  c.name                                      AS category_name,
  b.batch_number,
  b.manufacture_date,
  b.expiry_date,
  b.quantity,
  b.unit_cost,
  b.quantity * b.unit_cost                    AS stock_value,
  DATEDIFF(b.expiry_date, fn_business_today()) AS days_to_expiry,
  fn_batch_status(b.quantity, b.expiry_date, 30) AS status,
  (SELECT s.name
     FROM purchase_items pi
     JOIN purchases p ON p.id = pi.purchase_id
     JOIN suppliers s ON s.id = p.supplier_id
    WHERE pi.batch_id = b.id
    ORDER BY p.purchase_date DESC, pi.id DESC
    LIMIT 1)                                  AS supplier_name
FROM medicine_batches b
JOIN medicines  m ON m.id = b.medicine_id
JOIN categories c ON c.id = m.category_id;

-- 4b. Batches with stock that expire within the next 30 days.
CREATE VIEW `v_expiring_batches` AS
SELECT v.*
  FROM v_batch_stock v
 WHERE v.quantity > 0
   AND v.days_to_expiry BETWEEN 1 AND 30;

-- 4c. Batches that are already expired but still hold stock (need write-off).
CREATE VIEW `v_expired_batches` AS
SELECT v.*
  FROM v_batch_stock v
 WHERE v.quantity > 0
   AND v.days_to_expiry <= 0;

-- 4d. One row per medicine: batch count, total / usable / expired units and
--     value. "Usable" excludes expired batches because they cannot be issued.
CREATE VIEW `v_inventory_summary` AS
SELECT
  m.id                AS medicine_id,
  m.name              AS medicine_name,
  m.generic_name,
  m.strength,
  m.dosage_form,
  m.unit,
  m.manufacturer,
  m.category_id,
  c.name              AS category_name,
  m.reorder_level,
  m.is_active,
  COUNT(b.id)         AS batch_count,
  CAST(COALESCE(SUM(b.quantity), 0) AS SIGNED) AS total_quantity,
  CAST(COALESCE(SUM(CASE WHEN b.expiry_date >  fn_business_today() THEN b.quantity ELSE 0 END), 0) AS SIGNED)
                      AS usable_quantity,
  CAST(COALESCE(SUM(CASE WHEN b.expiry_date <= fn_business_today() THEN b.quantity ELSE 0 END), 0) AS SIGNED)
                      AS expired_quantity,
  MIN(CASE WHEN b.quantity > 0 AND b.expiry_date > fn_business_today() THEN b.expiry_date END)
                      AS next_expiry,
  COALESCE(SUM(CASE WHEN b.expiry_date > fn_business_today() THEN b.quantity * b.unit_cost ELSE 0 END), 0)
                      AS usable_value
FROM medicines m
JOIN categories c            ON c.id = m.category_id
LEFT JOIN medicine_batches b ON b.medicine_id = m.id
GROUP BY m.id, m.name, m.generic_name, m.strength, m.dosage_form, m.unit,
         m.manufacturer, m.category_id, c.name, m.reorder_level, m.is_active;

-- 4e. Active medicines whose usable stock is at or below the reorder level.
CREATE VIEW `v_low_stock_medicines` AS
SELECT s.*,
       s.reorder_level - s.usable_quantity AS shortfall
  FROM v_inventory_summary s
 WHERE s.is_active = TRUE
   AND s.usable_quantity <= s.reorder_level;

-- 4f. Purchase header totals (amount is derived, never stored).
CREATE VIEW `v_purchase_summary` AS
SELECT
  p.id               AS purchase_id,
  p.invoice_number,
  p.purchase_date,
  p.supplier_id,
  s.name             AS supplier_name,
  p.received_by_id,
  u.name             AS received_by_name,
  COUNT(pi.id)       AS item_count,
  CAST(COALESCE(SUM(pi.quantity), 0) AS SIGNED) AS total_units,
  COALESCE(SUM(pi.quantity * pi.unit_cost), 0)  AS total_amount,
  p.created_at
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
JOIN users     u ON u.id = p.received_by_id
LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
GROUP BY p.id, p.invoice_number, p.purchase_date, p.supplier_id, s.name,
         p.received_by_id, u.name, p.created_at;

-- 4g. Consistency check: recorded batch quantity vs. the sum of the ledger.
--     `difference` must always be 0.
CREATE VIEW `v_stock_reconciliation` AS
SELECT
  b.id            AS batch_id,
  b.medicine_id,
  b.batch_number,
  b.quantity      AS recorded_quantity,
  CAST(COALESCE(SUM(CASE WHEN t.type IN ('STOCK_IN', 'ADJUSTMENT_IN') THEN t.quantity
                         ELSE -t.quantity END), 0) AS SIGNED) AS ledger_quantity,
  CAST(b.quantity - COALESCE(SUM(CASE WHEN t.type IN ('STOCK_IN', 'ADJUSTMENT_IN') THEN t.quantity
                                      ELSE -t.quantity END), 0) AS SIGNED) AS difference
FROM medicine_batches b
LEFT JOIN stock_transactions t ON t.batch_id = b.id
GROUP BY b.id, b.medicine_id, b.batch_number, b.quantity;


-- ---------------------------------------------------------------------
-- 5. STORED PROCEDURES
-- ---------------------------------------------------------------------

-- 5a. Expiry report. IN p_days (1..365): returns every batch that still
--     holds stock and expires within p_days days, including batches that
--     are already expired (alert_status = 'EXPIRED').
CREATE PROCEDURE `sp_expiring_batches`(IN p_days INT)
  READS SQL DATA
  COMMENT 'Batches with stock expiring within p_days days (expired ones included)'
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p_days must be between 1 and 365';
  END IF;

  SELECT
    v.batch_id, v.medicine_id, v.medicine_name, v.strength, v.unit,
    v.category_name, v.batch_number, v.expiry_date, v.quantity,
    v.days_to_expiry,
    IF(v.days_to_expiry <= 0, 'EXPIRED', 'EXPIRING_SOON') AS alert_status,
    v.supplier_name, v.stock_value
  FROM v_batch_stock v
  WHERE v.quantity > 0
    AND v.days_to_expiry <= p_days
  ORDER BY v.expiry_date, v.medicine_name, v.batch_number;
END;

-- 5b. Bulk write-off of every expired batch that still holds stock, in ONE
--     transaction: one WASTE operation header + one WASTE ledger row per
--     batch (the ledger trigger zeroes each batch). Any error rolls the
--     whole write-off back. Re-using an idempotency key fails on the
--     unique index, so a retried request cannot write off twice.
--     The matching audit event is queued in audit_outbox in the same
--     transaction. Returns one row: operation_id (NULL when nothing was
--     expired), batch_count, unit_count.
CREATE PROCEDURE `sp_write_off_expired`(IN p_user_id INT, IN p_idempotency_key CHAR(36))
  MODIFIES SQL DATA
  COMMENT 'Atomically writes off all expired stock as WASTE (reason EXPIRED)'
BEGIN
  DECLARE v_done BOOLEAN DEFAULT FALSE;
  DECLARE v_batch_id INT;
  DECLARE v_qty INT;
  DECLARE v_operation_id INT DEFAULT NULL;
  DECLARE v_batches INT DEFAULT 0;
  DECLARE v_units INT DEFAULT 0;
  DECLARE cur_expired CURSOR FOR
    SELECT id, quantity
      FROM medicine_batches
     WHERE quantity > 0 AND expiry_date <= fn_business_today()
     ORDER BY expiry_date, id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND role = 'ADMIN' AND is_active = TRUE) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an active administrator can write off expired stock';
  END IF;

  START TRANSACTION;

  INSERT INTO stock_operations (`type`, idempotency_key, performed_by_id, reason, notes, created_at)
  VALUES ('WASTE', p_idempotency_key, p_user_id, 'EXPIRED',
          'Bulk write-off of expired stock (sp_write_off_expired)', UTC_TIMESTAMP(3));
  SET v_operation_id = LAST_INSERT_ID();

  OPEN cur_expired;
  write_off_loop: LOOP
    FETCH cur_expired INTO v_batch_id, v_qty;
    IF v_done THEN
      LEAVE write_off_loop;
    END IF;
    INSERT INTO stock_transactions (batch_id, `type`, quantity, performed_by_id, operation_id, notes, created_at)
    VALUES (v_batch_id, 'WASTE', v_qty, p_user_id, v_operation_id, 'Expired stock written off', UTC_TIMESTAMP(3));
    SET v_batches = v_batches + 1;
    SET v_units = v_units + v_qty;
  END LOOP;
  CLOSE cur_expired;

  IF v_batches = 0 THEN
    ROLLBACK;
    SET v_operation_id = NULL;
  ELSE
    -- The audit event is queued in the same transaction (transactional
    -- outbox); the application later delivers it to MongoDB.
    INSERT INTO audit_outbox (payload, created_at)
    SELECT JSON_OBJECT(
             'action', 'stock.write_off_expired',
             'entityType', 'stock_operation',
             'entityId', CAST(v_operation_id AS CHAR),
             'summary', CONCAT('Wrote off ', v_units, ' expired units from ', v_batches, ' batch(es)'),
             'actor', JSON_OBJECT('id', u.id, 'name', u.name, 'role', u.role),
             'details', JSON_OBJECT('operationId', v_operation_id, 'batchCount', v_batches,
                                    'unitCount', v_units, 'via', 'sp_write_off_expired'),
             'occurredAt', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ')),
           UTC_TIMESTAMP(3)
      FROM users u
     WHERE u.id = p_user_id;
    COMMIT;
  END IF;

  SELECT v_operation_id AS operation_id, v_batches AS batch_count, v_units AS unit_count;
END;


-- ---------------------------------------------------------------------
-- 6. SCHEDULED EVENT
-- ---------------------------------------------------------------------
-- Expired sessions are already rejected at login-check time; this event
-- just keeps the table small. Requires event_scheduler=ON (MySQL default).
CREATE EVENT IF NOT EXISTS `ev_purge_expired_sessions`
  ON SCHEDULE EVERY 1 HOUR
  COMMENT 'Deletes login sessions that expired more than a day ago'
  DO DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY;
