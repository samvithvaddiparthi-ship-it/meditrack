import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { isRetryableTransactionError } from "@/lib/errors";

/**
 * Runs `work` in one MySQL transaction (InnoDB, REPEATABLE READ). Every
 * statement commits together or the whole unit rolls back. Deadlocks and
 * lock-wait timeouts are retried a few times because InnoDB has already
 * rolled the victim transaction back.
 */
export async function runTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: { attempts?: number; retryIf?: (error: unknown) => boolean } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(work, { maxWait: 5_000, timeout: 20_000 });
    } catch (error) {
      const retry = isRetryableTransactionError(error) || (options.retryIf?.(error) ?? false);
      if (attempt < attempts && retry) {
        await new Promise((r) => setTimeout(r, 25 * attempt));
        continue;
      }
      throw error;
    }
  }
}
