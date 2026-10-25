import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { getUser } from "@/server/services/users.service";
import { NotFoundError } from "@/lib/errors";
import { formatDateTime } from "@/lib/dates";
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { ActiveBadge, RoleBadge } from "@/components/ui/status";
import { Notice } from "@/components/ui/notice";
import type { SearchParams } from "@/components/ui/list";
import { EditUserForm, ResetPasswordForm } from "../user-forms";
import { resetPasswordAction, updateUserAction } from "../actions";

export const metadata: Metadata = { title: "Edit user" };

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const actor = await requirePageAccess("user:manage");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const u = await getUser(actor, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!u) notFound();
  return (
    <>
      <PageHeader
        title={u.name}
        description={
          <span className="flex items-center gap-2">
            <RoleBadge role={u.role} />
            <ActiveBadge active={u.isActive} />
            <span>{u.email}</span>
          </span>
        }
      />
      <Notice params={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Account" />
          <CardBody>
            <EditUserForm action={updateUserAction.bind(null, u.id)} initial={{ name: u.name, role: u.role, isActive: u.isActive }} isSelf={u.id === actor.id} />
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Reset password" description="Signs the user out of all sessions" />
            <CardBody>
              <ResetPasswordForm action={resetPasswordAction.bind(null, u.id)} />
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Created", value: formatDateTime(u.createdAt) },
                  { label: "Last sign-in", value: formatDateTime(u.lastLoginAt) },
                  { label: "Locked until", value: u.lockedUntil && u.lockedUntil > new Date() ? formatDateTime(u.lockedUntil) : "Not locked" },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
