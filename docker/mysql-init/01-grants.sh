#!/bin/bash
# Runs once, on first container start. Lets the application user own every
# meditrack* schema: meditrack (app), meditrack_test (integration tests) and
# meditrack_shadow (Prisma's shadow database for `prisma migrate dev`).
set -euo pipefail
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS meditrack_test   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS meditrack_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON \`meditrack%\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
