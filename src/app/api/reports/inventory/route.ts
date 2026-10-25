import { apiRoute } from "@/server/api";
import { inventoryReports } from "@/server/services/inventory.service";

/** GET /api/reports/inventory */
export const GET = apiRoute("reports:view", (_request, actor) => inventoryReports(actor));
