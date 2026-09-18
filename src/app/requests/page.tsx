import { requireUser } from "@/lib/guards";
import { AppHeader } from "@/components/AppHeader";
import { Placeholder } from "@/components/Placeholder";

export default async function RequestsPage() {
  const user = await requireUser();
  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="requests" />
      <Placeholder
        eyebrow={user.team ? user.team.name : "No team assigned"}
        title="My requests"
        body="Once booking is built, every request your team has made will be listed here with its status."
      />
    </div>
  );
}
