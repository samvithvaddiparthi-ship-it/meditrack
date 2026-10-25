"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-state";
import type { FefoPlan } from "@/lib/fefo";
import { Field, Input, Select, Textarea, useIdempotencyKey } from "@/components/ui/form";
import { Alert, Button } from "@/components/ui/primitives";
import { issueStockAction, previewIssueAction } from "../actions";

type MedicineOption = { id: number; label: string; unit: string; available: number };

const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export function IssueForm({ medicines, initialMedicineId }: { medicines: MedicineOption[]; initialMedicineId?: string }) {
  const router = useRouter();
  const [idempotencyKey] = useIdempotencyKey();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ medicineId: initialMedicineId ?? "", quantity: "", destination: "", notes: "" });
  const [plan, setPlan] = useState<(FefoPlan & { unit: string; medicineName: string }) | null>(null);
  const [state, setState] = useState<ActionState>(null);
  const selected = medicines.find((m) => String(m.id) === form.medicineId);
  const err = (name: string) => state?.fieldErrors?.[name];

  const change = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (patch.medicineId !== undefined || patch.quantity !== undefined) setPlan(null);
  };

  function preview() {
    startTransition(async () => {
      const result = await previewIssueAction({ medicineId: form.medicineId, quantity: form.quantity });
      setState(result?.ok ? null : result);
      setPlan(result?.ok ? (result.data as typeof plan) : null);
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !idempotencyKey) return;
    startTransition(async () => {
      const result = await issueStockAction({ idempotencyKey, ...form });
      setState(result);
      if (result?.ok) router.push((result.data as { href: string }).href);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {state && !state.ok && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Medicine" name="medicineId" required error={err("medicineId")} hint={selected ? `${selected.available} ${selected.unit}(s) available in unexpired batches` : undefined}>
          {(p) => (
            <Select {...p} value={form.medicineId} onChange={(e) => change({ medicineId: e.target.value })}>
              <option value="">Choose a medicine</option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id} disabled={m.available === 0}>
                  {m.label} — {m.available} {m.unit}(s){m.available === 0 ? " (none usable)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Quantity${selected ? ` (${selected.unit})` : ""}`} name="quantity" required error={err("quantity")}>
          {(p) => <Input {...p} type="number" min={1} step={1} inputMode="numeric" value={form.quantity} onChange={(e) => change({ quantity: e.target.value })} />}
        </Field>
        <Field label="Issued to" name="destination" required error={err("destination")} hint="Ward, department or counter">
          {(p) => <Input {...p} value={form.destination} maxLength={120} list="destinations" onChange={(e) => change({ destination: e.target.value })} />}
        </Field>
        <datalist id="destinations">
          {["OPD Pharmacy Counter", "Emergency Department", "ICU", "Paediatric Ward", "Surgical Ward", "Ward 3 – General Medicine"].map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <Field label="Notes" name="notes" error={err("notes")}>
          {(p) => <Textarea {...p} rows={1} maxLength={500} value={form.notes} onChange={(e) => change({ notes: e.target.value })} />}
        </Field>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">FEFO allocation</p>
            <p className="text-xs text-slate-500">Earliest-expiring unexpired batches are used first. Expired and empty batches are never selected.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={preview} disabled={pending || !form.medicineId || !form.quantity}>
            Preview batches
          </Button>
        </div>
        {plan ? (
          <div className="mt-3">
            {plan.shortfall > 0 ? (
              <Alert tone="danger">
                Only {plan.available} {plan.unit}(s) available — short by {plan.shortfall}. The issue would be rejected.
              </Alert>
            ) : null}
            <table className="mt-2 min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-4 font-medium">Batch</th>
                  <th className="py-1 pr-4 font-medium">Expiry</th>
                  <th className="py-1 pr-4 text-right font-medium">In batch</th>
                  <th className="py-1 text-right font-medium">Take</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {plan.allocations.map((a) => (
                  <tr key={a.batchId} className="border-t border-slate-200">
                    <td className="py-1.5 pr-4 font-mono text-xs">{a.batchNumber}</td>
                    <td className="py-1.5 pr-4">{fmtDate(a.expiryDate)}</td>
                    <td className="py-1.5 pr-4 text-right">{a.quantity}</td>
                    <td className="py-1.5 text-right font-semibold text-slate-900">{a.take}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-3 border-t border-slate-100 pt-5">
        <Button type="submit" disabled={pending || !idempotencyKey}>
          {pending ? "Working…" : "Issue stock"}
        </Button>
        <p className="text-xs text-slate-500">All batch deductions are committed together, or none are.</p>
      </div>
    </form>
  );
}
