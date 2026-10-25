-- idx_medicines_name duplicated the leftmost column of uq_medicines_identity
-- (name, strength, dosage_form, manufacturer); MySQL can use that unique
-- index for every `WHERE name = ...` / `name LIKE 'abc%'` / ORDER BY name
-- lookup, so the extra index only cost write time and storage.
DROP INDEX `idx_medicines_name` ON `medicines`;
