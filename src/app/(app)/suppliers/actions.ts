"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject } from "@/lib/validation/common";
import { requireActor } from "@/server/auth/session";
import { actionError } from "@/server/actions/helpers";
import { createSupplier, deleteSupplier, updateSupplier } from "@/server/services/catalog.service";

export async function createSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let id: number;
  try {
    const actor = await requireActor("supplier:manage");
    id = (await createSupplier(actor, formToObject(formData))).id;
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/suppliers/${id}?notice=supplier-created`);
}

export async function updateSupplierAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor("supplier:manage");
    await updateSupplier(actor, id, formToObject(formData));
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/suppliers/${id}?notice=supplier-updated`);
}

export async function deleteSupplierAction(id: number, _prev: ActionState): Promise<ActionState> {
  try {
    const actor = await requireActor("supplier:manage");
    await deleteSupplier(actor, id);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/", "layout");
  redirect("/suppliers?notice=supplier-deleted");
}
