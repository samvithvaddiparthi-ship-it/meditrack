import { humanize } from "@/lib/format";

/** Plain-English names for the activity log's action codes. */
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_failed": "Failed sign-in",
  "auth.account_locked": "Account locked",
  "stock.issue": "Stock issued",
  "stock.waste": "Stock written off",
  "stock.adjust_in": "Stock count increased",
  "stock.adjust_out": "Stock count decreased",
  "stock.write_off_expired": "Expired stock written off",
  "purchase.receive": "Stock received",
  "incident.create": "Incident reported",
  "incident.status_change": "Incident status changed",
  "medicine.create": "Medicine added",
  "medicine.update": "Medicine edited",
  "medicine.activate": "Medicine reactivated",
  "medicine.deactivate": "Medicine deactivated",
  "medicine.delete": "Medicine deleted",
  "category.create": "Category added",
  "category.update": "Category edited",
  "category.delete": "Category deleted",
  "supplier.create": "Supplier added",
  "supplier.update": "Supplier edited",
  "supplier.delete": "Supplier deleted",
  "user.create": "User added",
  "user.update": "User edited",
  "user.reset_password": "Password reset",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanize(action.replace(".", " "));
}
