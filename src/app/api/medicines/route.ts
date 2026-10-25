import { apiRoute, intSearchParam, jsonBody, searchParam } from "@/server/api";
import { createMedicine, listMedicines } from "@/server/services/catalog.service";

/** GET /api/medicines?q=&category=&stock=low|out&page= */
export const GET = apiRoute("medicine:view", (request, actor) =>
  listMedicines(actor, {
    q: searchParam(request, "q")?.slice(0, 100),
    categoryId: intSearchParam(request, "category"),
    stock: (["low", "out"] as const).find((s) => s === searchParam(request, "stock")),
    page: intSearchParam(request, "page"),
  }),
);

/** POST /api/medicines (admin) */
export const POST = apiRoute("medicine:manage", async (request, actor) => createMedicine(actor, await jsonBody(request)));
