import { afterAll, beforeEach } from "vitest";
import { disconnectDb } from "@/lib/db";
import { disconnectMongo } from "@/lib/mongo";
import { resetDatabases } from "./helpers";

/** Call at the top of each integration suite. */
export function setupCleanDatabases(): void {
  beforeEach(async () => {
    await resetDatabases();
  });
  afterAll(async () => {
    await disconnectDb();
    await disconnectMongo();
  });
}
