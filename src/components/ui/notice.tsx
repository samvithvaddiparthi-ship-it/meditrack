import { Alert } from "@/components/ui/primitives";
import { first, type SearchParams } from "@/components/ui/list";

/**
 * Success notices shown after a redirect. Only redirects issued after a
 * committed operation carry these codes, so the message is never shown for
 * a write that did not happen.
 */
const NOTICES: Record<string, string> = {
  "medicine-created": "Medicine added.",
  "medicine-updated": "Medicine updated.",
  "medicine-activated": "Medicine reactivated.",
  "medicine-deactivated": "Medicine deactivated. Its history is preserved.",
  "medicine-deleted": "Medicine deleted.",
  "category-saved": "Category saved.",
  "category-deleted": "Category deleted.",
  "supplier-created": "Supplier added.",
  "supplier-updated": "Supplier updated.",
  "supplier-deleted": "Supplier deleted.",
  "purchase-received": "Stock receipt recorded. Batch quantities were updated by the ledger trigger.",
  "purchase-duplicate": "This receipt had already been recorded — no stock was added twice.",
  "issue-recorded": "Stock issued using FEFO. The batches used are listed below.",
  "issue-duplicate": "This issue had already been recorded — no stock was deducted twice.",
  "waste-recorded": "Waste recorded.",
  "adjustment-recorded": "Adjustment recorded.",
  "incident-created": "Incident report submitted.",
  "incident-updated": "Incident status updated.",
  "user-created": "User account created.",
  "user-updated": "User account updated.",
  "password-reset": "Password reset. The user's existing sessions were signed out.",
  "audit-delayed": "Saved. The activity log entry will be delivered when MongoDB is reachable.",
};

export function Notice({ params }: { params: SearchParams }) {
  const code = first(params.notice);
  const audit = first(params.audit);
  if (!code || !NOTICES[code]) return null;
  return (
    <div className="mb-4 space-y-2">
      <Alert tone="success">{NOTICES[code]}</Alert>
      {audit === "pending" ? <Alert tone="warning">{NOTICES["audit-delayed"]}</Alert> : null}
    </div>
  );
}
