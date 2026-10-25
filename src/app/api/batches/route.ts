import { apiRoute, intSearchParam, searchParam } from "@/server/api";
import { listBatches } from "@/server/services/inventory.service";

const STATUSES = ["AVAILABLE", "EXPIRING_SOON", "EXPIRED", "DEPLETED"] as const;

/** GET /api/batches?status=&medicine=&q=&page= */
export const GET = apiRoute("batch:view", (request, actor) =>
  listBatches(actor, {
    q: searchParam(request, "q")?.slice(0, 100),
    status: STATUSES.find((s) => s === searchParam(request, "status")),
    medicineId: intSearchParam(request, "medicine"),
    page: intSearchParam(request, "page"),
  }),
);
