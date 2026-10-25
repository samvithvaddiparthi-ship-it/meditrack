import "dotenv/config";

/** Resolves the dedicated test databases; refuses anything not named *_test. */
export function testDatabaseConfig() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const mongoDb = process.env.TEST_MONGODB_DB ?? "meditrack_test";
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to run tests against MySQL database "${dbName}" (name must end with _test)`);
  if (!mongoDb.endsWith("_test")) throw new Error(`Refusing to run tests against MongoDB database "${mongoDb}" (name must end with _test)`);
  return { databaseUrl, dbName, mongoDb };
}
