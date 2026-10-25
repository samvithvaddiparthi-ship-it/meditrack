import "server-only";
import * as mariadb from "mariadb";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * One MySQL connection pool shared by Prisma (through the MariaDB driver
 * adapter) and by the few direct driver calls that Prisma cannot model,
 * such as stored procedures that return result sets.
 */
type DbHandles = { pool: mariadb.Pool; prisma: PrismaClient };

const globalForDb = globalThis as unknown as { __meditrackDb?: DbHandles };

function poolConfigFromUrl(databaseUrl: string): mariadb.PoolConfig {
  const url = new URL(databaseUrl);
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
    throw new Error("DATABASE_URL must use the mysql:// scheme");
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: Number(url.searchParams.get("connection_limit") ?? 10),
    // The adapter disables the prepared-statement cache for pools it owns;
    // apply the same setting to this externally created pool.
    prepareCacheLength: 0,
    // Sessions use UTC, matching how DATETIME values are stored.
    timezone: "Z",
    connectTimeout: 10_000,
  };
}

function createHandles(): DbHandles {
  const pool = mariadb.createPool(poolConfigFromUrl(env().DATABASE_URL));
  const adapter = new PrismaMariaDb(pool);
  const prisma = new PrismaClient({ adapter });
  return { pool, prisma };
}

function handles(): DbHandles {
  if (!globalForDb.__meditrackDb) {
    globalForDb.__meditrackDb = createHandles();
  }
  return globalForDb.__meditrackDb;
}

/** Prisma client (lazy, one instance per process / dev-server reload). */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = handles().prisma;
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Raw driver pool, used for CALL statements. */
export function mysqlPool(): mariadb.Pool {
  return handles().pool;
}

/** Closes all MySQL connections (scripts and tests). */
export async function disconnectDb(): Promise<void> {
  const current = globalForDb.__meditrackDb;
  if (!current) return;
  globalForDb.__meditrackDb = undefined;
  await current.prisma.$disconnect();
  await current.pool.end().catch(() => undefined);
}

export type Tx = Prisma.TransactionClient;
