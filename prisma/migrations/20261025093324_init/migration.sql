-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_users_email`(`email`),
    INDEX `idx_users_role_active`(`role`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(64) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_sessions_user`(`user_id`),
    INDEX `idx_sessions_expires`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_categories_name`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medicines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `generic_name` VARCHAR(120) NULL,
    `category_id` INTEGER NOT NULL,
    `manufacturer` VARCHAR(120) NOT NULL,
    `dosage_form` ENUM('TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'OINTMENT', 'CREAM', 'DROPS', 'INHALER', 'POWDER', 'OTHER') NOT NULL,
    `strength` VARCHAR(40) NOT NULL,
    `unit` VARCHAR(20) NOT NULL DEFAULT 'unit',
    `storage_condition` ENUM('ROOM_TEMPERATURE', 'COOL_DRY', 'REFRIGERATED', 'FROZEN') NOT NULL DEFAULT 'ROOM_TEMPERATURE',
    `description` VARCHAR(1000) NULL,
    `reorder_level` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_medicines_name`(`name`),
    INDEX `idx_medicines_category_active`(`category_id`, `is_active`),
    INDEX `idx_medicines_active_name`(`is_active`, `name`),
    UNIQUE INDEX `uq_medicines_identity`(`name`, `strength`, `dosage_form`, `manufacturer`),
    FULLTEXT INDEX `ft_medicines_search`(`name`, `generic_name`, `manufacturer`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `contact_person` VARCHAR(100) NULL,
    `phone` VARCHAR(20) NOT NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(255) NOT NULL,
    `license_number` VARCHAR(50) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_suppliers_name`(`name`),
    UNIQUE INDEX `uq_suppliers_license`(`license_number`),
    INDEX `idx_suppliers_active_name`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medicine_batches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `medicine_id` INTEGER NOT NULL,
    `batch_number` VARCHAR(50) NOT NULL,
    `manufacture_date` DATE NOT NULL,
    `expiry_date` DATE NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `unit_cost` DECIMAL(10, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_batches_fefo`(`medicine_id`, `expiry_date`),
    INDEX `idx_batches_expiry`(`expiry_date`),
    UNIQUE INDEX `uq_batches_medicine_number`(`medicine_id`, `batch_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `supplier_id` INTEGER NOT NULL,
    `invoice_number` VARCHAR(50) NOT NULL,
    `purchase_date` DATE NOT NULL,
    `received_by_id` INTEGER NOT NULL,
    `notes` VARCHAR(500) NULL,
    `idempotency_key` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_purchases_idempotency`(`idempotency_key`),
    INDEX `idx_purchases_date`(`purchase_date`),
    INDEX `idx_purchases_received_by`(`received_by_id`),
    UNIQUE INDEX `uq_purchases_supplier_invoice`(`supplier_id`, `invoice_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchase_id` INTEGER NOT NULL,
    `batch_id` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unit_cost` DECIMAL(10, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_purchase_items_batch`(`batch_id`),
    UNIQUE INDEX `uq_purchase_items_purchase_batch`(`purchase_id`, `batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_operations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('ISSUE', 'WASTE', 'ADJUSTMENT') NOT NULL,
    `idempotency_key` CHAR(36) NOT NULL,
    `performed_by_id` INTEGER NOT NULL,
    `destination` VARCHAR(120) NULL,
    `reason` ENUM('EXPIRED', 'DAMAGED', 'RECALLED', 'CONTAMINATED', 'COUNT_CORRECTION', 'OTHER') NULL,
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_operations_idempotency`(`idempotency_key`),
    INDEX `idx_operations_type_created`(`type`, `created_at`),
    INDEX `idx_operations_user`(`performed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_transactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batch_id` INTEGER NOT NULL,
    `type` ENUM('STOCK_IN', 'STOCK_OUT', 'WASTE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `balance_after` INTEGER NOT NULL DEFAULT 0,
    `performed_by_id` INTEGER NOT NULL,
    `purchase_item_id` INTEGER NULL,
    `operation_id` INTEGER NULL,
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_transactions_purchase_item`(`purchase_item_id`),
    INDEX `idx_transactions_batch_created`(`batch_id`, `created_at`),
    INDEX `idx_transactions_type_created`(`type`, `created_at`),
    INDEX `idx_transactions_created`(`created_at`),
    INDEX `idx_transactions_user`(`performed_by_id`),
    INDEX `idx_transactions_operation`(`operation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_outbox` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payload` JSON NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(500) NULL,
    `delivered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_outbox_pending`(`delivered_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `medicines` ADD CONSTRAINT `fk_medicines_category` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `medicine_batches` ADD CONSTRAINT `fk_batches_medicine` FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `fk_purchases_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `fk_purchases_user` FOREIGN KEY (`received_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `fk_purchase_items_purchase` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `fk_purchase_items_batch` FOREIGN KEY (`batch_id`) REFERENCES `medicine_batches`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_operations` ADD CONSTRAINT `fk_operations_user` FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_transactions` ADD CONSTRAINT `fk_transactions_batch` FOREIGN KEY (`batch_id`) REFERENCES `medicine_batches`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_transactions` ADD CONSTRAINT `fk_transactions_user` FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_transactions` ADD CONSTRAINT `fk_transactions_purchase_item` FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_transactions` ADD CONSTRAINT `fk_transactions_operation` FOREIGN KEY (`operation_id`) REFERENCES `stock_operations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
