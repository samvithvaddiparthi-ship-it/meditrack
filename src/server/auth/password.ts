import bcrypt from "bcryptjs";

/** bcrypt work factor (2^12 rounds). */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A valid hash of a random value, compared against when the email is
 * unknown so that response time does not reveal which accounts exist.
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$EuDpQ5JbDmedQBVAoFbqS.uKllDqtrDUFUKGJoFMZxccDqWDT.Ou.";
