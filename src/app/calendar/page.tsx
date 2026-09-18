import { requireUser } from "@/lib/guards";
import { AppHeader } from "@/components/AppHeader";
import { Placeholder } from "@/components/Placeholder";

export default async function CalendarPage() {
  const user = await requireUser();
  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="calendar" />
      <Placeholder
        eyebrow="Facility calendar"
        title="Week calendar"
        body="The week grid, booking requests and approvals are the next build steps. People and access are live now — use Admin to add coaches and teams."
      />
    </div>
  );
}
