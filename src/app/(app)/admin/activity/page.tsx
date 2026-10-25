import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { activitySummary, listActivity, outboxBacklog } from "@/server/services/audit.service";
import { listUserOptions } from "@/server/services/users.service";
import { ServiceUnavailableError } from "@/lib/errors";
import { formatDateTime } from "@/lib/dates";
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TBody, Td, Th } from "@/components/ui/primitives";
import { FilterBar, FilterSelect, Pagination, first, intParam, type SearchParams } from "@/components/ui/list";
import { RoleBadge } from "@/components/ui/status";
import { BarList } from "@/components/charts";

export const metadata: Metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("audit:view");
  const params = await searchParams;
  const filters = { action: first(params.action)?.slice(0, 60), entityType: first(params.entity)?.slice(0, 40), actorId: intParam(params.user), page: intParam(params.page) ?? 1 };
  const [users, backlog] = await Promise.all([listUserOptions(), outboxBacklog()]);
  let data: Awaited<ReturnType<typeof listActivity>> | null = null;
  let summary: Awaited<ReturnType<typeof activitySummary>> = [];
  try {
    [data, summary] = await Promise.all([listActivity(user, filters), activitySummary(user, 30)]);
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
  }

  return (
    <>
      <PageHeader
        title="Activity & audit log"
        description="Events stored in MongoDB (activity_logs). They are written to the MySQL audit_outbox inside each business transaction and then delivered, so no event is lost if MongoDB is briefly down. Passwords, tokens and connection strings are never recorded."
      />
      {backlog > 0 ? (
        <Alert tone="warning" className="mb-4">
          {backlog} event(s) are waiting in the MySQL outbox and will be delivered when MongoDB is reachable.
        </Alert>
      ) : null}
      {data === null ? (
        <Alert tone="danger">MongoDB is unreachable, so the activity log cannot be displayed. Inventory operations continue normally.</Alert>
      ) : (
        <>
          <Card>
            <CardHeader title="Events by action, last 30 days" description="MongoDB aggregation: $match → $group by action → $sort" />
            <CardBody>
              {summary.length === 0 ? <EmptyState title="No events in the last 30 days" /> : <BarList title="Events by action" categoryLabel="Action" valueLabel="Events" rows={summary.slice(0, 10).map((s) => ({ label: s.action, value: s.count }))} />}
            </CardBody>
          </Card>
          <Card className="mt-6">
            <FilterBar resetHref="/admin/activity">
              <FilterSelect label="Action" name="action" defaultValue={filters.action ?? ""} options={[{ value: "", label: "All actions" }, ...data.actions.map((a) => ({ value: a, label: a }))]} className="lg:w-56" />
              <FilterSelect label="Entity" name="entity" defaultValue={filters.entityType ?? ""} options={[{ value: "", label: "All entities" }, ...data.entityTypes.map((a) => ({ value: a, label: a }))]} />
              <FilterSelect label="User" name="user" defaultValue={filters.actorId ? String(filters.actorId) : ""} options={[{ value: "", label: "Anyone" }, ...users.map((u) => ({ value: String(u.id), label: u.label }))]} />
            </FilterBar>
            {data.entries.length === 0 ? (
              <EmptyState title="No events match these filters" />
            ) : (
              <Table caption="Activity log">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>Action</Th>
                    <Th>Summary</Th>
                    <Th>Entity</Th>
                  </tr>
                </thead>
                <TBody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(e.createdAt)}</Td>
                      <Td className="text-xs">
                        {e.actor ? (
                          <span className="flex flex-col items-start gap-1">
                            {e.actor.name}
                            <RoleBadge role={e.actor.role} />
                          </span>
                        ) : (
                          <span className="text-slate-400">anonymous</span>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{e.action}</Td>
                      <Td className="text-sm">{e.summary}</Td>
                      <Td className="font-mono text-xs text-slate-500">
                        {e.entityType}
                        {e.entityId ? `#${e.entityId.length > 10 ? `${e.entityId.slice(0, 8)}…` : e.entityId}` : ""}
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
            <Pagination pathname="/admin/activity" params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
          </Card>
        </>
      )}
    </>
  );
}
