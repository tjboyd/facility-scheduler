import { redirect } from "next/navigation";
import { requireUser } from "@/lib/guards";
import { canDecideRequests } from "@/lib/domain";
import { AppHeader } from "@/components/AppHeader";
import { Placeholder } from "@/components/Placeholder";

export default async function ApprovalsPage() {
  const user = await requireUser();
  if (!canDecideRequests(user.role)) redirect("/calendar");
  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="approvals" />
      <Placeholder
        eyebrow="Facility office"
        title="Approvals"
        body="Pending requests will queue here for you to accept or decline once booking is built."
      />
    </div>
  );
}
