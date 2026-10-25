import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listUsers } from "@/server/services/users.service";
import { formatDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { ButtonLink, Card, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { ActiveBadge, RoleBadge } from "@/components/ui/status";
import { Badge } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const user = await requirePageAccess("user:manage");
  const users = await listUsers(user);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Staff accounts and their roles. Accounts with stock history are deactivated, never deleted, so the ledger keeps its references."
        actions={<ButtonLink href="/admin/users/new">Add user</ButtonLink>}
      />
      <Card>
        <Table caption="Users">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th align="right">Ledger entries</Th>
              <Th>Last sign-in</Th>
            </tr>
          </thead>
          <TBody>
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/60">
                <Td>
                  <TextLink href={`/admin/users/${u.id}`}>{u.name}</TextLink>
                  {u.id === user.id ? <span className="ml-2 text-xs text-slate-500">(you)</span> : null}
                  <div className="text-xs text-slate-500">{u.email}</div>
                </Td>
                <Td>
                  <RoleBadge role={u.role} />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <ActiveBadge active={u.isActive} />
                    {u.lockedUntil && u.lockedUntil > now ? <Badge tone="danger">Locked</Badge> : null}
                  </div>
                </Td>
                <Td align="right">{formatNumber(u._count.stockTransactions)}</Td>
                <Td className="text-xs text-slate-500">{formatDateTime(u.lastLoginAt)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
