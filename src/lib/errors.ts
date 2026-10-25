/**
 * Application errors carry a message that is safe to show to end users.
 * Anything else (driver errors, stack traces, connection strings) is
 * logged on the server and replaced by a generic message.
 */
export class AppError extends Error {
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, status = 400, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message, 422, fieldErrors);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested record was not found.") {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

/** Thrown when a dependent service (MySQL / MongoDB) is unreachable. */
export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503);
  }
}

type DriverCause = {
  code?: number | string;
  originalCode?: string;
  message?: string;
  originalMessage?: string;
  state?: string;
  kind?: string;
  constraint?: { index?: string; fields?: string[] };
};

type PrismaLikeError = {
  code?: string;
  meta?: { driverAdapterError?: { cause?: DriverCause }; target?: unknown };
};

function driverCause(error: unknown): DriverCause | undefined {
  const e = error as PrismaLikeError & { cause?: DriverCause };
  return e?.meta?.driverAdapterError?.cause ?? undefined;
}

/** MySQL error number from a Prisma or mariadb driver error. */
export function mysqlErrorNumber(error: unknown): number | undefined {
  const cause = driverCause(error);
  const raw = cause?.originalCode ?? cause?.code ?? (error as { errno?: number })?.errno;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Name of the unique index that was violated, if any. */
export function uniqueConstraintName(error: unknown): string | undefined {
  const e = error as PrismaLikeError;
  if (e?.code !== "P2002" && mysqlErrorNumber(error) !== 1062) return undefined;
  const cause = driverCause(error);
  if (cause?.constraint?.index) return cause.constraint.index;
  const message = cause?.originalMessage ?? (error as Error)?.message ?? "";
  const match = /for key '(?:[\w]+\.)?([\w]+)'/.exec(message);
  return match?.[1];
}

export function isUniqueViolation(error: unknown, indexName?: string): boolean {
  const name = uniqueConstraintName(error);
  if (!name && (error as PrismaLikeError)?.code !== "P2002") return false;
  return indexName ? name === indexName : true;
}

export function isForeignKeyViolation(error: unknown): boolean {
  const n = mysqlErrorNumber(error);
  return (error as PrismaLikeError)?.code === "P2003" || n === 1451 || n === 1452;
}

/** Deadlock / lock wait timeout — safe to retry the whole transaction. */
export function isRetryableTransactionError(error: unknown): boolean {
  const n = mysqlErrorNumber(error);
  return (error as PrismaLikeError)?.code === "P2034" || n === 1213 || n === 1205;
}

const CHECK_MESSAGES: Record<string, string> = {
  chk_batches_expiry_after_manufacture: "Expiry date must be after the manufacturing date.",
  chk_batches_quantity_non_negative: "Stock cannot become negative.",
  chk_batches_unit_cost: "Unit cost cannot be negative.",
  chk_purchase_items_quantity: "Quantity must be greater than zero.",
  chk_purchase_items_unit_cost: "Unit cost cannot be negative.",
  chk_transactions_quantity_positive: "Movement quantity must be greater than zero.",
  chk_transactions_source: "A stock-in must reference a purchase line and every other movement a stock operation.",
  chk_transactions_balance_non_negative: "Stock cannot become negative.",
  chk_operations_reason: "The reason is not valid for this type of stock operation.",
  chk_operations_destination: "An issue must record where the stock was issued to.",
  chk_medicines_reorder_level: "Reorder level must be zero or more.",
  chk_suppliers_phone_format: "Phone number format is invalid.",
  chk_suppliers_email_format: "Email address format is invalid.",
  chk_users_email_format: "Email address format is invalid.",
};

/**
 * Message raised by a trigger / procedure (SIGNAL SQLSTATE '45000') or a
 * CHECK constraint. These were written for end users, so they are shown.
 */
export function databaseRuleMessage(error: unknown): string | undefined {
  const cause = driverCause(error);
  const n = mysqlErrorNumber(error);
  const message =
    cause?.originalMessage ?? cause?.message ?? (error as { sqlMessage?: string })?.sqlMessage ?? (error as Error)?.message;
  if (!message) return undefined;
  if (n === 1644 || cause?.state === "45000" || (error as { sqlState?: string })?.sqlState === "45000") {
    // mariadb driver errors prefix the text with "(conn:..., no: 1644, SQLState: 45000) ".
    return message.replace(/^\(conn[^)]*\)\s*/, "").replace(/\nsql:[\s\S]*$/, "").trim();
  }
  if (n === 3819) {
    const match = /Check constraint '([\w]+)'/.exec(message);
    return (match && CHECK_MESSAGES[match[1]]) ?? "The value violates a database rule.";
  }
  return undefined;
}

/** Converts any thrown value into a user-safe message. */
export function toUserMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof AppError) return error.message;
  const rule = databaseRuleMessage(error);
  if (rule) return rule;
  if (isForeignKeyViolation(error)) {
    return "This record is referenced by other data and cannot be changed this way.";
  }
  if (isUniqueViolation(error)) return "A record with these details already exists.";
  return fallback;
}

export function logServerError(context: string, error: unknown): void {
  // Server-side only; never sent to the browser.
  console.error(`[meditrack] ${context}:`, error);
}
