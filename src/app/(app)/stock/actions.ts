"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formToObject } from "@/lib/validation/common";
import { requireActor } from "@/server/auth/session";
import { actionError } from "@/server/actions/helpers";
import { issueStock, previewIssue, recordAdjustment, recordWaste, writeOffExpired } from "@/server/services/stock.service";

const auditSuffix = (delivered: boolean) => (delivered ? "" : "&audit=pending");

export async function previewIssueAction(payload: unknown): Promise<ActionState> {
  try {
    const actor = await requireActor("stock:issue");
    const plan = await previewIssue(actor, payload);
    return { ok: true, data: plan };
  } catch (error) {
    return actionError(error);
  }
}

export async function issueStockAction(payload: unknown): Promise<ActionState> {
  try {
    const actor = await requireActor("stock:issue");
    const result = await issueStock(actor, payload);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: "Stock issued.",
      data: { href: `/stock/operations/${result.operationId}?notice=${result.duplicate ? "issue-duplicate" : "issue-recorded"}${auditSuffix(result.auditDelivered)}` },
    };
  } catch (error) {
    return actionError(error, payload as Record<string, unknown>);
  }
}

export async function recordWasteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor("stock:waste");
    const result = await recordWaste(actor, formToObject(formData));
    revalidatePath("/", "layout");
    return { ok: true, message: "Waste recorded.", data: { href: `/stock/operations/${result.operationId}?notice=waste-recorded${auditSuffix(result.auditDelivered)}` } };
  } catch (error) {
    return actionError(error, formData);
  }
}

export async function recordAdjustmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const result = await recordAdjustment(actor, formToObject(formData));
    revalidatePath("/", "layout");
    return { ok: true, message: "Adjustment recorded.", data: { href: `/stock/operations/${result.operationId}?notice=adjustment-recorded${auditSuffix(result.auditDelivered)}` } };
  } catch (error) {
    return actionError(error, formData);
  }
}

export async function writeOffExpiredAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor("stock:write-off-expired");
    const result = await writeOffExpired(actor, formToObject(formData));
    if (result.operationId === null) return { ok: true, message: "There is no expired stock to write off." };
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Wrote off ${result.unitCount} unit(s) from ${result.batchCount} expired batch(es) in one transaction.`,
      data: { href: `/stock/operations/${result.operationId}?notice=waste-recorded${auditSuffix(result.auditDelivered)}` },
    };
  } catch (error) {
    return actionError(error);
  }
}
