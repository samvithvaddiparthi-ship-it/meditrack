import { apiRoute, jsonBody } from "@/server/api";
import { previewIssue } from "@/server/services/stock.service";

/** POST /api/stock/fefo-preview { medicineId, quantity } — read-only FEFO plan. */
export const POST = apiRoute("stock:issue", async (request, actor) => previewIssue(actor, await jsonBody(request)));
