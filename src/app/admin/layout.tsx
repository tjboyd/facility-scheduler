import { requireSuperAdmin } from "@/lib/guards";
import { AppHeader } from "@/components/AppHeader";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();

  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="admin" />
      <main className="grow px-7 py-6 flex flex-col gap-4">
        <div>
          <div className="eyebrow">Club administration</div>
          <h1 className="display text-[34px] mt-1 mb-1">Facility settings</h1>
          <p className="text-sm text-muted">Only super admins can change anything on these pages.</p>
        </div>
        {children}
      </main>
    </div>
  );
}
