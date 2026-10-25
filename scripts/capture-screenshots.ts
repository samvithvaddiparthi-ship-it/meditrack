/**
 * Captures the submission screenshots into docs/screenshots/ and acts as an
 * end-to-end smoke test (fails if any page shows the error boundary).
 *
 *   APP_URL=http://localhost:3000 npm run screenshots
 *
 * Uses the locally installed Google Chrome (no browser download) and the
 * demo passwords from .env (DEMO_ADMIN_PASSWORD / DEMO_STAFF_PASSWORD).
 */
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function login(page: Page, email: string, password: string) {
  await page.goto(`${APP}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${APP}/dashboard`);
}

async function shot(page: Page, name: string, path: string, options: { fullPage?: boolean } = {}) {
  if (path) await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
  const body = await page.content();
  if (body.includes("The page could not be loaded")) throw new Error(`Error boundary rendered on ${path}`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: options.fullPage ?? true });
  console.log(`✓ ${name}${path ? ` (${path})` : ""}`);
}

async function main() {
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  const staffPassword = process.env.DEMO_STAFF_PASSWORD;
  if (!adminPassword || !staffPassword) throw new Error("Set DEMO_ADMIN_PASSWORD and DEMO_STAFF_PASSWORD in .env");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
    await admin.goto(`${APP}/login`);
    await shot(admin, "01-login", "", { fullPage: false });
    await login(admin, "admin@meditrack.local", adminPassword);
    await shot(admin, "02-dashboard", "/dashboard");
    await shot(admin, "03-medicines", "/medicines");
    await shot(admin, "04-medicine-search-fulltext", "/medicines?q=amox");
    await shot(admin, "05-medicine-details", "/medicines/7");
    await shot(admin, "06-medicine-form", "/medicines/new");
    await shot(admin, "07-batch-inventory", "/batches");
    await shot(admin, "08-receive-stock", "/purchases/new");
    await shot(admin, "09-purchase-history", "/purchases");
    await shot(admin, "10-purchase-details", "/purchases/2");

    await admin.goto(`${APP}/stock/issue`, { waitUntil: "networkidle" });
    const medicineSelect = admin.getByLabel("Medicine");
    const paracetamol = await medicineSelect.locator("option", { hasText: "Paracetamol 500 mg" }).getAttribute("value");
    await medicineSelect.selectOption(paracetamol ?? "");
    await admin.getByLabel(/Quantity/).fill("150");
    await admin.getByLabel("Issued to").fill("Emergency Department");
    await admin.getByRole("button", { name: "Preview batches" }).click();
    await admin.getByText("Take", { exact: true }).waitFor();
    await shot(admin, "11-issue-stock-fefo-preview", "");

    const multiBatch = await admin.request.get(`${APP}/api/transactions?page=1`);
    if (!multiBatch.ok()) throw new Error("API /api/transactions failed");
    await shot(admin, "12-stock-operation-multi-batch", "/stock/operations/75");
    await shot(admin, "13-waste-and-adjustments", "/stock/waste");
    await shot(admin, "14-stock-ledger", "/stock/transactions");
    await shot(admin, "15-suppliers", "/suppliers");
    await shot(admin, "16-expiry-alerts", "/alerts/expiry");
    await shot(admin, "17-low-stock-alerts", "/alerts/low-stock");
    await shot(admin, "18-incident-reports", "/incidents");
    await admin.locator('a[href^="/incidents/"]:not([href="/incidents/new"])').first().click();
    await admin.waitForURL(/\/incidents\/[0-9a-f]{24}$/);
    await shot(admin, "19-incident-details", "");
    await shot(admin, "20-reports", "/reports");
    await shot(admin, "21-users-and-roles", "/admin/users");
    await shot(admin, "22-activity-log", "/admin/activity");
    await shot(admin, "23-database-inspector", "/admin/database");

    const staff = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await login(staff, "staff@meditrack.local", staffPassword);
    await shot(staff, "24-staff-dashboard", "/dashboard");
    await staff.goto(`${APP}/admin/users`);
    await staff.waitForURL(`${APP}/forbidden`);
    await shot(staff, "25-staff-access-denied", "", { fullPage: false });
    const denied = await staff.request.post(`${APP}/api/medicines`, { data: {}, headers: { origin: APP } });
    if (denied.status() !== 403) throw new Error(`Expected 403 for staff POST /api/medicines, got ${denied.status()}`);
    console.log("✓ staff POST /api/medicines -> 403");

    const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await login(mobile, "staff@meditrack.local", staffPassword);
    await shot(mobile, "26-mobile-dashboard", "/dashboard", { fullPage: false });
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
