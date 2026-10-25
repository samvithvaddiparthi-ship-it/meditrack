import { apiRoute } from "@/server/api";
import { incidentSummary } from "@/server/services/incidents.service";

/** GET /api/incidents/summary — MongoDB $facet aggregation. */
export const GET = apiRoute("incident:create", (_request, actor) => incidentSummary(actor));
