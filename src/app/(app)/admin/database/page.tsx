import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { inspectDatabases } from "@/server/services/inspector.service";
import { formatNumber } from "@/lib/format";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, StatCard, Table, TBody, Td, Th } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Database inspector" };

export default async function DatabasePage() {
  const user = await requirePageAccess("audit:view");
  const d = await inspectDatabases(user);
  const procedures = d.routines.filter((r) => r.type === "PROCEDURE");
  const functions = d.routines.filter((r) => r.type === "FUNCTION");

  return (
    <>
      <PageHeader
        title="Database inspector"
        description="Live metadata read from MySQL information_schema and MongoDB — evidence of the schema objects that implement MediTrack's integrity rules."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Tables" value={d.counts.length} tone="brand" />
        <StatCard label="Views" value={d.views.length} tone="info" />
        <StatCard label="Triggers" value={d.triggers.length} tone="warning" />
        <StatCard label="Procedures / functions" value={`${procedures.length} / ${functions.length}`} tone="success" />
        <StatCard label="CHECK constraints" value={d.checks.length} tone="neutral" />
        <StatCard label="Indexes" value={d.indexes.length} tone="neutral" />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        MySQL {d.mysqlVersion} · MongoDB {d.mongo?.version ?? "unreachable"} · audit outbox pending: {d.outboxPending}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="MySQL tables" description="Exact row counts" />
          <Table caption="Tables">
            <thead>
              <tr>
                <Th>Table</Th>
                <Th align="right">Rows</Th>
              </tr>
            </thead>
            <TBody>
              {d.counts.map((c) => (
                <tr key={c.table}>
                  <Td className="font-mono text-xs">{c.table}</Td>
                  <Td align="right">{formatNumber(c.rows)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Triggers, routines, views & events" />
          <CardBody className="space-y-5 text-sm">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Triggers</h3>
              <ul className="space-y-1">
                {d.triggers.map((t) => (
                  <li key={t.name} className="flex flex-wrap items-center gap-2">
                    <code className="text-xs">{t.name}</code>
                    <Badge tone="warning">
                      {t.timing} {t.event}
                    </Badge>
                    <span className="text-xs text-slate-500">on {t.tbl}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Stored procedures & functions</h3>
              <ul className="space-y-1.5">
                {d.routines.map((r) => (
                  <li key={r.name}>
                    <code className="text-xs">{r.name}</code> <Badge tone={r.type === "PROCEDURE" ? "success" : "info"}>{r.type}</Badge>
                    {r.comment ? <p className="text-xs text-slate-500">{r.comment}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Views</h3>
              <p className="flex flex-wrap gap-1.5">
                {d.views.map((v) => (
                  <code key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                    {v}
                  </code>
                ))}
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled events</h3>
              {d.events.map((e) => (
                <p key={e.name} className="text-xs">
                  <code>{e.name}</code> · every {e.interval_value} {e.interval_field.toLowerCase()} · {e.status}
                </p>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="CHECK constraints" description="Database-level input validation" />
        <Table caption="Check constraints">
          <thead>
            <tr>
              <Th>Table</Th>
              <Th>Constraint</Th>
              <Th>Clause</Th>
            </tr>
          </thead>
          <TBody>
            {d.checks.map((c) => (
              <tr key={c.name}>
                <Td className="font-mono text-xs">{c.tbl}</Td>
                <Td className="font-mono text-xs">{c.name}</Td>
                <Td className="max-w-xl break-all font-mono text-[11px] text-slate-500">{c.clause}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Foreign keys" description="Referential integrity (ON DELETE rule shown)" />
          <Table caption="Foreign keys">
            <thead>
              <tr>
                <Th>Constraint</Th>
                <Th>References</Th>
                <Th>On delete</Th>
              </tr>
            </thead>
            <TBody>
              {d.foreignKeys.map((f) => (
                <tr key={f.name}>
                  <Td className="font-mono text-xs">{f.name}</Td>
                  <Td className="font-mono text-xs">
                    {f.tbl}({f.cols}) → {f.ref_tbl}
                  </Td>
                  <Td>
                    <Badge tone={f.on_delete === "CASCADE" ? "warning" : "neutral"}>{f.on_delete}</Badge>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Indexes" description="PRIMARY, UNIQUE, secondary and FULLTEXT" />
          <div className="max-h-[32rem] overflow-y-auto">
            <Table caption="Indexes">
              <thead>
                <tr>
                  <Th>Table</Th>
                  <Th>Index</Th>
                  <Th>Columns</Th>
                </tr>
              </thead>
              <TBody>
                {d.indexes.map((i) => (
                  <tr key={`${i.tbl}.${i.name}`}>
                    <Td className="font-mono text-xs">{i.tbl}</Td>
                    <Td className="font-mono text-xs">
                      {i.name} {i.index_type === "FULLTEXT" ? <Badge tone="info">FULLTEXT</Badge> : i.unique ? <Badge tone="brand">UNIQUE</Badge> : null}
                    </Td>
                    <Td className="font-mono text-xs text-slate-500">{i.cols}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="MongoDB collections" description="Document store for incident reports and the activity log" />
        {d.mongo === null ? (
          <CardBody>
            <Alert tone="danger">MongoDB is unreachable.</Alert>
          </CardBody>
        ) : (
          <Table caption="MongoDB collections">
            <thead>
              <tr>
                <Th>Collection</Th>
                <Th align="right">Documents</Th>
                <Th>$jsonSchema validator</Th>
                <Th>Indexes</Th>
              </tr>
            </thead>
            <TBody>
              {d.mongo.collections.map((c) => (
                <tr key={c.name}>
                  <Td className="font-mono text-xs">{c.name}</Td>
                  <Td align="right">{formatNumber(c.documents)}</Td>
                  <Td>{c.validator ? <Badge tone="success">Enforced</Badge> : <Badge>None</Badge>}</Td>
                  <Td>
                    <ul className="space-y-0.5">
                      {c.indexes.map((i) => (
                        <li key={i.name} className="font-mono text-[11px] text-slate-600">
                          {i.name} {i.key} {i.unique ? "(unique)" : ""}
                        </li>
                      ))}
                    </ul>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
