import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { ALLOWED_TRANSITIONS, getIncident } from "@/server/services/incidents.service";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { humanize } from "@/lib/format";
import { Card, CardBody, CardHeader, DescriptionList, PageHeader, TextLink } from "@/components/ui/primitives";
import { IncidentStatusBadge, SeverityBadge } from "@/components/ui/status";
import { Notice } from "@/components/ui/notice";
import type { SearchParams } from "@/components/ui/list";
import { StatusForm } from "./status-form";
import { updateIncidentStatusAction } from "../actions";

export const metadata: Metadata = { title: "Incident report" };

const METADATA_LABELS: Record<string, string> = {
  affectedQuantity: "Affected quantity",
  location: "Location",
  damageCause: "Cause of damage",
  packagingType: "Packaging type",
  sealIntact: "Seal intact",
  expectedQuantity: "Expected quantity",
  countedQuantity: "Counted quantity",
  difference: "Difference",
  recordedTemperatureC: "Recorded temperature (°C)",
  durationMinutes: "Duration (minutes)",
};

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("incident:create");
  const { id } = await params;
  const incident = await getIncident(user, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!incident) notFound();
  const transitions = ALLOWED_TRANSITIONS[incident.status];
  const metadata = Object.entries(incident.metadata ?? {});

  return (
    <>
      <PageHeader
        title={incident.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{incident.reference}</span>
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
          </span>
        }
      />
      <Notice params={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Report" />
            <CardBody className="space-y-5">
              <p className="whitespace-pre-line text-sm text-slate-700">{incident.description}</p>
              <DescriptionList
                items={[
                  { label: "Type", value: humanize(incident.type) },
                  { label: "Reported by", value: `${incident.reporter.name} (${humanize(incident.reporter.role)})` },
                  { label: "Reported at", value: formatDateTime(incident.createdAt) },
                  { label: "Medicine", value: incident.medicine ? <TextLink href={`/medicines/${incident.medicine.id}`}>{incident.medicine.name}</TextLink> : "—" },
                  { label: "Batch", value: incident.batch ? <TextLink href={`/batches/${incident.batch.id}`}>{`${incident.batch.batchNumber} (exp. ${formatDate(incident.batch.expiryDate)})`}</TextLink> : "—" },
                  { label: "Last updated", value: formatDateTime(incident.updatedAt) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Type-specific metadata" description="Flexible fields stored in the MongoDB document" />
            <CardBody>
              {metadata.length === 0 ? (
                <p className="text-sm text-slate-500">No additional details.</p>
              ) : (
                <DescriptionList items={metadata.map(([k, v]) => ({ label: METADATA_LABELS[k] ?? humanize(k), value: typeof v === "boolean" ? (v ? "Yes" : "No") : String(v) }))} />
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          {can(user.role, "incident:review") ? (
            <Card>
              <CardHeader title="Review" description={`Current status: ${humanize(incident.status)}`} />
              <CardBody>
                <StatusForm action={updateIncidentStatusAction.bind(null, incident.id, incident.status)} options={transitions} />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Timeline" description="Embedded array in the incident document" />
            <ol className="space-y-4 px-5 py-4">
              {incident.timeline.map((t, i) => (
                <li key={i} className="relative border-l-2 border-slate-200 pl-4">
                  <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand-500" aria-hidden />
                  <p className="text-sm font-medium text-slate-900">
                    {t.action === "CREATED" ? "Reported" : `${humanize(t.fromStatus)} → ${humanize(t.toStatus)}`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t.actor.name} · {formatDateTime(t.at)}
                  </p>
                  {t.note ? <p className="mt-1 text-sm text-slate-700">{t.note}</p> : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
