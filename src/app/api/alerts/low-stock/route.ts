import { apiRoute } from "@/server/api";
import { lowStockAlerts } from "@/server/services/inventory.service";

/** GET /api/alerts/low-stock — rows of v_low_stock_medicines. */
export const GET = apiRoute("alerts:view", (_request, actor) => lowStockAlerts(actor));
