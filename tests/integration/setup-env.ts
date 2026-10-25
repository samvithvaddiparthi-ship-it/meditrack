import { testDatabaseConfig } from "./test-env";

// Point the application modules at the test databases before they connect.
const config = testDatabaseConfig();
process.env.DATABASE_URL = config.databaseUrl;
process.env.MONGODB_DB = config.mongoDb;
process.env.EXPIRY_ALERT_DAYS = "30";
