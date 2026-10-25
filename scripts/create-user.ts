/**
 * Creates (or resets the password of) an account from the terminal, without
 * ever putting a password in the repository, shell history or process list.
 *
 *   npm run user:create -- --email admin@hospital.org --name "Asha Rao" --role ADMIN
 *
 * The password is read from a hidden prompt (or, for automation only, from
 * the NEW_USER_PASSWORD environment variable) and stored as a bcrypt hash.
 * Add --reset to change the password of an existing account.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { disconnectDb, prisma } from "../src/lib/db";
import { disconnectMongo } from "../src/lib/mongo";
import { email as emailSchema, text } from "../src/lib/validation/common";
import { passwordSchema } from "../src/lib/validation/schemas";
import { hashPassword } from "../src/server/auth/password";
import { recordAudit } from "../src/server/services/audit.service";

function prompt(question: string, hidden: boolean): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
    muted = hidden;
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "STAFF" },
      reset: { type: "boolean", default: false },
    },
  });
  const email = emailSchema.parse(values.email ?? (await prompt("Email: ", false)));
  const role = values.role?.toUpperCase();
  if (role !== "ADMIN" && role !== "STAFF") throw new Error("--role must be ADMIN or STAFF");

  let password = process.env.NEW_USER_PASSWORD;
  if (!password) {
    password = await prompt("Password (hidden): ", true);
    const confirm = await prompt("Confirm password: ", true);
    if (password !== confirm) throw new Error("Passwords do not match.");
  }
  const checked = passwordSchema.safeParse(password);
  if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? "Weak password");
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!values.reset) throw new Error(`${email} already exists. Use --reset to change its password.`);
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, isActive: true } }),
      prisma.session.deleteMany({ where: { userId: existing.id } }),
    ]);
    await recordAudit({ action: "user.reset_password", entityType: "user", entityId: existing.id, summary: `Password of ${email} reset from the command line` });
    console.log(`Password reset for ${email}; existing sessions were signed out.`);
    return;
  }
  const name = text("Name", 2, 100).parse(values.name ?? (await prompt("Full name: ", false)));
  const user = await prisma.user.create({ data: { email, name, role, passwordHash } });
  await recordAudit({ action: "user.create", entityType: "user", entityId: user.id, summary: `Created ${role.toLowerCase()} account for ${name} from the command line` });
  console.log(`Created ${role} account ${email} (id ${user.id}).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
    await disconnectMongo();
  });
