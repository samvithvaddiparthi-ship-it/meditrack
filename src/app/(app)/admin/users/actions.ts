"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject } from "@/lib/validation/common";
import { requireActor } from "@/server/auth/session";
import { actionError } from "@/server/actions/helpers";
import { createUser, resetUserPassword, updateUser } from "@/server/services/users.service";

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let id: number;
  try {
    const actor = await requireActor("user:manage");
    id = (await createUser(actor, formToObject(formData))).id;
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/admin/users/${id}?notice=user-created`);
}

export async function updateUserAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor("user:manage");
    await updateUser(actor, id, formToObject(formData));
  } catch (error) {
    return actionError(error, formData);
  }
  revalidatePath("/", "layout");
  redirect(`/admin/users/${id}?notice=user-updated`);
}

export async function resetPasswordAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor("user:manage");
    if (formData.get("password") !== formData.get("confirmPassword")) {
      return { ok: false, message: "Passwords do not match.", fieldErrors: { confirmPassword: ["Passwords do not match."] } };
    }
    await resetUserPassword(actor, id, { password: formData.get("password") });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/", "layout");
  redirect(`/admin/users/${id}?notice=password-reset`);
}
