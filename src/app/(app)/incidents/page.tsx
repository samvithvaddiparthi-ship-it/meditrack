import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { incidentSummary, listIncidents } from "@/server/services/incidents.service";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, INCIDENT_TYPES } from "@/lib/validation/schemas";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { ServiceUnavailableError } from "@/lib/errors";
import { Alert, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { FilterBar, FilterInput, FilterSelect, Pagination, first, intParam, oneOf, type SearchParams } from "@/components/ui/list";
import { IncidentStatusBadge, SeverityBadge } from "@/components/ui/status";
import { Notice } from "@/components/ui/notice";
import { BarList } from "@/components/charts";

export const metadata: Metadata = { title: "Incident reports" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("incident:create");
  const params = await searchParams;
  const filters = {
    q: first(params.q)?.trim().slice(0, 100),
    type: oneOf(params.type, INCIDENT_TYPES),
    severity: oneOf(params.severity, INCIDENT_SEVERITIES),
    status: oneOf(params.status, INCIDENT_STATUSES),
    medicineId: intParam(params.medicine),
    page: intParam(params.page) ?? 1,
  };
  const loaded = await Promise.all([listIncidents(user, filters), incidentSummary(user)]).catch((error) => {
    if (error instanceof ServiceUnavailableError) return null;
    throw error;
  });
  if (!loaded) {
    return (
      <>
        <PageHeader title="Incident reports" />
        <Alert tone="danger">Incident reports are stored in MongoDB, which is currently unreachable. Inventory features continue to work; please try again shortly.</Alert>
      </>
    );
  }
  const [result, summary] = loaded;
  const open = summary.byStatus.filter((s) => s.key === "OPEN" || s.key === "UNDER_REVIEW").reduce((a, s) => a + s.count, 0);
  const highOpen = summary.openBySeverity.filter((s) => s.key === "HIGH" || s.key === "CRITICAL").reduce((a, s) => a + s.count, 0);
  const viewAll = can(user.role, "incident:view-all");

  return (
    <>
      <PageHeader
        title="Incident reports"
        description={viewAll ? "All incident reports (MongoDB collection incident_reports). Counts come from a MongoDB aggregation pipeline." : "Reports you have submitted. Administrators review and resolve them."}
        actions={<ButtonLink href="/incidents/new">Report incident</ButtonLink>}
      />
      <Notice params={params} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total reports" value={summary.total} tone="brand" />
        <StatCard label="Open / under review" value={open} tone="info" />
        <StatCard label="High or critical, open" value={highOpen} tone={highOpen > 0 ? "danger" : "neutral"} />
        <StatCard label="Resolved" value={summary.byStatus.find((s) => s.key === "RESOLVED")?.count ?? 0} tone="success" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Reports by type" description="$facet → $group by type" />
          <CardBody>
            <BarList title="Incident reports by type" categoryLabel="Type" valueLabel="Reports" rows={summary.byType.map((t) => ({ label: humanize(t.key), value: t.count }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Reports by severity" description="$facet → $group by severity" />
          <CardBody>
            <BarList title="Incident reports by severity" categoryLabel="Severity" valueLabel="Reports" rows={summary.bySeverity.map((t) => ({ label: humanize(t.key), value: t.count }))} />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <FilterBar resetHref="/incidents">
          <FilterInput label="Search" name="q" defaultValue={filters.q} placeholder="Words or INC-00001" />
          <FilterSelect label="Type" name="type" defaultValue={filters.type ?? ""} options={[{ value: "", label: "All types" }, ...INCIDENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))]} />
          <FilterSelect label="Severity" name="severity" defaultValue={filters.severity ?? ""} options={[{ value: "", label: "Any severity" }, ...INCIDENT_SEVERITIES.map((t) => ({ value: t, label: humanize(t) }))]} className="lg:w-40" />
          <FilterSelect label="Status" name="status" defaultValue={filters.status ?? ""} options={[{ value: "", label: "Any status" }, ...INCIDENT_STATUSES.map((t) => ({ value: t, label: humanize(t) }))]} className="lg:w-40" />
        </FilterBar>
        {result.rows.length === 0 ? (
          <EmptyState title="No incident reports found" action={<ButtonLink href="/incidents/new">Report incident</ButtonLink>} />
        ) : (
          <Table caption="Incident reports">
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Title</Th>
                <Th>Type</Th>
                <Th>Severity</Th>
                <Th>Status</Th>
                <Th>Reported</Th>
              </tr>
            </thead>
            <TBody>
              {result.rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50/60">
                  <Td className="font-mono text-xs">{i.reference}</Td>
                  <Td>
                    <TextLink href={`/incidents/${i.id}`}>{i.title}</TextLink>
                    {i.medicine ? <div className="text-xs text-slate-500">{i.medicine.name}{i.batch ? ` · ${i.batch.batchNumber}` : ""}</div> : null}
                  </Td>
                  <Td className="text-xs">{humanize(i.type)}</Td>
                  <Td>
                    <SeverityBadge severity={i.severity} />
                  </Td>
                  <Td>
                    <IncidentStatusBadge status={i.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">
                    {formatDateTime(i.createdAt)}
                    <div>{i.reporter.name}</div>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination pathname="/incidents" params={params} page={result.page} pageSize={result.pageSize} total={result.total} />
      </Card>
    </>
  );
}
