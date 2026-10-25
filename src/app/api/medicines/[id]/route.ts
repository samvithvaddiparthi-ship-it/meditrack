import { apiRoute } from "@/server/api";
import { NotFoundError } from "@/lib/errors";
import { getMedicine } from "@/server/services/catalog.service";

/** GET /api/medicines/:id — medicine, live stock summary and batches. */
export const GET = apiRoute<{ params: Promise<{ id: string }> }>("medicine:view", async (_request, actor, ctx) => {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError("Medicine not found.");
  return getMedicine(actor, id);
});
