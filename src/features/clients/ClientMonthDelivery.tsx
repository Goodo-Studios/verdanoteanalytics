// Client hub header: this month's delivery (OS-025). "N of M assets delivered" with a bar and a
// marker for where today falls in the month, so you can see at a glance whether delivery is ahead
// of the calendar. Counts come from deriveMonthDelivery (the same rule as the client detail page).
// Nothing is drawn while loading, on an error, or when ClickUp has no task for this month.
import { ProgressBar } from "@/components/ProgressBar";
import { deriveMonthDelivery } from "@/features/dashboard/model";
import { useClientDeliveryTasks } from "@/hooks/useClientWork";
import { deliveredText, monthPosition } from "@/lib/progress";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ClientMonthDeliveryBar({ delivered, total, today }: { delivered: number; total: number; today: Date }) {
  const label = deliveredText(delivered, total);
  const day = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <ProgressBar
      done={delivered}
      total={total}
      label={label}
      ariaLabel="Assets delivered this month"
      markerPercent={monthPosition(today)}
      markerLabel={`Today, ${day}`}
      testId="client-hub-delivery"
    />
  );
}

export function ClientMonthDelivery({ slug, now = new Date() }: { slug: string; now?: Date }) {
  const { data } = useClientDeliveryTasks(slug);
  if (!data) return null;
  const d = deriveMonthDelivery(data.open, data.delivered, monthKey(now));
  if (!d) return null;
  return (
    <div className="mt-2 max-w-md">
      <ClientMonthDeliveryBar delivered={d.delivered} total={d.total} today={now} />
    </div>
  );
}
