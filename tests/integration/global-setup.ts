import { execSync } from "node:child_process";
import * as mariadb from "mariadb";
import { testDatabaseConfig } from "./test-env";

/**
 * Rebuilds the MySQL test database from the migrations once per run, so the
 * tests always exercise exactly the schema, triggers, views and procedures
 * that `prisma migrate deploy` produces.
 */
export default async function setup() {
  const { databaseUrl, dbName } = testDatabaseConfig();
  const url = new URL(databaseUrl);
  const conn = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await conn.end();
  }
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
