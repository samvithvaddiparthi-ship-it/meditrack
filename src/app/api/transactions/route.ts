import { apiRoute, intSearchParam } from "@/server/api";
import { listTransactions } from "@/server/services/stock.service";

/** GET /api/transactions?medicine=&batch=&operation=&page= — stock ledger. */
export const GET = apiRoute("ledger:view", (request, actor) =>
  listTransactions(actor, {
    medicineId: intSearchParam(request, "medicine"),
    batchId: intSearchParam(request, "batch"),
    operationId: intSearchParam(request, "operation"),
    page: intSearchParam(request, "page"),
  }),
);
