/**
 * Creates the MongoDB collections, $jsonSchema validators and indexes
 * (idempotent; the application also runs this on first connection).
 *   npm run mongo:init
 */
import "dotenv/config";
import { COLLECTIONS, disconnectMongo, mongoDb } from "../src/lib/mongo";

async function main() {
  const db = await mongoDb(); // runs ensureMongoSchema()
  for (const name of Object.values(COLLECTIONS)) {
    const indexes = await db.collection(name).indexes();
    console.log(`${db.databaseName}.${name}: ${await db.collection(name).countDocuments()} document(s); indexes: ${indexes.map((i) => i.name).join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
