import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { activitySummary, listActivity, outboxBacklog } from "@/server/services/audit.service";
import { listUserOptions } from "@/server/services/users.service";
import { ServiceUnavailableError } from "@/lib/errors";
import { formatDateTime } from "@/lib/dates";
import { actionLabel } from "@/lib/activity-labels";
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TBody, Td, Th } from "@/components/ui/primitives";
import { FilterBar, FilterSelect, Pagination, first, intParam, type SearchParams } from "@/components/ui/list";
import { BarList } from "@/components/charts";

export const metadata: Metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("audit:view");
  const params = await searchParams;
  const filters = { action: first(params.action)?.slice(0, 60), actorId: intParam(params.user), page: intParam(params.page) ?? 1 };
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
      <PageHeader title="Activity log" description="Who did what, and when. Every sign-in, stock movement, incident and change is recorded here automatically, newest first." />
      {backlog > 0 ? (
        <Alert tone="warning" className="mb-4">
          {backlog} recent action(s) will appear here shortly.
        </Alert>
      ) : null}
      {data === null ? (
        <Alert tone="danger">The activity log is unavailable right now (MongoDB cannot be reached). Everything else in the app still works.</Alert>
      ) : (
        <>
          <Card>
            <CardHeader title="What happened in the last 30 days" description="How many times each kind of action happened" />
            <CardBody>
              {summary.length === 0 ? (
                <EmptyState title="Nothing in the last 30 days" />
              ) : (
                <BarList title="Actions in the last 30 days" categoryLabel="Action" valueLabel="Times" rows={summary.slice(0, 10).map((s) => ({ label: actionLabel(s.action), value: s.count }))} />
              )}
            </CardBody>
          </Card>

          <Card className="mt-6">
            <FilterBar resetHref="/admin/activity">
              <FilterSelect
                label="Type of action"
                name="action"
                defaultValue={filters.action ?? ""}
                options={[{ value: "", label: "All actions" }, ...data.actions.map((a) => ({ value: a, label: actionLabel(a) })).sort((a, b) => a.label.localeCompare(b.label))]}
                className="lg:w-64"
              />
              <FilterSelect label="Person" name="user" defaultValue={filters.actorId ? String(filters.actorId) : ""} options={[{ value: "", label: "Everyone" }, ...users.map((u) => ({ value: String(u.id), label: u.label }))]} />
            </FilterBar>
            {data.entries.length === 0 ? (
              <EmptyState title="Nothing matches these filters" />
            ) : (
              <Table caption="Activity log">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>What happened</Th>
                  </tr>
                </thead>
                <TBody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <Td className="whitespace-nowrap text-sm text-slate-500">{formatDateTime(e.createdAt)}</Td>
                      <Td className="whitespace-nowrap text-sm">{e.actor ? e.actor.name : <span className="text-slate-400">Unknown person</span>}</Td>
                      <Td>
                        <p className="text-sm font-semibold text-slate-900">{actionLabel(e.action)}</p>
                        <p className="text-sm text-slate-600">{e.summary}</p>
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
            <Pagination pathname="/admin/activity" params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
          </Card>

          <details className="mt-6 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-700 shadow-sm">
            <summary className="cursor-pointer font-semibold text-slate-900">How this works (for the viva)</summary>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Each entry is one document in the MongoDB collection <code>activity_logs</code>.
              </li>
              <li>
                The chart is a MongoDB aggregation: <code>$match</code> (last 30 days) → <code>$group</code> by action and count → <code>$sort</code>, the
                same idea as SQL&apos;s WHERE, GROUP BY and ORDER BY.
              </li>
              <li>
                An entry is first saved in the MySQL table <code>audit_outbox</code> in the same transaction as the change, then copied to MongoDB. If
                MongoDB is down it waits and is copied later, so nothing is lost (the outbox pattern).
              </li>
              <li>Passwords, tokens and connection strings are never recorded.</li>
            </ul>
          </details>
        </>
      )}
    </>
  );
}
