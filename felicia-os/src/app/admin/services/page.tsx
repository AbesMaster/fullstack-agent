import { db, requirePageUser } from "@/lib/server";
import { listServices } from "@/lib/services/catalogue";
import { ServiceEditor } from "@/components/admin/ServiceEditor";

export default async function Page() {
  const user = await requirePageUser("dashboard.view");
  const services = await listServices(await db());
  const canEdit = user.role === "owner" || user.role === "admin";
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Services & pricing</h1>
      <p className="text-sm text-navy-800/70">All prices start as <strong>proposed</strong>. Setting a service to <strong>active</strong> records your approval of its price. Changes are validated and logged.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {services.map((s) => (
          <ServiceEditor key={s.id} canEdit={canEdit} s={{ id: s.id, name: s.name, description: s.description, durationMinutes: s.durationMinutes, priceMinor: s.priceMinor, priceMaxMinor: s.priceMaxMinor, capacity: s.capacity, status: s.status, cancellationTerms: s.cancellationTerms, ownerApprovedPrice: s.ownerApprovedPrice }} />
        ))}
      </div>
    </div>
  );
}
