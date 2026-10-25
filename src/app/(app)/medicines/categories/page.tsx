import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listCategories } from "@/server/services/catalog.service";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { ActionButton } from "@/components/ui/action-button";
import { Notice } from "@/components/ui/notice";
import type { SearchParams } from "@/components/ui/list";
import { CategoryForm } from "./category-forms";
import { deleteCategoryAction, saveCategoryAction } from "../actions";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageAccess("category:manage");
  const [categories, params] = await Promise.all([listCategories(), searchParams]);
  return (
    <>
      <PageHeader title="Medicine categories" description="A category can be deleted only while no medicine uses it (enforced by the foreign key fk_medicines_category, ON DELETE RESTRICT)." />
      <Notice params={params} />
      <Card>
        <CardHeader title="Add category" />
        <CardBody>
          <CategoryForm action={saveCategoryAction} submitLabel="Add" />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title={`${categories.length} categories`} />
        <ul className="divide-y divide-slate-100">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-end">
              <div className="flex-1">
                <CategoryForm action={saveCategoryAction} initial={c} submitLabel="Save" />
              </div>
              <div className="flex items-center gap-3 lg:pb-0.5">
                <span className="text-xs text-slate-500">{c.medicineCount} medicine(s)</span>
                <ActionButton
                  action={deleteCategoryAction.bind(null, c.id)}
                  label="Delete"
                  variant="danger"
                  confirm={{ title: `Delete ${c.name}?`, message: c.medicineCount > 0 ? "This category is in use; the database will refuse the deletion." : "This category is unused and will be removed.", confirmLabel: "Delete" }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
