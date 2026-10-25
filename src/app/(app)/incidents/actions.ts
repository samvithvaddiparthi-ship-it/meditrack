"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import { actionError } from "@/server/actions/helpers";
import { createIncident, updateIncidentStatus } from "@/server/services/incidents.service";

function incidentInput(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return {
    type: get("type"),
    title: get("title"),
    description: get("description"),
    severity: get("severity"),
    medicineId: get("medicineId"),
    batchId: get("batchId"),
    metadata: {
      affectedQuantity: get("affectedQuantity"),
      location: get("location"),
      damageCause: get("damageCause"),
      packagingType: get("packagingType"),
      sealIntact: get("sealIntact"),
      expectedQuantity: get("expectedQuantity"),
      countedQuantity: get("countedQuantity"),
      recordedTemperatureC: get("recordedTemperatureC"),
      durationMinutes: get("durationMinutes"),
    },
  };
}

/** Zod issue paths "metadata.x" map to the flat form field "x". */
function flattenMetadataErrors(state: ActionState): ActionState {
  if (!state?.fieldErrors) return state;
  const fieldErrors: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(state.fieldErrors)) fieldErrors[k.replace(/^metadata\./, "")] = v;
  return { ...state, fieldErrors };
}

export async function createIncidentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let target: string;
  try {
    const actor = await requireActor("incident:create");
    const result = await createIncident(actor, incidentInput(formData));
    target = `/incidents/${result.id}?notice=incident-created${result.auditDelivered ? "" : "&audit=pending"}`;
  } catch (error) {
    return flattenMetadataErrors(actionError(error, formData));
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function updateIncidentStatusAction(id: string, expectedStatus: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  let target: string;
  try {
    const actor = await requireActor("incident:review");
    const result = await updateIncidentStatus(actor, id, expectedStatus, { status: formData.get("status"), note: formData.get("note") });
    target = `/incidents/${id}?notice=incident-updated${result.auditDelivered ? "" : "&audit=pending"}`;
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(target);
}
