import { apiRoute } from "@/server/api";
import { dashboardMetrics } from "@/server/services/inventory.service";

/** GET /api/dashboard — headline metrics. */
export const GET = apiRoute("dashboard:view", (_request, actor) => dashboardMetrics(actor));
