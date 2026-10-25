"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject } from "@/lib/validation/common";
import { requireActor } from "@/server/auth/session";
import { actionError } from "@/server/actions/helpers";
import {
  createCategory,
  createMedicine,
  deleteCategory,
  deleteMedicine,
  setMedicineActive,
  updateCategory,
  updateMedicine,
} from "@/server/services/catalog.service";

export async function createMedicineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let id: number;
  try {
    const actor = await requireActor("medicine:manage");
    id = (await createMedicine(actor, formToObject(formData))).id;
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/medicines/${id}?notice=medicine-created`);
}

export async function updateMedicineAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor("medicine:manage");
    await updateMedicine(actor, id, formToObject(formData));
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/medicines/${id}?notice=medicine-updated`);
}

export async function toggleMedicineAction(id: number, active: boolean, _prev: ActionState): Promise<ActionState> {
  try {
    const actor = await requireActor("medicine:manage");
    await setMedicineActive(actor, id, active);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/", "layout");
  redirect(`/medicines/${id}?notice=${active ? "medicine-activated" : "medicine-deactivated"}`);
}

export async function deleteMedicineAction(id: number, _prev: ActionState): Promise<ActionState> {
  try {
    const actor = await requireActor("medicine:manage");
    await deleteMedicine(actor, id);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/", "layout");
  redirect("/medicines?notice=medicine-deleted");
}

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor("category:manage");
    const id = Number(formData.get("id"));
    const input = formToObject(formData);
    if (id > 0) await updateCategory(actor, id, input);
    else await createCategory(actor, input);
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect("/medicines/categories?notice=category-saved");
}

export async function deleteCategoryAction(id: number, _prev: ActionState): Promise<ActionState> {
  try {
    const actor = await requireActor("category:manage");
    await deleteCategory(actor, id);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/", "layout");
  redirect("/medicines/categories?notice=category-deleted");
}
