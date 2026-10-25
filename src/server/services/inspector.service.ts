import "server-only";
import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { COLLECTIONS, mongoDb } from "@/lib/mongo";
import { logServerError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { outboxBacklog } from "@/server/services/audit.service";

const TABLES = ["users", "sessions", "categories", "medicines", "suppliers", "medicine_batches", "purchases", "purchase_items", "stock_operations", "stock_transactions", "audit_outbox"] as const;

/** Live catalogue of the database objects, read from information_schema. */
export async function inspectDatabases(actor: Actor) {
  assertCan(actor, "audit:view");
  const counts = await Promise.all(
    TABLES.map(async (t) => {
      const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM \`${t}\``);
      return { table: t, rows: Number(row.n) };
    }),
  );
  const [views, triggers, routines, indexes, checks, foreignKeys, events, version] = await Promise.all([
    prisma.$queryRaw<{ name: string }[]>`
      SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
    prisma.$queryRaw<{ name: string; timing: string; event: string; tbl: string }[]>`
      SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS tbl
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`,
    prisma.$queryRaw<{ name: string; type: string; comment: string }[]>`
      SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, ROUTINE_COMMENT AS comment
        FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
    prisma.$queryRaw<{ tbl: string; name: string; non_unique: number | bigint; index_type: string; cols: string }[]>`
      SELECT TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS non_unique, INDEX_TYPE AS index_type,
             GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS cols
        FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'
       GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE
       ORDER BY TABLE_NAME, INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME`,
    prisma.$queryRaw<{ tbl: string; name: string; clause: string }[]>`
      SELECT tc.TABLE_NAME AS tbl, cc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause
        FROM information_schema.CHECK_CONSTRAINTS cc
        JOIN information_schema.TABLE_CONSTRAINTS tc
          ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
       WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
       ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME`,
    prisma.$queryRaw<{ name: string; tbl: string; ref_tbl: string; cols: string; on_delete: string }[]>`
      SELECT rc.CONSTRAINT_NAME AS name, rc.TABLE_NAME AS tbl, rc.REFERENCED_TABLE_NAME AS ref_tbl,
             GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS cols, rc.DELETE_RULE AS on_delete
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        JOIN information_schema.KEY_COLUMN_USAGE k
          ON k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
       WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
       GROUP BY rc.CONSTRAINT_NAME, rc.TABLE_NAME, rc.REFERENCED_TABLE_NAME, rc.DELETE_RULE
       ORDER BY rc.TABLE_NAME, rc.CONSTRAINT_NAME`,
    prisma.$queryRaw<{ name: string; status: string; interval_value: string; interval_field: string }[]>`
      SELECT EVENT_NAME AS name, STATUS AS status, INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field
        FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()`,
    prisma.$queryRaw<{ v: string }[]>`SELECT VERSION() AS v`,
  ]);

  let mongo: { version: string; collections: { name: string; documents: number; validator: boolean; indexes: { name: string; key: string; unique: boolean }[] }[] } | null = null;
  try {
    const db = await mongoDb();
    const info = await db.admin().command({ buildInfo: 1 });
    const listed = await db.listCollections({}, { nameOnly: false }).toArray();
    mongo = {
      version: String(info.version),
      collections: await Promise.all(
        Object.values(COLLECTIONS).map(async (name) => {
          const meta = listed.find((c) => c.name === name) as { options?: { validator?: unknown } } | undefined;
          const coll = db.collection(name);
          const idx = await coll.indexes();
          return {
            name,
            documents: await coll.countDocuments(),
            validator: Boolean(meta?.options?.validator),
            indexes: idx.map((i) => ({ name: String(i.name), key: JSON.stringify(i.key), unique: Boolean(i.unique) })),
          };
        }),
      ),
    };
  } catch (error) {
    logServerError("Inspector MongoDB", error);
  }

  return {
    mysqlVersion: version[0]?.v ?? "unknown",
    counts,
    views: views.map((v) => v.name),
    triggers,
    routines,
    indexes: indexes.map((i) => ({ ...i, unique: Number(i.non_unique) === 0 })),
    checks,
    foreignKeys,
    events,
    mongo,
    outboxPending: await outboxBacklog(),
  };
}
