import { z } from "zod";

/**
 * Server configuration, read from environment variables only (never
 * hard-coded). Validated lazily so that importing a module does not fail
 * at build time when the variable is not needed.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1).default("meditrack"),
  EXPIRY_ALERT_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    // Only variable names are reported, never their values.
    throw new Error(`Invalid or missing environment configuration: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests that switch databases between suites. */
export function resetEnvCache(): void {
  cached = null;
}
