/**
 * MediTrack demo data (synthetic). Run on an EMPTY database:
 *   npm run db:reset      (drops, migrates and seeds)   or   npm run db:seed
 *
 * Every stock movement goes through the real database triggers, inserted in
 * chronological order with back-dated timestamps, so batch quantities,
 * balance_after values and the ledger are consistent by construction.
 * All dates are relative to the current business date, so the demo
 * scenarios (expired, near-expiry, low-stock, out-of-stock batches) hold
 * whenever the seed is run.
 *
 * Demo account passwords come from DEMO_ADMIN_PASSWORD / DEMO_STAFF_PASSWORD
 * in .env; when absent, strong random passwords are generated and printed
 * once to this terminal. No password is stored in the repository.
 */
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import type { DosageForm, StorageCondition, StockReason } from "../src/generated/prisma/enums";
import { disconnectDb, prisma } from "../src/lib/db";
import { COLLECTIONS, disconnectMongo, mongoDb, nextSequence } from "../src/lib/mongo";
import { addDays, businessToday, businessTodayIso, toIsoDate } from "../src/lib/dates";
import { allocateFefo } from "../src/lib/fefo";
import { passwordSchema } from "../src/lib/validation/schemas";
import { hashPassword } from "../src/server/auth/password";
import { flushOutbox } from "../src/server/services/audit.service";

const TODAY = businessToday();
const TODAY_ISO = businessTodayIso();
const IST_OFFSET_MIN = 330;

/** Calendar date `days` before today, "YYYY-MM-DD". */
const dayIso = (daysFromToday: number) => toIsoDate(addDays(TODAY, daysFromToday));
const day = (daysFromToday: number) => addDays(TODAY, daysFromToday);
/** UTC instant for HH:MM IST on the day `daysAgo` days before today. */
function at(daysAgo: number, hour: number, minute = 0): Date {
  return new Date(day(-daysAgo).getTime() + (hour * 60 + minute - IST_OFFSET_MIN) * 60_000);
}

// --------------------------------------------------------------- reference data

const CATEGORIES = [
  ["Analgesics & Antipyretics", "Pain relief and fever reduction"],
  ["Antibiotics", "Antibacterial agents"],
  ["Antidiabetics", "Blood-glucose lowering medicines and insulin"],
  ["Cardiovascular", "Blood pressure and lipid control"],
  ["Gastrointestinal", "Acid control, rehydration and digestive care"],
  ["Respiratory & Allergy", "Bronchodilators, antihistamines and mucolytics"],
  ["Vitamins & Supplements", "Nutritional supplements"],
  ["Dermatology", "Topical creams, gels and ointments"],
] as const;

type MedicineSeed = {
  key: string;
  name: string;
  genericName?: string;
  category: (typeof CATEGORIES)[number][0];
  manufacturer: string;
  dosageForm: DosageForm;
  strength: string;
  unit: string;
  storage: StorageCondition;
  reorderLevel: number;
  description?: string;
};

const MEDICINES: MedicineSeed[] = [
  { key: "PCM", name: "Paracetamol", genericName: "Acetaminophen", category: "Analgesics & Antipyretics", manufacturer: "Sunrise Pharmaceuticals", dosageForm: "TABLET", strength: "500 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 50, description: "Strip of 10 tablets." },
  { key: "IBU", name: "Ibuprofen", category: "Analgesics & Antipyretics", manufacturer: "Medivance Labs", dosageForm: "TABLET", strength: "400 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 30, description: "Strip of 10 film-coated tablets." },
  { key: "DCL", name: "Diclofenac Gel", genericName: "Diclofenac diethylamine", category: "Dermatology", manufacturer: "Arogya Lifesciences", dosageForm: "OINTMENT", strength: "1% w/w 30 g", unit: "tube", storage: "ROOM_TEMPERATURE", reorderLevel: 15 },
  { key: "AMX", name: "Amoxicillin", category: "Antibiotics", manufacturer: "Novacure Remedies", dosageForm: "CAPSULE", strength: "500 mg", unit: "strip", storage: "COOL_DRY", reorderLevel: 40, description: "Strip of 10 capsules." },
  { key: "AZI", name: "Azithromycin", category: "Antibiotics", manufacturer: "Novacure Remedies", dosageForm: "TABLET", strength: "500 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 25, description: "Strip of 3 tablets." },
  { key: "CFX", name: "Ceftriaxone", category: "Antibiotics", manufacturer: "Kaveri Biotech", dosageForm: "INJECTION", strength: "1 g", unit: "vial", storage: "COOL_DRY", reorderLevel: 20, description: "Powder for injection; reconstitute before use." },
  { key: "MET", name: "Metformin", category: "Antidiabetics", manufacturer: "Zenith Formulations", dosageForm: "TABLET", strength: "500 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 60 },
  { key: "INS", name: "Insulin Glargine", category: "Antidiabetics", manufacturer: "Kaveri Biotech", dosageForm: "INJECTION", strength: "100 IU/mL", unit: "pen", storage: "REFRIGERATED", reorderLevel: 20, description: "Prefilled pen. Store at 2–8 °C; do not freeze." },
  { key: "AML", name: "Amlodipine", category: "Cardiovascular", manufacturer: "Zenith Formulations", dosageForm: "TABLET", strength: "5 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 40 },
  { key: "ATV", name: "Atorvastatin", category: "Cardiovascular", manufacturer: "Medivance Labs", dosageForm: "TABLET", strength: "10 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 40 },
  { key: "PAN", name: "Pantoprazole", category: "Gastrointestinal", manufacturer: "Sunrise Pharmaceuticals", dosageForm: "TABLET", strength: "40 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 25 },
  { key: "ORS", name: "Oral Rehydration Salts", category: "Gastrointestinal", manufacturer: "Arogya Lifesciences", dosageForm: "POWDER", strength: "21.8 g", unit: "sachet", storage: "COOL_DRY", reorderLevel: 100, description: "WHO formula ORS sachet for 1 litre of water." },
  { key: "RNT", name: "Ranitidine", category: "Gastrointestinal", manufacturer: "Medivance Labs", dosageForm: "TABLET", strength: "150 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 0, description: "Discontinued after a manufacturer recall; kept for history." },
  { key: "SAL", name: "Salbutamol Inhaler", genericName: "Albuterol", category: "Respiratory & Allergy", manufacturer: "Kaveri Biotech", dosageForm: "INHALER", strength: "100 mcg/dose", unit: "inhaler", storage: "ROOM_TEMPERATURE", reorderLevel: 10 },
  { key: "CTZ", name: "Cetirizine", category: "Respiratory & Allergy", manufacturer: "Sunrise Pharmaceuticals", dosageForm: "TABLET", strength: "10 mg", unit: "strip", storage: "ROOM_TEMPERATURE", reorderLevel: 30 },
  { key: "AMB", name: "Ambroxol Syrup", genericName: "Ambroxol hydrochloride", category: "Respiratory & Allergy", manufacturer: "Arogya Lifesciences", dosageForm: "SYRUP", strength: "30 mg/5 mL 100 mL", unit: "bottle", storage: "ROOM_TEMPERATURE", reorderLevel: 15 },
  { key: "VTD", name: "Cholecalciferol", genericName: "Vitamin D3", category: "Vitamins & Supplements", manufacturer: "Zenith Formulations", dosageForm: "CAPSULE", strength: "60000 IU", unit: "strip", storage: "COOL_DRY", reorderLevel: 20, description: "Strip of 4 softgel capsules." },
  { key: "CLT", name: "Clotrimazole Cream", category: "Dermatology", manufacturer: "Novacure Remedies", dosageForm: "CREAM", strength: "1% w/w 15 g", unit: "tube", storage: "ROOM_TEMPERATURE", reorderLevel: 15 },
];

const SUPPLIERS = [
  { key: "BPD", name: "Bangalore Pharma Distributors", contactPerson: "Anil Shetty", phone: "+91 80 4123 5566", email: "orders@bpd.example.in", address: "14, 2nd Cross, Chickpet, Bengaluru 560053", licenseNumber: "KA-BLR-20B-11873", isActive: true },
  { key: "KMA", name: "Karnataka Medical Agencies", contactPerson: "Lakshmi Rao", phone: "+91 80 2667 1020", email: "sales@kma.example.in", address: "88, Hosur Road, Wilson Garden, Bengaluru 560027", licenseNumber: "KA-BLR-21B-30451", isActive: true },
  { key: "CCB", name: "Coldchain Biologics Pvt Ltd", contactPerson: "Farhan Ali", phone: "+91 98450 22110", email: "dispatch@coldchain.example.in", address: "Plot 7, KIADB Industrial Area, Bommasandra, Bengaluru 560099", licenseNumber: "KA-BLR-20B-40987", isActive: true },
  { key: "SBM", name: "Shree Balaji Medical Supplies", contactPerson: "Venkatesh Iyer", phone: "+91 99001 45678", email: null, address: "221, Sampige Road, Malleshwaram, Bengaluru 560003", licenseNumber: "KA-BLR-21B-55210", isActive: true },
  { key: "AHL", name: "Apex Healthcare Logistics", contactPerson: "Neha Kulkarni", phone: "+91 80 4900 7788", email: "care@apexhl.example.in", address: "3rd Floor, Outer Ring Road, Marathahalli, Bengaluru 560037", licenseNumber: "KA-BLR-20B-61002", isActive: true },
  { key: "OTD", name: "Old Town Drug House", contactPerson: "R. Gopal", phone: "+91 80 2222 3344", email: null, address: "5, Avenue Road, Bengaluru 560002", licenseNumber: "KA-BLR-19B-00871", isActive: false },
] as const;

type SupplierKey = (typeof SUPPLIERS)[number]["key"];
type UserKey = "admin" | "staff" | "ravi" | "meera";

type PurchaseSeed = {
  supplier: SupplierKey;
  invoice: string;
  daysAgo: number;
  hour: number;
  by: UserKey;
  items: { med: string; batch: string; mfg: number; exp: number; qty: number; cost: number }[];
};

// mfg = days relative to today (negative = past); exp = days from today (negative = already expired).
const PURCHASES: PurchaseSeed[] = [
  { supplier: "OTD", invoice: "OTD-3391", daysAgo: 178, hour: 11, by: "admin", items: [
    { med: "VTD", batch: "VTD-24A9", mfg: -300, exp: 150, qty: 30, cost: 30 },
  ] },
  { supplier: "BPD", invoice: "BPD-1041", daysAgo: 170, hour: 10, by: "ravi", items: [
    { med: "PCM", batch: "PCM-24A1", mfg: -200, exp: 12, qty: 120, cost: 18.5 },
    { med: "IBU", batch: "IBU-24B3", mfg: -230, exp: -10, qty: 60, cost: 22 },
    { med: "MET", batch: "MET-24C2", mfg: -300, exp: 25, qty: 150, cost: 12.75 },
    { med: "RNT", batch: "RNT-24D1", mfg: -250, exp: 200, qty: 40, cost: 15 },
    { med: "CTZ", batch: "CTZ-24E5", mfg: -400, exp: -40, qty: 50, cost: 9.5 },
  ] },
  { supplier: "KMA", invoice: "KMA-2208", daysAgo: 150, hour: 12, by: "ravi", items: [
    { med: "AMX", batch: "AMX-24F1", mfg: -330, exp: -3, qty: 30, cost: 45 },
    { med: "AZI", batch: "AZI-24G2", mfg: -200, exp: 300, qty: 60, cost: 72 },
    { med: "CFX", batch: "CFX-24H7", mfg: -120, exp: 540, qty: 40, cost: 38 },
  ] },
  { supplier: "CCB", invoice: "CCB-0091", daysAgo: 120, hour: 9, by: "admin", items: [
    { med: "INS", batch: "INS-24J1", mfg: -90, exp: 20, qty: 20, cost: 610 },
  ] },
  { supplier: "SBM", invoice: "SBM-5530", daysAgo: 95, hour: 15, by: "staff", items: [
    { med: "AML", batch: "AML-25A2", mfg: -150, exp: 420, qty: 100, cost: 14.2 },
    { med: "ATV", batch: "ATV-25B4", mfg: -140, exp: 500, qty: 100, cost: 28.4 },
    { med: "PAN", batch: "PAN-25C1", mfg: -100, exp: 380, qty: 80, cost: 19.9 },
    { med: "SAL", batch: "SAL-25D3", mfg: -160, exp: 300, qty: 25, cost: 145 },
  ] },
  { supplier: "BPD", invoice: "BPD-1102", daysAgo: 75, hour: 11, by: "ravi", items: [
    { med: "ORS", batch: "ORS-25E8", mfg: -60, exp: 600, qty: 300, cost: 6.5 },
    { med: "AMB", batch: "AMB-25F2", mfg: -80, exp: 450, qty: 40, cost: 58 },
    { med: "CLT", batch: "CLT-25G1", mfg: -90, exp: 500, qty: 20, cost: 42 },
    { med: "VTD", batch: "VTD-25H5", mfg: -70, exp: 560, qty: 50, cost: 31 },
  ] },
  { supplier: "KMA", invoice: "KMA-2291", daysAgo: 60, hour: 10, by: "staff", items: [
    { med: "PCM", batch: "PCM-25K2", mfg: -45, exp: 600, qty: 150, cost: 19 },
    { med: "DCL", batch: "DCL-25L1", mfg: -50, exp: 700, qty: 30, cost: 64 },
    { med: "CTZ", batch: "CTZ-25M3", mfg: -55, exp: 650, qty: 60, cost: 10 },
  ] },
  { supplier: "AHL", invoice: "AHL-7710", daysAgo: 45, hour: 14, by: "ravi", items: [
    { med: "MET", batch: "MET-25N1", mfg: -40, exp: 690, qty: 200, cost: 13.1 },
    { med: "AMX", batch: "AMX-25P4", mfg: -60, exp: 480, qty: 60, cost: 46.5 },
  ] },
  { supplier: "CCB", invoice: "CCB-0117", daysAgo: 30, hour: 9, by: "admin", items: [
    { med: "INS", batch: "INS-25Q2", mfg: -20, exp: 330, qty: 10, cost: 615 },
  ] },
  { supplier: "SBM", invoice: "SBM-5602", daysAgo: 14, hour: 16, by: "staff", items: [
    { med: "IBU", batch: "IBU-25R6", mfg: -30, exp: 700, qty: 80, cost: 21.5 },
    { med: "ATV", batch: "ATV-25S1", mfg: -25, exp: 710, qty: 60, cost: 29 },
  ] },
  { supplier: "AHL", invoice: "AHL-7788", daysAgo: 5, hour: 11, by: "ravi", items: [
    { med: "CFX", batch: "CFX-25T3", mfg: -30, exp: 700, qty: 30, cost: 39.5 },
    { med: "AML", batch: "AML-25U8", mfg: -20, exp: 720, qty: 80, cost: 14.5 },
  ] },
];

const DESTINATIONS = ["OPD Pharmacy Counter", "Ward 3 – General Medicine", "Emergency Department", "ICU", "Paediatric Ward", "Surgical Ward"];

// [medicine, daysAgo, quantity]; each is allocated with FEFO at that moment.
const ISSUES: [string, number, number][] = [
  ["PCM", 160, 15], ["PCM", 140, 10], ["PCM", 110, 10], ["PCM", 80, 10], ["PCM", 50, 15], ["PCM", 20, 25], ["PCM", 7, 20], ["PCM", 2, 20],
  ["IBU", 8, 10], ["IBU", 3, 12],
  ["MET", 150, 20], ["MET", 120, 20], ["MET", 90, 15], ["MET", 60, 15], ["MET", 30, 10], ["MET", 10, 10],
  ["RNT", 165, 5],
  ["CTZ", 30, 10], ["CTZ", 12, 8],
  ["AMX", 2, 15], ["AMX", 1, 20],
  ["AZI", 140, 6], ["AZI", 100, 10], ["AZI", 70, 8], ["AZI", 40, 10], ["AZI", 15, 8],
  ["CFX", 130, 5], ["CFX", 90, 8], ["CFX", 45, 6], ["CFX", 10, 5],
  ["INS", 100, 3], ["INS", 70, 3], ["INS", 40, 3], ["INS", 20, 2], ["INS", 6, 2], ["INS", 1, 1],
  ["AML", 80, 15], ["AML", 55, 20], ["AML", 30, 15], ["AML", 10, 10],
  ["ATV", 70, 20], ["ATV", 40, 20], ["ATV", 20, 15], ["ATV", 4, 10],
  ["PAN", 85, 10], ["PAN", 60, 15], ["PAN", 35, 15], ["PAN", 12, 10],
  ["SAL", 80, 3], ["SAL", 50, 5], ["SAL", 25, 6], ["SAL", 5, 5],
  ["ORS", 70, 40], ["ORS", 50, 60], ["ORS", 30, 50], ["ORS", 15, 40], ["ORS", 3, 30],
  ["AMB", 60, 6], ["AMB", 40, 8], ["AMB", 20, 5],
  ["CLT", 65, 4], ["CLT", 45, 6], ["CLT", 25, 5], ["CLT", 8, 5],
  ["VTD", 150, 5], ["VTD", 100, 5], ["VTD", 60, 6], ["VTD", 30, 5], ["VTD", 9, 4],
  ["DCL", 50, 4], ["DCL", 22, 5], ["DCL", 6, 3],
];

type SingleOp = {
  kind: "WASTE" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  batch: string;
  daysAgo: number;
  qty: number;
  reason: StockReason;
  by: UserKey;
  notes: string;
};

const SINGLE_OPS: SingleOp[] = [
  { kind: "WASTE", batch: "RNT-24D1", daysAgo: 120, qty: 35, reason: "RECALLED", by: "admin", notes: "Manufacturer recall notice MV/RC/0423 — all remaining stock quarantined and returned." },
  { kind: "WASTE", batch: "CTZ-24E5", daysAgo: 38, qty: 50, reason: "EXPIRED", by: "ravi", notes: "Expired batch removed from shelf and sent for disposal." },
  { kind: "WASTE", batch: "AMB-25F2", daysAgo: 33, qty: 3, reason: "DAMAGED", by: "staff", notes: "Three bottles cracked during shelf re-arrangement." },
  { kind: "ADJUSTMENT_OUT", batch: "ORS-25E8", daysAgo: 14, qty: 5, reason: "COUNT_CORRECTION", by: "ravi", notes: "Monthly physical count found 5 sachets fewer than system stock." },
  { kind: "ADJUSTMENT_IN", batch: "PAN-25C1", daysAgo: 9, qty: 2, reason: "COUNT_CORRECTION", by: "admin", notes: "Two strips found in the returns tray during audit." },
];

// --------------------------------------------------------------- helpers

function demoPassword(envName: string): { password: string; generated: boolean } {
  const fromEnv = process.env[envName];
  if (fromEnv) {
    const parsed = passwordSchema.safeParse(fromEnv);
    if (!parsed.success) throw new Error(`${envName} does not meet the password policy: ${parsed.error.issues[0]?.message}`);
    return { password: fromEnv, generated: false };
  }
  return { password: `Mt-${randomBytes(9).toString("base64url")}9a`, generated: true };
}

type Event =
  | { at: Date; kind: "purchase"; purchase: PurchaseSeed }
  | { at: Date; kind: "issue"; med: string; qty: number; destination: string; by: UserKey }
  | { at: Date; kind: "single"; op: SingleOp };

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    throw new Error("The database already contains data. Run `npm run db:reset` to recreate it from scratch.");
  }
  console.log(`Seeding MediTrack demo data (business date ${TODAY_ISO})...`);

  // ---- MongoDB: start from empty collections for this database.
  const mongo = await mongoDb();
  await Promise.all([
    mongo.collection(COLLECTIONS.incidents).deleteMany({}),
    mongo.collection(COLLECTIONS.activity).deleteMany({}),
    mongo.collection(COLLECTIONS.counters).deleteMany({}),
  ]);

  // ---- users
  const adminPw = demoPassword("DEMO_ADMIN_PASSWORD");
  const staffPw = demoPassword("DEMO_STAFF_PASSWORD");
  const [adminHash, staffHash, disabledHash] = await Promise.all([
    hashPassword(adminPw.password),
    hashPassword(staffPw.password),
    hashPassword(randomBytes(24).toString("hex")),
  ]);
  const userRows: Record<UserKey, { name: string; email: string; role: "ADMIN" | "STAFF"; hash: string; isActive: boolean }> = {
    admin: { name: "Samvith Vaddiparthi", email: "admin@meditrack.local", role: "ADMIN", hash: adminHash, isActive: true },
    staff: { name: "Sanjit C", email: "staff@meditrack.local", role: "STAFF", hash: staffHash, isActive: true },
    ravi: { name: "Ravi Kumar", email: "ravi.kumar@meditrack.local", role: "STAFF", hash: staffHash, isActive: true },
    meera: { name: "Meera Joshi", email: "meera.joshi@meditrack.local", role: "STAFF", hash: disabledHash, isActive: false },
  };
  const users = {} as Record<UserKey, { id: number; name: string; role: "ADMIN" | "STAFF" }>;
  for (const [key, u] of Object.entries(userRows) as [UserKey, (typeof userRows)[UserKey]][]) {
    const created = await prisma.user.create({
      data: { name: u.name, email: u.email, role: u.role, passwordHash: u.hash, isActive: u.isActive, createdAt: at(185, 9) },
    });
    users[key] = { id: created.id, name: created.name, role: created.role };
  }

  // ---- categories, medicines, suppliers
  const categoryIds = new Map<string, number>();
  for (const [name, description] of CATEGORIES) {
    const c = await prisma.category.create({ data: { name, description, createdAt: at(185, 9) } });
    categoryIds.set(name, c.id);
  }
  const medicines = new Map<string, { id: number; name: string; unit: string }>();
  for (const m of MEDICINES) {
    const created = await prisma.medicine.create({
      data: {
        name: m.name,
        genericName: m.genericName ?? null,
        categoryId: categoryIds.get(m.category)!,
        manufacturer: m.manufacturer,
        dosageForm: m.dosageForm,
        strength: m.strength,
        unit: m.unit,
        storageCondition: m.storage,
        reorderLevel: m.reorderLevel,
        description: m.description ?? null,
        createdAt: at(184, 10),
      },
    });
    medicines.set(m.key, { id: created.id, name: `${created.name} ${created.strength}`, unit: created.unit });
  }
  const suppliers = new Map<string, { id: number; name: string }>();
  for (const s of SUPPLIERS) {
    const created = await prisma.supplier.create({
      data: { name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, address: s.address, licenseNumber: s.licenseNumber, isActive: true, createdAt: at(184, 11) },
    });
    suppliers.set(s.key, { id: created.id, name: created.name });
  }

  // ---- chronological stock events
  const events: Event[] = [
    ...PURCHASES.map((p): Event => ({ at: at(p.daysAgo, p.hour), kind: "purchase", purchase: p })),
    ...ISSUES.map(([med, daysAgo, qty], i): Event => ({
      at: at(daysAgo, 13 + (i % 4), (i * 7) % 60),
      kind: "issue",
      med,
      qty,
      destination: DESTINATIONS[i % DESTINATIONS.length],
      by: (["ravi", "staff", "ravi", "admin"] as UserKey[])[i % 4],
    })),
    ...SINGLE_OPS.map((op): Event => ({ at: at(op.daysAgo, 17, 30), kind: "single", op })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const batches = new Map<string, { id: number; medKey: string; expiryIso: string; qty: number; receivedAt: Date }>();
  const audits: { at: Date; payload: Record<string, unknown> }[] = [];
  const audit = (when: Date, by: UserKey, action: string, entityType: string, entityId: number | string, summary: string, details: Record<string, unknown> = {}) =>
    audits.push({
      at: when,
      payload: { action, entityType, entityId: String(entityId), summary, actor: { id: users[by].id, name: users[by].name, role: users[by].role }, details, occurredAt: when.toISOString() },
    });

  for (const event of events) {
    if (event.kind === "purchase") {
      const p = event.purchase;
      const supplier = suppliers.get(p.supplier)!;
      const purchase = await prisma.purchase.create({
        data: {
          supplierId: supplier.id,
          invoiceNumber: p.invoice,
          purchaseDate: day(-p.daysAgo),
          receivedById: users[p.by].id,
          idempotencyKey: randomUUID(),
          createdAt: event.at,
        },
      });
      let units = 0;
      for (const item of p.items) {
        const med = medicines.get(item.med)!;
        const batch = await prisma.medicineBatch.create({
          data: {
            medicineId: med.id,
            batchNumber: item.batch,
            manufactureDate: day(item.mfg),
            expiryDate: day(item.exp),
            unitCost: new Prisma.Decimal(item.cost.toFixed(2)),
            createdAt: event.at,
          },
        });
        const line = await prisma.purchaseItem.create({
          data: { purchaseId: purchase.id, batchId: batch.id, quantity: item.qty, unitCost: new Prisma.Decimal(item.cost.toFixed(2)), createdAt: event.at },
        });
        await prisma.stockTransaction.create({
          data: { batchId: batch.id, type: "STOCK_IN", quantity: item.qty, performedById: users[p.by].id, purchaseItemId: line.id, notes: `Invoice ${p.invoice}`, createdAt: event.at },
        });
        batches.set(item.batch, { id: batch.id, medKey: item.med, expiryIso: dayIso(item.exp), qty: item.qty, receivedAt: event.at });
        units += item.qty;
      }
      audit(event.at, p.by, "purchase.receive", "purchase", purchase.id, `Received invoice ${p.invoice} from ${supplier.name}: ${p.items.length} line(s), ${units} units`, { lines: p.items.length, totalUnits: units });
    } else if (event.kind === "issue") {
      const med = medicines.get(event.med)!;
      const candidates = [...batches.entries()]
        .filter(([, b]) => b.medKey === event.med && b.receivedAt <= event.at)
        .map(([batchNumber, b]) => ({ batchId: b.id, batchNumber, expiryDate: b.expiryIso, quantity: b.qty }));
      // Eligible = unexpired today (the ledger trigger enforces this too).
      const plan = allocateFefo(candidates, event.qty, TODAY_ISO > toIsoDate(event.at) ? TODAY_ISO : toIsoDate(event.at));
      if (plan.shortfall > 0) throw new Error(`Seed plan error: not enough ${event.med} on ${event.at.toISOString()}`);
      const op = await prisma.stockOperation.create({
        data: { type: "ISSUE", idempotencyKey: randomUUID(), performedById: users[event.by].id, destination: event.destination, createdAt: event.at },
      });
      for (const a of plan.allocations) {
        await prisma.stockTransaction.create({
          data: { batchId: a.batchId, type: "STOCK_OUT", quantity: a.take, performedById: users[event.by].id, operationId: op.id, createdAt: event.at },
        });
        batches.get(a.batchNumber)!.qty -= a.take;
      }
      audit(event.at, event.by, "stock.issue", "stock_operation", op.id, `Issued ${event.qty} ${med.unit}(s) of ${med.name} to ${event.destination}`, {
        quantity: event.qty,
        batches: plan.allocations.map((a) => ({ batchNumber: a.batchNumber, quantity: a.take })),
      });
    } else {
      const { op } = event;
      const b = batches.get(op.batch)!;
      const med = medicines.get(b.medKey)!;
      const operation = await prisma.stockOperation.create({
        data: {
          type: op.kind === "WASTE" ? "WASTE" : "ADJUSTMENT",
          idempotencyKey: randomUUID(),
          performedById: users[op.by].id,
          reason: op.reason,
          notes: op.notes,
          createdAt: event.at,
        },
      });
      await prisma.stockTransaction.create({
        data: { batchId: b.id, type: op.kind, quantity: op.qty, performedById: users[op.by].id, operationId: operation.id, notes: op.notes, createdAt: event.at },
      });
      b.qty += op.kind === "ADJUSTMENT_IN" ? op.qty : -op.qty;
      const verb = op.kind === "WASTE" ? "Recorded as waste" : op.kind === "ADJUSTMENT_IN" ? "Adjusted +" : "Adjusted -";
      audit(event.at, op.by, op.kind === "WASTE" ? "stock.waste" : op.kind === "ADJUSTMENT_IN" ? "stock.adjust_in" : "stock.adjust_out", "stock_operation", operation.id,
        `${verb}${op.kind === "WASTE" ? ":" : ""} ${op.qty} ${med.unit}(s) of ${med.name} (batch ${op.batch}) — ${op.reason.toLowerCase().replace(/_/g, " ")}`, { quantity: op.qty, reason: op.reason });
    }
  }

  // ---- post-history state changes
  await prisma.medicine.update({ where: { id: medicines.get("RNT")!.id }, data: { isActive: false } });
  audit(at(119, 10), "admin", "medicine.deactivate", "medicine", medicines.get("RNT")!.id, "Deactivated medicine Ranitidine 150 mg after recall");
  await prisma.supplier.update({ where: { id: suppliers.get("OTD")!.id }, data: { isActive: false } });
  audit(at(100, 12), "admin", "supplier.update", "supplier", suppliers.get("OTD")!.id, "Marked supplier Old Town Drug House inactive (licence not renewed)");

  // ---- MongoDB incident reports
  const incidents = mongo.collection(COLLECTIONS.incidents);
  const ref = (u: UserKey) => ({ id: users[u].id, name: users[u].name, role: users[u].role });
  const batchRef = (bn: string) => ({ id: batches.get(bn)!.id, batchNumber: bn, expiryDate: batches.get(bn)!.expiryIso });
  const medRef = (k: string) => ({ id: medicines.get(k)!.id, name: medicines.get(k)!.name });
  type Seeded = {
    daysAgo: number; type: string; title: string; description: string; severity: string; reporter: UserKey;
    med?: string; batch?: string; metadata: Record<string, unknown>;
    reviews?: { daysAgo: number; by: UserKey; to: string; note: string }[];
  };
  const seededIncidents: Seeded[] = [
    { daysAgo: 121, type: "OTHER", title: "Manufacturer recall: Ranitidine 150 mg", description: "Recall notice MV/RC/0423 received for all Ranitidine 150 mg lots. Remaining stock must be quarantined and returned to the distributor.", severity: "CRITICAL", reporter: "admin", med: "RNT", batch: "RNT-24D1", metadata: { affectedQuantity: 35, location: "Main store, rack B2" },
      reviews: [{ daysAgo: 120, by: "admin", to: "RESOLVED", note: "35 strips written off as RECALLED waste and returned to Bangalore Pharma Distributors." }] },
    { daysAgo: 34, type: "DAMAGED_PACKAGING", title: "Cracked Ambroxol syrup bottles", description: "Three bottles of Ambroxol syrup found cracked and leaking after re-arranging the respiratory shelf.", severity: "LOW", reporter: "staff", med: "AMB", batch: "AMB-25F2", metadata: { affectedQuantity: 3, packagingType: "Glass bottle", sealIntact: false, location: "OPD pharmacy shelf R4" },
      reviews: [{ daysAgo: 33, by: "admin", to: "RESOLVED", note: "Bottles recorded as DAMAGED waste. Shelf liners added." }] },
    { daysAgo: 15, type: "STOCK_DISCREPANCY", title: "ORS sachet count mismatch", description: "Monthly physical count of ORS sachets shows fewer units than the system balance for batch ORS-25E8.", severity: "MEDIUM", reporter: "ravi", med: "ORS", batch: "ORS-25E8", metadata: { expectedQuantity: 110, countedQuantity: 105, difference: -5, location: "Main store, bin G1" },
      reviews: [
        { daysAgo: 14, by: "admin", to: "UNDER_REVIEW", note: "Checking issue slips for the last two weeks." },
        { daysAgo: 13, by: "admin", to: "RESOLVED", note: "No missing slips found; count correction of -5 recorded as an adjustment." },
      ] },
    { daysAgo: 4, type: "STORAGE_TEMPERATURE", title: "Pharmacy refrigerator temperature excursion", description: "The vaccine/insulin refrigerator logged 12 °C for about 45 minutes after a power cut. Insulin pens may be affected.", severity: "HIGH", reporter: "staff", med: "INS", batch: "INS-24J1", metadata: { recordedTemperatureC: 12, durationMinutes: 45, location: "Pharmacy refrigerator #1" },
      reviews: [{ daysAgo: 3, by: "admin", to: "UNDER_REVIEW", note: "Contacted Kaveri Biotech for stability guidance before deciding on write-off." }] },
    { daysAgo: 2, type: "DAMAGED_MEDICINE", title: "Moisture damage on Paracetamol strips", description: "Several Paracetamol strips near the store window show moisture damage and discoloured tablets.", severity: "MEDIUM", reporter: "ravi", med: "PCM", batch: "PCM-25K2", metadata: { affectedQuantity: 4, damageCause: "Rain water seepage near window", location: "Main store, rack A1" } },
    { daysAgo: 1, type: "OTHER", title: "Delivery van arrived without temperature log", description: "Apex Healthcare Logistics delivery arrived without the cold-chain temperature log sheet; non-refrigerated items only, accepted with remark.", severity: "LOW", reporter: "staff", metadata: { location: "Receiving bay" },
      reviews: [{ daysAgo: 0, by: "admin", to: "DISMISSED", note: "No cold-chain items in that delivery; supplier reminded to include logs." }] },
  ];
  for (const s of seededIncidents) {
    const createdAt = at(s.daysAgo, 11, 15);
    const seq = await nextSequence(mongo, "incident_reports");
    const timeline: Record<string, unknown>[] = [{ at: createdAt, actor: ref(s.reporter), action: "CREATED", toStatus: "OPEN" }];
    let status = "OPEN";
    let updatedAt = createdAt;
    for (const r of s.reviews ?? []) {
      const when = s.daysAgo === r.daysAgo ? at(r.daysAgo, 15) : at(r.daysAgo, 12, 40);
      const reviewAt = when > new Date() ? new Date() : when;
      timeline.push({ at: reviewAt, actor: ref(r.by), action: "STATUS_CHANGED", fromStatus: status, toStatus: r.to, note: r.note });
      status = r.to;
      updatedAt = reviewAt;
    }
    const doc = {
      reference: `INC-${String(seq).padStart(5, "0")}`,
      type: s.type,
      title: s.title,
      description: s.description,
      severity: s.severity,
      status,
      medicine: s.med ? medRef(s.med) : null,
      batch: s.batch ? batchRef(s.batch) : null,
      reporter: ref(s.reporter),
      metadata: s.metadata,
      timeline,
      createdAt,
      updatedAt,
    };
    const inserted = await incidents.insertOne(doc);
    audit(createdAt, s.reporter, "incident.create", "incident", inserted.insertedId.toHexString(), `Reported ${doc.reference}: ${s.title} (${s.severity.toLowerCase()})`, { reference: doc.reference, type: s.type, severity: s.severity });
    for (const t of timeline.slice(1)) {
      audit(t.at as Date, (Object.entries(users).find(([, u]) => u.id === (t.actor as { id: number }).id)![0]) as UserKey, "incident.status_change", "incident", inserted.insertedId.toHexString(),
        `${doc.reference}: ${t.fromStatus} → ${t.toStatus}`, { reference: doc.reference, from: t.fromStatus, to: t.toStatus });
    }
  }

  // ---- audit trail: queue in the MySQL outbox, then deliver to MongoDB
  audits.sort((a, b) => a.at.getTime() - b.at.getTime());
  await prisma.auditOutbox.createMany({
    data: audits.map((a) => ({ payload: a.payload as Prisma.InputJsonObject, createdAt: a.at })),
  });
  const delivered = await flushOutbox(500);

  // ---- verification
  const [reconciliation] = await prisma.$queryRaw<{ mismatched: bigint }[]>`SELECT COUNT(*) AS mismatched FROM v_stock_reconciliation WHERE difference <> 0`;
  for (const [batchNumber, b] of batches) {
    const row = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } });
    if (row.quantity !== b.qty) throw new Error(`Seed verification failed for ${batchNumber}: expected ${b.qty}, found ${row.quantity}`);
  }
  if (Number(reconciliation.mismatched) !== 0) throw new Error("Ledger reconciliation failed after seeding");

  const counts = {
    users: await prisma.user.count(),
    medicines: await prisma.medicine.count(),
    suppliers: await prisma.supplier.count(),
    batches: await prisma.medicineBatch.count(),
    purchases: await prisma.purchase.count(),
    ledgerRows: await prisma.stockTransaction.count(),
    incidents: await incidents.countDocuments(),
    activityLogs: await mongo.collection(COLLECTIONS.activity).countDocuments(),
  };
  console.log("Seed complete:", counts, delivered ? "(audit log delivered)" : "(audit delivery pending)");

  console.log("\nDemo accounts:");
  console.log(`  ADMIN  admin@meditrack.local  ${adminPw.generated ? `password: ${adminPw.password}  (generated — shown once)` : "password: value of DEMO_ADMIN_PASSWORD"}`);
  console.log(`  STAFF  staff@meditrack.local  ${staffPw.generated ? `password: ${staffPw.password}  (generated — shown once)` : "password: value of DEMO_STAFF_PASSWORD"}`);
  console.log("  STAFF  ravi.kumar@meditrack.local  (same password as staff)");
  if (adminPw.generated || staffPw.generated) {
    console.log("\nSet DEMO_ADMIN_PASSWORD / DEMO_STAFF_PASSWORD in .env before seeding to choose your own.");
  }
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
