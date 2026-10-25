"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-state";
import { Field, Input, Select, Textarea, useIdempotencyKey } from "@/components/ui/form";
import { Alert, Button } from "@/components/ui/primitives";
import { receivePurchaseAction } from "../actions";

type Option = { id: number; label: string; unit?: string };
type Line = { key: number; medicineId: string; batchNumber: string; manufactureDate: string; expiryDate: string; quantity: string; unitCost: string };

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, medicineId: "", batchNumber: "", manufactureDate: "", expiryDate: "", quantity: "", unitCost: "" });

export function PurchaseForm({ suppliers, medicines, today }: { suppliers: Option[]; medicines: Option[]; today: string }) {
  const router = useRouter();
  const [idempotencyKey] = useIdempotencyKey();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const [header, setHeader] = useState({ supplierId: "", invoiceNumber: "", purchaseDate: today, notes: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const err = (name: string) => state?.fieldErrors?.[name];
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const units = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !idempotencyKey) return;
    const payload = {
      idempotencyKey,
      supplierId: header.supplierId,
      invoiceNumber: header.invoiceNumber,
      purchaseDate: header.purchaseDate,
      notes: header.notes,
      items: lines.map((l) => ({
        medicineId: l.medicineId,
        batchNumber: l.batchNumber,
        manufactureDate: l.manufactureDate,
        expiryDate: l.expiryDate,
        quantity: l.quantity,
        unitCost: l.unitCost,
      })),
    };
    startTransition(async () => {
      const result = await receivePurchaseAction(payload);
      setState(result);
      if (result?.ok) {
        router.push((result.data as { href: string }).href);
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {state && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
      {state?.fieldErrors?.items ? <Alert tone="danger">{state.fieldErrors.items[0]}</Alert> : null}

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Supplier" name="supplierId" required error={err("supplierId")}>
          {(p) => (
            <Select {...p} value={header.supplierId} onChange={(e) => setHeader({ ...header, supplierId: e.target.value })}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Invoice number" name="invoiceNumber" required error={err("invoiceNumber")} hint="Must be unique per supplier">
          {(p) => <Input {...p} value={header.invoiceNumber} maxLength={50} onChange={(e) => setHeader({ ...header, invoiceNumber: e.target.value })} />}
        </Field>
        <Field label="Purchase / receipt date" name="purchaseDate" required error={err("purchaseDate")}>
          {(p) => <Input {...p} type="date" max={today} value={header.purchaseDate} onChange={(e) => setHeader({ ...header, purchaseDate: e.target.value })} />}
        </Field>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Items ({lines.length})</h2>
          <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])} disabled={lines.length >= 50}>
            + Add item
          </Button>
        </div>
        <ol className="space-y-4">
          {lines.map((line, index) => {
            const unit = medicines.find((m) => String(m.id) === line.medicineId)?.unit;
            const prefix = `items.${index}`;
            return (
              <li key={line.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item {index + 1}</p>
                  {lines.length > 1 ? (
                    <button type="button" className="text-xs font-medium text-red-600 hover:text-red-800" onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                  <Field label="Medicine" name={`${prefix}.medicineId`} required error={err(`${prefix}.medicineId`)} className="lg:col-span-2">
                    {(p) => (
                      <Select {...p} value={line.medicineId} onChange={(e) => update(line.key, { medicineId: e.target.value })}>
                        <option value="">Choose a medicine</option>
                        {medicines.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Batch number" name={`${prefix}.batchNumber`} required error={err(`${prefix}.batchNumber`)}>
                    {(p) => <Input {...p} value={line.batchNumber} maxLength={50} className="font-mono uppercase" onChange={(e) => update(line.key, { batchNumber: e.target.value })} />}
                  </Field>
                  <Field label="Manufactured" name={`${prefix}.manufactureDate`} required error={err(`${prefix}.manufactureDate`)}>
                    {(p) => <Input {...p} type="date" max={today} value={line.manufactureDate} onChange={(e) => update(line.key, { manufactureDate: e.target.value })} />}
                  </Field>
                  <Field label="Expiry" name={`${prefix}.expiryDate`} required error={err(`${prefix}.expiryDate`)}>
                    {(p) => <Input {...p} type="date" min={today} value={line.expiryDate} onChange={(e) => update(line.key, { expiryDate: e.target.value })} />}
                  </Field>
                  <Field label={`Quantity${unit ? ` (${unit})` : ""}`} name={`${prefix}.quantity`} required error={err(`${prefix}.quantity`)}>
                    {(p) => <Input {...p} type="number" min={1} step={1} inputMode="numeric" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />}
                  </Field>
                  <Field label="Unit cost (₹)" name={`${prefix}.unitCost`} required error={err(`${prefix}.unitCost`)}>
                    {(p) => <Input {...p} type="number" min={0} step="0.01" inputMode="decimal" value={line.unitCost} onChange={(e) => update(line.key, { unitCost: e.target.value })} />}
                  </Field>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <Field label="Notes" name="notes" error={err("notes")}>
        {(p) => <Textarea {...p} rows={2} maxLength={500} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />}
      </Field>

      <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="tabular text-sm text-slate-600">
          {units} unit(s) · total{" "}
          <span className="font-semibold text-slate-900">{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(total)}</span>
        </p>
        <Button type="submit" disabled={pending || !idempotencyKey}>
          {pending ? "Recording receipt…" : "Record receipt"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        The whole receipt is saved in one MySQL transaction. If any item is invalid nothing is saved. Submitting twice records it only once.
      </p>
    </form>
  );
}
