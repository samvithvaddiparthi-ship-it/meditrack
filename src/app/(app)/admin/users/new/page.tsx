import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { CreateUserForm } from "../user-forms";
import { createUserAction } from "../actions";

export const metadata: Metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requirePageAccess("user:manage");
  return (
    <>
      <PageHeader title="Add user" description="The password is hashed with bcrypt (cost 12) before it is stored; it is never saved or logged in plain text." />
      <Card>
        <CardBody className="py-6">
          <CreateUserForm action={createUserAction} />
        </CardBody>
      </Card>
    </>
  );
}
