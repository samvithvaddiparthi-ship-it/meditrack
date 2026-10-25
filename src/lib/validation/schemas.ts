import { z } from "zod";
import { DosageForm, StorageCondition, Role } from "@/generated/prisma/enums";
import {
  checkbox,
  email,
  id,
  idempotencyKey,
  int,
  isoDate,
  money,
  notFutureDate,
  optionalEmail,
  optionalText,
  text,
} from "@/lib/validation/common";

// ---------------------------------------------------------------- auth / users

export const loginSchema = z.object({
  email,
  password: z.string({ error: "Password is required." }).min(1, "Password is required.").max(128),
});

export const passwordSchema = z
  .string({ error: "Password is required." })
  .min(10, "Password must be at least 10 characters.")
  .max(128, "Password must be at most 128 characters.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password must contain letters and numbers.");

export const createUserSchema = z.object({
  name: text("Name", 2, 100),
  email,
  role: z.enum(Role, "Choose a role."),
  password: passwordSchema,
});

export const updateUserSchema = z.object({
  name: text("Name", 2, 100),
  role: z.enum(Role, "Choose a role."),
  isActive: checkbox,
});

export const resetPasswordSchema = z.object({ password: passwordSchema });

// ---------------------------------------------------------------- catalogue

export const categorySchema = z.object({
  name: text("Category name", 2, 60),
  description: optionalText("Description", 255),
});

export const medicineSchema = z.object({
  name: text("Name", 2, 120),
  genericName: optionalText("Generic name", 120),
  categoryId: id("Category"),
  manufacturer: text("Manufacturer", 2, 120),
  dosageForm: z.enum(DosageForm, "Choose a dosage form."),
  strength: text("Strength", 1, 40),
  unit: text("Unit", 1, 20),
  storageCondition: z.enum(StorageCondition, "Choose a storage condition."),
  description: optionalText("Description", 1000),
  reorderLevel: int("Reorder level", 0, 1_000_000),
  isActive: checkbox,
});

export const supplierSchema = z.object({
  name: text("Supplier name", 2, 120),
  contactPerson: optionalText("Contact person", 100),
  phone: text("Phone", 7, 20).regex(/^[0-9+() -]{7,20}$/, "Phone may contain digits, spaces, +, - and brackets."),
  email: optionalEmail,
  address: text("Address", 5, 255),
  licenseNumber: optionalText("Drug licence number", 50),
  isActive: checkbox,
});

// ---------------------------------------------------------------- purchases

export const purchaseItemSchema = z
  .object({
    medicineId: id("Medicine"),
    batchNumber: text("Batch number", 1, 50).regex(
      /^[A-Za-z0-9][A-Za-z0-9\-/]*$/,
      "Batch number may contain letters, digits, - and /.",
    ).transform((v) => v.toUpperCase()),
    manufactureDate: notFutureDate("Manufacturing date"),
    expiryDate: isoDate("Expiry date"),
    quantity: int("Quantity", 1, 1_000_000),
    unitCost: money("Unit cost"),
  })
  .refine((v) => v.expiryDate > v.manufactureDate, {
    message: "Expiry date must be after the manufacturing date.",
    path: ["expiryDate"],
  });

export const purchaseSchema = z
  .object({
    idempotencyKey,
    supplierId: id("Supplier"),
    invoiceNumber: text("Invoice number", 1, 50),
    purchaseDate: notFutureDate("Purchase date"),
    notes: optionalText("Notes", 500),
    items: z.array(purchaseItemSchema).min(1, "Add at least one item.").max(50, "At most 50 items per receipt."),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((item, index) => {
      const key = `${item.medicineId}:${item.batchNumber.toUpperCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "This medicine and batch number already appear on the receipt.",
          path: ["items", index, "batchNumber"],
        });
      }
      seen.add(key);
    });
  });

// ---------------------------------------------------------------- stock operations

export const issueSchema = z.object({
  idempotencyKey,
  medicineId: id("Medicine"),
  quantity: int("Quantity", 1, 1_000_000),
  destination: text("Issued to", 2, 120),
  notes: optionalText("Notes", 500),
});

export const fefoPreviewSchema = z.object({
  medicineId: id("Medicine"),
  quantity: int("Quantity", 1, 1_000_000),
});

export const wasteSchema = z.object({
  idempotencyKey,
  batchId: id("Batch"),
  quantity: int("Quantity", 1, 1_000_000),
  reason: z.enum(["EXPIRED", "DAMAGED", "RECALLED", "CONTAMINATED", "OTHER"], "Choose a reason."),
  notes: optionalText("Notes", 500),
});

export const adjustmentSchema = z
  .object({
    idempotencyKey,
    batchId: id("Batch"),
    direction: z.enum(["IN", "OUT"], "Choose increase or decrease."),
    quantity: int("Quantity", 1, 1_000_000),
    reason: z.enum(["COUNT_CORRECTION", "DAMAGED", "OTHER"], "Choose a reason."),
    notes: text("Notes", 5, 500),
  });

export const writeOffExpiredSchema = z.object({ idempotencyKey });

// ---------------------------------------------------------------- incidents (MongoDB)

export const INCIDENT_TYPES = [
  "DAMAGED_MEDICINE",
  "DAMAGED_PACKAGING",
  "STOCK_DISCREPANCY",
  "STORAGE_TEMPERATURE",
  "OTHER",
] as const;
export const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const INCIDENT_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const optionalInt = (label: string, min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), int(label, min, max).optional());

const optionalNumber = (label: string, min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce
      .number({ error: `${label} must be a number.` })
      .min(min, `${label} must be at least ${min}.`)
      .max(max, `${label} must be at most ${max}.`)
      .optional(),
  );

/** Type-specific metadata: the reason incident reports live in MongoDB. */
export const incidentMetadataSchema = z.object({
  affectedQuantity: optionalInt("Affected quantity", 1, 1_000_000),
  location: optionalText("Location", 120),
  damageCause: optionalText("Cause of damage", 200),
  packagingType: optionalText("Packaging type", 60),
  sealIntact: z.preprocess((v) => (v === "" || v === undefined ? undefined : v === "yes" || v === true), z.boolean().optional()),
  expectedQuantity: optionalInt("Expected quantity", 0, 1_000_000),
  countedQuantity: optionalInt("Counted quantity", 0, 1_000_000),
  recordedTemperatureC: optionalNumber("Recorded temperature", -80, 80),
  durationMinutes: optionalInt("Duration", 1, 100_000),
});

export const incidentSchema = z
  .object({
    type: z.enum(INCIDENT_TYPES, "Choose an incident type."),
    title: text("Title", 5, 120),
    description: text("Description", 10, 2000),
    severity: z.enum(INCIDENT_SEVERITIES, "Choose a severity."),
    medicineId: z.preprocess((v) => (v === "" || v === null ? undefined : v), id("Medicine").optional()),
    batchId: z.preprocess((v) => (v === "" || v === null ? undefined : v), id("Batch").optional()),
    metadata: incidentMetadataSchema,
  })
  .superRefine((v, ctx) => {
    if (v.batchId && !v.medicineId) {
      ctx.addIssue({ code: "custom", message: "Choose the medicine for this batch.", path: ["medicineId"] });
    }
    if (v.type === "STOCK_DISCREPANCY") {
      if (v.metadata.expectedQuantity === undefined) {
        ctx.addIssue({ code: "custom", message: "Expected quantity is required.", path: ["metadata", "expectedQuantity"] });
      }
      if (v.metadata.countedQuantity === undefined) {
        ctx.addIssue({ code: "custom", message: "Counted quantity is required.", path: ["metadata", "countedQuantity"] });
      }
      if (!v.batchId) {
        ctx.addIssue({ code: "custom", message: "Choose the batch that was counted.", path: ["batchId"] });
      }
    }
    if (v.type === "STORAGE_TEMPERATURE" && v.metadata.recordedTemperatureC === undefined) {
      ctx.addIssue({ code: "custom", message: "Recorded temperature is required.", path: ["metadata", "recordedTemperatureC"] });
    }
    if ((v.type === "DAMAGED_MEDICINE" || v.type === "DAMAGED_PACKAGING") && !v.medicineId) {
      ctx.addIssue({ code: "custom", message: "Choose the affected medicine.", path: ["medicineId"] });
    }
  });

export const incidentStatusSchema = z.object({
  status: z.enum(INCIDENT_STATUSES, "Choose a status."),
  note: text("Review note", 3, 1000),
});

// ---------------------------------------------------------------- list filters

export const pageParam = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.coerce.number().int().min(1).max(100_000).catch(1),
);

export const searchParam = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.string().trim().max(100).catch("").optional(),
);
