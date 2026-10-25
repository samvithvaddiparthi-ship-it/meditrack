import { apiRoute, intSearchParam, jsonBody, searchParam } from "@/server/api";
import { createIncident, listIncidents } from "@/server/services/incidents.service";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, INCIDENT_TYPES } from "@/lib/validation/schemas";

/** GET /api/incidents?q=&type=&severity=&status=&page= (staff see their own) */
export const GET = apiRoute("incident:create", (request, actor) =>
  listIncidents(actor, {
    q: searchParam(request, "q"),
    type: INCIDENT_TYPES.find((t) => t === searchParam(request, "type")),
    severity: INCIDENT_SEVERITIES.find((t) => t === searchParam(request, "severity")),
    status: INCIDENT_STATUSES.find((t) => t === searchParam(request, "status")),
    page: intSearchParam(request, "page"),
  }),
);

/** POST /api/incidents { type, title, description, severity, medicineId?, batchId?, metadata } */
export const POST = apiRoute("incident:create", async (request, actor) => createIncident(actor, await jsonBody(request)));
