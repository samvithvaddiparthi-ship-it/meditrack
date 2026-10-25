import "server-only";
import { MongoClient, type Db, type Document } from "mongodb";
import { env } from "@/lib/env";
import { ServiceUnavailableError, logServerError } from "@/lib/errors";

/**
 * MongoDB holds the flexible, document-shaped data: incident reports
 * (type-specific metadata + embedded review timeline) and the activity /
 * audit log. Inventory quantities never live here.
 */
export const COLLECTIONS = {
  incidents: "incident_reports",
  activity: "activity_logs",
  counters: "counters",
} as const;

type MongoHandles = { client: MongoClient; ready: Promise<Db>; dbName: string };

const globalForMongo = globalThis as unknown as { __meditrackMongo?: MongoHandles };

const incidentValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["reference", "type", "title", "description", "severity", "status", "reporter", "timeline", "createdAt", "updatedAt"],
    properties: {
      reference: { bsonType: "string", pattern: "^INC-[0-9]{5,}$" },
      type: { enum: ["DAMAGED_MEDICINE", "DAMAGED_PACKAGING", "STOCK_DISCREPANCY", "STORAGE_TEMPERATURE", "OTHER"] },
      title: { bsonType: "string", minLength: 5, maxLength: 120 },
      description: { bsonType: "string", minLength: 10, maxLength: 2000 },
      severity: { enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      status: { enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"] },
      medicine: {
        bsonType: ["object", "null"],
        required: ["id", "name"],
        properties: { id: { bsonType: "int" }, name: { bsonType: "string" } },
      },
      batch: {
        bsonType: ["object", "null"],
        required: ["id", "batchNumber"],
        properties: { id: { bsonType: "int" }, batchNumber: { bsonType: "string" } },
      },
      reporter: {
        bsonType: "object",
        required: ["id", "name", "role"],
        properties: { id: { bsonType: "int" }, name: { bsonType: "string" }, role: { enum: ["ADMIN", "STAFF"] } },
      },
      metadata: { bsonType: "object" },
      timeline: {
        bsonType: "array",
        minItems: 1,
        items: {
          bsonType: "object",
          required: ["at", "actor", "action"],
          properties: {
            at: { bsonType: "date" },
            action: { enum: ["CREATED", "STATUS_CHANGED"] },
          },
        },
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};

const activityValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["action", "entityType", "summary", "createdAt"],
    properties: {
      action: { bsonType: "string", pattern: "^[a-z_]+\\.[a-z_]+$" },
      entityType: { bsonType: "string" },
      entityId: { bsonType: ["string", "null"] },
      summary: { bsonType: "string", maxLength: 300 },
      actor: {
        bsonType: ["object", "null"],
        properties: { id: { bsonType: "int" }, name: { bsonType: "string" }, role: { enum: ["ADMIN", "STAFF"] } },
      },
      details: { bsonType: "object" },
      createdAt: { bsonType: "date" },
    },
  },
};

async function ensureCollection(db: Db, name: string, validator?: Document): Promise<void> {
  const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) {
    await db.createCollection(name, validator ? { validator, validationLevel: "strict", validationAction: "error" } : {});
  } else if (validator) {
    await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
  }
}

/** Creates collections, JSON-schema validators and indexes (idempotent). */
export async function ensureMongoSchema(db: Db): Promise<void> {
  await ensureCollection(db, COLLECTIONS.incidents, incidentValidator);
  await ensureCollection(db, COLLECTIONS.activity, activityValidator);
  await ensureCollection(db, COLLECTIONS.counters);

  const incidents = db.collection(COLLECTIONS.incidents);
  await incidents.createIndexes([
    { key: { reference: 1 }, name: "uq_reference", unique: true },
    { key: { status: 1, severity: 1, createdAt: -1 }, name: "idx_status_severity_created" },
    { key: { type: 1, createdAt: -1 }, name: "idx_type_created" },
    { key: { "reporter.id": 1, createdAt: -1 }, name: "idx_reporter_created" },
    { key: { "medicine.id": 1 }, name: "idx_medicine" },
    { key: { title: "text", description: "text" }, name: "txt_title_description", weights: { title: 3, description: 1 } },
  ]);

  const activity = db.collection(COLLECTIONS.activity);
  await activity.createIndexes([
    { key: { createdAt: -1 }, name: "idx_created" },
    { key: { entityType: 1, entityId: 1, createdAt: -1 }, name: "idx_entity" },
    { key: { "actor.id": 1, createdAt: -1 }, name: "idx_actor_created" },
    { key: { action: 1, createdAt: -1 }, name: "idx_action_created" },
  ]);
}

function createHandles(): MongoHandles {
  const { MONGODB_URI, MONGODB_DB } = env();
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 10,
    appName: "meditrack",
  });
  const ready = client
    .connect()
    .then(async (c) => {
      const db = c.db(MONGODB_DB);
      await ensureMongoSchema(db);
      return db;
    });
  return { client, ready, dbName: MONGODB_DB };
}

/**
 * Connected database handle. A failed connection is not cached, so the next
 * request retries instead of failing forever.
 */
export async function mongoDb(): Promise<Db> {
  if (!globalForMongo.__meditrackMongo) {
    globalForMongo.__meditrackMongo = createHandles();
  }
  const handles = globalForMongo.__meditrackMongo;
  try {
    return await handles.ready;
  } catch (error) {
    if (globalForMongo.__meditrackMongo === handles) globalForMongo.__meditrackMongo = undefined;
    await handles.client.close().catch(() => undefined);
    logServerError("MongoDB connection failed", error);
    throw new ServiceUnavailableError("The incident and activity database (MongoDB) is unavailable. Please try again shortly.");
  }
}

export async function disconnectMongo(): Promise<void> {
  const handles = globalForMongo.__meditrackMongo;
  globalForMongo.__meditrackMongo = undefined;
  if (handles) await handles.client.close().catch(() => undefined);
}

/** Atomic sequence (findOneAndUpdate + $inc) for human-readable references. */
export async function nextSequence(db: Db, name: string): Promise<number> {
  const result = await db
    .collection<{ _id: string; value: number }>(COLLECTIONS.counters)
    .findOneAndUpdate({ _id: name }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" });
  if (!result) throw new Error("Counter update failed");
  return result.value;
}
