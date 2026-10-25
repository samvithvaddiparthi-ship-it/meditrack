import { apiRoute, jsonBody } from "@/server/api";
import { issueStock } from "@/server/services/stock.service";

/** POST /api/stock/issue { idempotencyKey, medicineId, quantity, destination, notes? } — FEFO issue. */
export const POST = apiRoute("stock:issue", async (request, actor) => issueStock(actor, await jsonBody(request)));
