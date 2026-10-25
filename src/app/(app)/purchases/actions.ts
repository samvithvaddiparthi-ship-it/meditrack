"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import { actionError } from "@/server/actions/helpers";
import { receivePurchase } from "@/server/services/purchases.service";

/** Called by the client receipt form with a JSON payload (validated server-side). */
export async function receivePurchaseAction(payload: unknown): Promise<ActionState> {
  try {
    const actor = await requireActor("purchase:create");
    const result = await receivePurchase(actor, payload);
    const notice = result.duplicate ? "purchase-duplicate" : "purchase-received";
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: "Receipt recorded.",
      data: { href: `/purchases/${result.purchaseId}?notice=${notice}${result.auditDelivered ? "" : "&audit=pending"}` },
    };
  } catch (error) {
    return actionError(error);
  }
}
