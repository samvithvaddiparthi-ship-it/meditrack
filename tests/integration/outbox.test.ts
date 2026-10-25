import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { COLLECTIONS, disconnectMongo, mongoDb } from "@/lib/mongo";
import { createMedicine as createMedicineService } from "@/server/services/catalog.service";
import { flushOutbox } from "@/server/services/audit.service";
import { createIncident } from "@/server/services/incidents.service";
import { ServiceUnavailableError } from "@/lib/errors";
import { createCategory, createUser } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

async function withMongoDown<T>(work: () => Promise<T>): Promise<T> {
  const original = process.env.MONGODB_URI;
  await disconnectMongo();
  process.env.MONGODB_URI = "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300&connectTimeoutMS=300";
  resetEnvCache();
  try {
    return await work();
  } finally {
    process.env.MONGODB_URI = original;
    resetEnvCache();
    await disconnectMongo();
  }
}

describe("MySQL ↔ MongoDB failure handling (transactional outbox)", () => {
  it("commits the MySQL change, queues the audit event, and delivers it once MongoDB is back", async () => {
    const { actor } = await createUser("ADMIN");
    const category = await createCategory();

    const medicine = await withMongoDown(() =>
      createMedicineService(actor, {
        name: "Outboxin",
        categoryId: category.id,
        manufacturer: "Acme",
        dosageForm: "TABLET",
        strength: "1 mg",
        unit: "strip",
        storageCondition: "ROOM_TEMPERATURE",
        reorderLevel: 1,
        isActive: true,
      }),
    );
    expect(await prisma.medicine.findUnique({ where: { id: medicine.id } })).not.toBeNull();
    const pending = await prisma.auditOutbox.findMany({ where: { deliveredAt: null } });
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].lastError).toBeTruthy();
    expect(pending[0].lastError).not.toMatch(/mongodb:\/\//);

    expect(await flushOutbox()).toBe(true);
    expect(await flushOutbox()).toBe(true); // re-delivery is a no-op
    const logs = await (await mongoDb()).collection(COLLECTIONS.activity).find({ action: "medicine.create" }).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]._id).toBe(`outbox:${pending[0].id}`);
    expect(await prisma.auditOutbox.count({ where: { deliveredAt: null } })).toBe(0);
  });

  it("reports a MongoDB outage for MongoDB-owned data instead of pretending success", async () => {
    const { actor } = await createUser("STAFF");
    await withMongoDown(async () => {
      await expect(
        createIncident(actor, { type: "OTHER", title: "Lost delivery note", description: "Delivery note missing from file.", severity: "LOW", metadata: {} }),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    });
    expect(await (await mongoDb()).collection(COLLECTIONS.incidents).countDocuments()).toBe(0);
  });
});
