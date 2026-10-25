import { apiRoute, intSearchParam } from "@/server/api";
import { expiryAlerts } from "@/server/services/inventory.service";

/** GET /api/alerts/expiry?days=30 — CALL sp_expiring_batches(days). */
export const GET = apiRoute("alerts:view", (request, actor) => expiryAlerts(actor, intSearchParam(request, "days")));
